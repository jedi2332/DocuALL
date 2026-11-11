import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { DEFAULT_FOLDERS, planZipPaths, type OrgFile, type OrgFolder, type OrgRule, type VaultFile, type VaultProject } from "./organize";

async function uid() {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function getOrganizeSettings(): Promise<{ folders: OrgFolder[]; rules: OrgRule[] }> {
  const { data, error } = await supabase.from("organize_settings").select("*").maybeSingle();
  if (error) throw error;
  const folders = (data?.folders as unknown as OrgFolder[]) ?? [];
  return { folders: folders.length ? folders : DEFAULT_FOLDERS, rules: (data?.rules as unknown as OrgRule[]) ?? [] };
}

export async function saveOrganizeSettings(folders: OrgFolder[], rules: OrgRule[]) {
  const user_id = await uid();
  const { error } = await supabase.from("organize_settings").upsert({
    user_id,
    folders: folders as unknown as Json,
    rules: rules as unknown as Json,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function listVaults(): Promise<VaultProject[]> {
  const { data, error } = await supabase.from("vault_projects").select("*").order("created_at");
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id,
    name: v.name,
    locked: v.locked,
    isCapCut: v.is_capcut,
    files: v.files as unknown as VaultFile[],
  }));
}

export async function createVault(name: string, files: VaultFile[], isCapCut = false) {
  const user_id = await uid();
  const { error } = await supabase.from("vault_projects").insert({
    user_id,
    name,
    is_capcut: isCapCut,
    files: files as unknown as Json,
  });
  if (error) throw error;
}

export async function appendVaultFiles(id: string, files: VaultFile[]) {
  const { data, error } = await supabase.rpc("append_vault_files", {
    p_vault_id: id,
    p_files: files as unknown as Json,
  });
  if (error) throw error;
  if (!data) throw new Error("This Vault is no longer available.");
}

export async function updateVault(id: string, patch: { locked?: boolean; isCapCut?: boolean }) {
  const { data, error } = await supabase
    .from("vault_projects")
    .update({
      ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
      ...(patch.isCapCut !== undefined ? { is_capcut: patch.isCapCut } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This Vault is no longer available.");
}

export async function deleteVault(id: string) {
  const { data, error } = await supabase.from("vault_projects").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This Vault is unavailable or locked.");
}

export async function logRun(changes: { file: string; to: string }[]) {
  const user_id = await uid();
  const { data, error } = await supabase
    .from("organize_runs")
    .insert({ user_id, changes: changes as unknown as Json, file_count: changes.length })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** ZIPs prepared in this browser session, so "Download again" works without re-adding files. */
export const preparedZips = new Map<string, { blob: Blob; name: string }>();

export async function listRuns() {
  const { data, error } = await supabase.from("organize_runs").select("*").order("created_at", { ascending: false }).limit(10);
  if (error) throw error;
  return data ?? [];
}

async function sha256(buf: ArrayBuffer) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function imageSize(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return Promise.resolve({});
  return createImageBitmap(file)
    .then((b) => {
      const r = { width: b.width, height: b.height };
      b.close();
      return r;
    })
    .catch(() => ({}));
}

const MAX_TEXT_BYTES = 30 * 1024 * 1024;

/** Reads searchable text on this device only (PDF text layer, OCR for scans/photos, PowerPoint/Word XML). Never uploaded. */
async function extractText(file: File, buf: ArrayBuffer): Promise<string | undefined> {
  if (file.size > MAX_TEXT_BYTES) return undefined;
  const n = file.name.toLowerCase();
  try {
    if (file.type === "application/pdf" || n.endsWith(".pdf")) {
      const { extractPdfText } = await import("./pdf-render");
      const layer = await extractPdfText(new Uint8Array(buf.slice(0)));
      if (layer.trim().length >= 20) return layer;
      // No text layer (camera scan / photographed paper): read it on-device.
      const { ocrPdf } = await import("./ocr");
      return (await ocrPdf(new Uint8Array(buf.slice(0)))) || layer || undefined;
    }
    if (/^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/.test(n)) {
      const { ocrImage } = await import("./ocr");
      return (await ocrImage(file)) || undefined;
    }
    if (/\.(pptx|docx)$/.test(n)) {
      const zip = await JSZip.loadAsync(buf);
      const parts = Object.keys(zip.files)
        .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k) || k === "word/document.xml")
        .slice(0, 40);
      let out = "";
      for (const k of parts) out += " " + (await zip.file(k)!.async("string")).replace(/<[^>]+>/g, " ");
      return out.slice(0, 20000) || undefined;
    }
  } catch {
    return undefined; // unreadable: sorted on filename only
  }
  return undefined;
}

export async function readFiles(list: File[]): Promise<{ meta: OrgFile; file: File }[]> {
  return Promise.all(
    list.map(async (file) => {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const buf = await file.arrayBuffer();
      const [hash, dims, text] = await Promise.all([sha256(buf), imageSize(file), extractText(file, buf)]);
      return {
        file,
        meta: { id: crypto.randomUUID(), path, name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, hash, ...dims, ...(text ? { text } : {}) },
      };
    }),
  );
}

/** Builds one ZIP of untouched copies. Vault files keep their original relative paths. */
export async function buildZip(
  entries: { file: File; meta: OrgFile; folder: string; locked: boolean; duplicateOfName?: string | undefined }[],
) {
  const zip = new JSZip();
  const targets = planZipPaths(entries.map((e) => ({ path: e.meta.path, name: e.meta.name, folder: e.folder, locked: e.locked, duplicateOfName: e.duplicateOfName })));
  const log: string[] = [];
  entries.forEach((e, i) => {
    const target = targets[i]!;
    zip.file(target, e.file, { date: new Date(e.meta.lastModified) });
    log.push(`${e.meta.path}  ->  ${target}${e.duplicateOfName && !e.locked ? `   (exact copy of ${e.duplicateOfName}, kept)` : ""}`);
  });
  const bucket = (e: (typeof entries)[number]) => (e.duplicateOfName && !e.locked ? "Duplicates to review" : e.folder);
  const folders = [...new Set(entries.map(bucket))];
  zip.file(
    "README.txt",
    [
      "DocuALL Organize export",
      `Created ${new Date().toLocaleString("en-US")}`,
      "",
      "These are COPIES. Nothing on your device was moved, renamed or deleted.",
      "Protected vault files keep their original filenames and folder paths.",
      "Exact duplicates are in 'Duplicates to review' — nothing was deleted.",
      "",
      "Checklist:",
      ...folders.map((f) => `[ ] ${f} (${entries.filter((e) => bucket(e) === f).length} files)`),
    ].join("\n"),
  );
  zip.file("CHANGES.txt", log.join("\n"));
  return zip.generateAsync({ type: "blob" });
}
