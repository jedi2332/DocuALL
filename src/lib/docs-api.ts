import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { buildPdfFromImages, stampFieldsOnPdf, pdfPageCount } from "./pdf";
import { renderPdfThumbnail } from "./pdf-render";
import { makeThumbnail } from "./image-utils";
import type { FieldPlacement, ResolvedField } from "./docuall-types";

export type DocumentRow = Tables<"documents">;
export type SignatureRow = Tables<"signatures">;
export type ProfileRow = Tables<"profiles">;
export type SigningRequestRow = Tables<"signing_requests">;

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not signed in");
  return data.user.id;
}

export async function signedUrl(bucket: string, path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error("Could not load file");
  return data.signedUrl;
}

async function downloadBucketBytes(bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error("Could not download file");
  return new Uint8Array(await data.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export async function listDocuments(): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getDocument(id: string): Promise<DocumentRow> {
  const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
  if (error || !data) throw new Error("Document not found");
  return data;
}

export async function renameDocument(id: string, title: string) {
  const { error } = await supabase
    .from("documents")
    .update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteDocument(id: string) {
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Create a document from scanned/imported photo pages (JPEG bytes). */
export async function createDocumentFromPages(pages: Uint8Array[], title?: string): Promise<DocumentRow> {
  const userId = await requireUserId();
  const docId = crypto.randomUUID();
  const pagePaths: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const path = `${userId}/${docId}_p${i}.jpg`;
    const { error } = await supabase.storage
      .from("documents")
      .upload(path, pages[i]!.buffer as ArrayBuffer, { contentType: "image/jpeg" });
    if (error) throw error;
    pagePaths.push(path);
  }

  const thumb = await makeThumbnail(pages[0]!);
  const thumbPath = `${userId}/${docId}_thumb.jpg`;
  await supabase.storage.from("documents").upload(thumbPath, thumb.buffer as ArrayBuffer, { contentType: "image/jpeg" });

  const pdfBytes = await buildPdfFromImages(pages);
  const pdfPath = `${userId}/${docId}.pdf`;
  const { error: pdfErr } = await supabase.storage
    .from("documents")
    .upload(pdfPath, pdfBytes.buffer as ArrayBuffer, { contentType: "application/pdf" });
  if (pdfErr) throw pdfErr;

  const fallbackTitle = `Scan ${new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: docId,
      user_id: userId,
      title: (title ?? "").trim() || fallbackTitle,
      kind: "scanned",
      page_paths: pagePaths,
      page_count: pages.length,
      pdf_path: pdfPath,
      thumbnail_path: thumbPath,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Create failed");
  return data;
}

/** Import an existing PDF file as-is. */
export async function importPdfDocument(file: File, title?: string): Promise<DocumentRow> {
  const userId = await requireUserId();
  const docId = crypto.randomUUID();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error("Empty file");

  const pdfPath = `${userId}/${docId}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(pdfPath, bytes.buffer as ArrayBuffer, { contentType: "application/pdf" });
  if (upErr) throw upErr;

  const count = await pdfPageCount(bytes);
  let thumbPath: string | null = null;
  try {
    const thumb = await renderPdfThumbnail(bytes);
    thumbPath = `${userId}/${docId}_thumb.jpg`;
    await supabase.storage.from("documents").upload(thumbPath, thumb.buffer as ArrayBuffer, { contentType: "image/jpeg" });
  } catch {
    thumbPath = null;
  }

  const docTitle = (title ?? "").trim() || file.name.replace(/\.pdf$/i, "").trim() || "Imported PDF";
  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: docId,
      user_id: userId,
      title: docTitle,
      kind: "imported",
      page_paths: [],
      page_count: count,
      pdf_path: pdfPath,
      thumbnail_path: thumbPath,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Import failed");
  return data;
}

/** Stamp fields onto a document's PDF and store the new PDF. */
export async function applyFieldsToDocument(doc: DocumentRow, fields: FieldPlacement[]): Promise<DocumentRow> {
  if (!doc.pdf_path) throw new Error("Document has no PDF");
  const resolved: ResolvedField[] = [];
  for (const f of fields) {
    const base = { type: f.type, page_index: f.page_index, x: f.x, y: f.y, w: f.w };
    if (f.type === "signature" || f.type === "initials") {
      if (!f.signatureId) throw new Error("Pick a signature for each signature field");
      const { data: sig, error } = await supabase.from("signatures").select("*").eq("id", f.signatureId).single();
      if (error || !sig) throw new Error("Signature not found");
      resolved.push({ ...base, imageBytes: await downloadBucketBytes("signatures", sig.image_path) });
    } else {
      resolved.push({ ...base, text: f.text ?? "" });
    }
  }

  const pdfBytes = await downloadBucketBytes("documents", doc.pdf_path);
  const stamped = await stampFieldsOnPdf(pdfBytes, resolved);
  const userId = await requireUserId();
  const newPdfPath = `${userId}/${doc.id}_signed_${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(newPdfPath, stamped.buffer as ArrayBuffer, { contentType: "application/pdf" });
  if (upErr) throw upErr;

  let thumbPath = doc.thumbnail_path;
  try {
    const thumb = await renderPdfThumbnail(stamped);
    const newThumb = `${userId}/${doc.id}_thumb_${Date.now()}.jpg`;
    await supabase.storage.from("documents").upload(newThumb, thumb.buffer as ArrayBuffer, { contentType: "image/jpeg" });
    thumbPath = newThumb;
  } catch {
    /* keep old thumbnail */
  }

  const { data, error } = await supabase
    .from("documents")
    .update({ pdf_path: newPdfPath, thumbnail_path: thumbPath, updated_at: new Date().toISOString() })
    .eq("id", doc.id)
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Update failed");
  return data;
}

export async function downloadDocumentPdf(doc: DocumentRow): Promise<Uint8Array> {
  if (!doc.pdf_path) throw new Error("Document has no PDF");
  return downloadBucketBytes("documents", doc.pdf_path);
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

export async function listSignatures(): Promise<SignatureRow[]> {
  const { data, error } = await supabase.from("signatures").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createSignature(kind: "draw" | "type", pngBytes: Uint8Array): Promise<SignatureRow> {
  const userId = await requireUserId();
  const sigId = crypto.randomUUID();
  const path = `${userId}/${sigId}.png`;
  const { error: upErr } = await supabase.storage
    .from("signatures")
    .upload(path, pngBytes.buffer as ArrayBuffer, { contentType: "image/png" });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("signatures")
    .insert({ id: sigId, user_id: userId, kind, image_path: path })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Save failed");
  return data;
}

export async function deleteSignature(sig: SignatureRow) {
  await supabase.storage.from("signatures").remove([sig.image_path]);
  const { error } = await supabase.from("signatures").delete().eq("id", sig.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Profile (powers auto-fill)
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<ProfileRow | null> {
  const { data, error } = await supabase.from("profiles").select("*").maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateProfile(patch: Partial<ProfileRow>) {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Signing requests (owner side)
// ---------------------------------------------------------------------------

export async function createSigningRequest(
  docId: string,
  signerName: string,
  fields: FieldPlacement[],
  expiryDays = 30,
): Promise<SigningRequestRow> {
  const userId = await requireUserId();
  const token = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * 86400000).toISOString() : null;
  const { data, error } = await supabase
    .from("signing_requests")
    .insert({
      owner_id: userId,
      doc_id: docId,
      signer_name: signerName.trim(),
      token,
      status: "pending",
      fields: fields.map((f) => ({ ...f, id: f.id || crypto.randomUUID() })),
      expires_at: expiresAt,
    })
    .select()
    .single();
  if (error || !data) throw error ?? new Error("Could not create signing link");
  return data;
}

export async function listSigningRequests(docId: string): Promise<SigningRequestRow[]> {
  const { data, error } = await supabase
    .from("signing_requests")
    .select("*")
    .eq("doc_id", docId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function cancelSigningRequest(id: string) {
  const { error } = await supabase.from("signing_requests").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export function signingLink(token: string): string {
  return `${window.location.origin}/sign/${token}`;
}
