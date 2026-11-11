import { createServerFn } from "@tanstack/react-start";
import { stampFieldsOnPdf } from "./pdf";
import type { FieldType } from "./docuall-types";

interface PendingField {
  id: string;
  type: FieldType;
  page_index: number;
  x: number;
  y: number;
  w: number;
  label?: string;
}

interface FilledField {
  id: string;
  /** PNG data URL for signature/initials, plain text for date/text. */
  value: string;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Public: load a signing request by its token (the token is the credential,
 * same model as emailed DocuSign links). Returns only what the signer needs. */
export const getPublicSigningRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("signing_requests")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error || !req) throw new Error("Signing link not found");

    if (req.expires_at && new Date(req.expires_at) <= new Date()) {
      if (req.status === "pending") {
        await supabaseAdmin.from("signing_requests").update({ status: "expired" }).eq("id", req.id);
      }
      throw new Error("This signing link has expired");
    }
    if (req.status === "cancelled") throw new Error("This signing request was cancelled");

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("documents")
      .select("id, title, kind, page_count, page_paths, pdf_path")
      .eq("id", req.doc_id)
      .single();
    if (docErr || !doc) throw new Error("Document not found");

    let pageUrls: string[] = [];
    const pagePaths = Array.isArray(doc.page_paths) ? (doc.page_paths as string[]) : [];
    if (pagePaths.length > 0) {
      const { data: urls } = await supabaseAdmin.storage
        .from("documents")
        .createSignedUrls(pagePaths, 3600);
      pageUrls = (urls ?? []).map((u) => u.signedUrl).filter((u): u is string => !!u);
    }

    let pdfUrl: string | null = null;
    if (pageUrls.length === 0 && doc.pdf_path) {
      const { data: u } = await supabaseAdmin.storage.from("documents").createSignedUrl(doc.pdf_path, 3600);
      pdfUrl = u?.signedUrl ?? null;
    }

    return {
      signerName: req.signer_name,
      status: req.status,
      docTitle: doc.title,
      pageCount: doc.page_count,
      pageUrls,
      pdfUrl,
      fields: (req.fields as unknown as PendingField[]) ?? [],
    };
  });

/** Public: submit filled fields. Stamps them into the document PDF and marks
 * the request completed. */
export const completeSigningRequest = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; fields: FilledField[] }) => input)
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("signing_requests")
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (error || !req) throw new Error("Signing link not found");
    if (req.status !== "pending") throw new Error("This signing request is no longer pending");
    if (req.expires_at && new Date(req.expires_at) <= new Date()) {
      await supabaseAdmin.from("signing_requests").update({ status: "expired" }).eq("id", req.id);
      throw new Error("This signing link has expired");
    }

    const pending = (req.fields as unknown as PendingField[]) ?? [];
    const filledById = new Map(data.fields.map((f) => [f.id, f.value]));

    const resolved = [];
    for (const p of pending) {
      const value = filledById.get(p.id);
      if (!value) throw new Error("Please fill in every field before submitting");
      const base = { type: p.type, page_index: p.page_index, x: p.x, y: p.y, w: p.w };
      if (p.type === "signature" || p.type === "initials") {
        resolved.push({ ...base, imageBytes: dataUrlToBytes(value) });
      } else {
        resolved.push({ ...base, text: value });
      }
    }

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("documents")
      .select("*")
      .eq("id", req.doc_id)
      .single();
    if (docErr || !doc || !doc.pdf_path) throw new Error("Document not found");

    const { data: pdfBlob, error: dlErr } = await supabaseAdmin.storage.from("documents").download(doc.pdf_path);
    if (dlErr || !pdfBlob) throw new Error("Could not load the document");
    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());

    const stamped = await stampFieldsOnPdf(pdfBytes, resolved);
    const newPath = `${req.owner_id}/${doc.id}_signed_${Date.now()}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("documents")
      .upload(newPath, stamped.buffer as ArrayBuffer, { contentType: "application/pdf" });
    if (upErr) throw new Error("Could not save the signed document");

    await supabaseAdmin
      .from("documents")
      .update({ pdf_path: newPath, updated_at: new Date().toISOString() })
      .eq("id", doc.id);
    await supabaseAdmin
      .from("signing_requests")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", req.id);

    return { ok: true };
  });
