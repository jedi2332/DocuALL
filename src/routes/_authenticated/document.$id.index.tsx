import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, Share2, PenLine, Send, Trash2, Pencil } from "lucide-react";
import { BrandHomeLink } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ZoomFrame } from "@/components/ZoomFrame";
import {
  getDocument,
  renameDocument,
  deleteDocument,
  downloadDocumentPdf,
  listSigningRequests,
  cancelSigningRequest,
  signingLink,
} from "@/lib/docs-api";
import { shareOrDownload, downloadBytes } from "@/lib/image-utils";
import { useDocumentPages } from "./document.$id";

export const Route = createFileRoute("/_authenticated/document/$id/")({
  head: () => ({
    meta: [
      { title: "Document — DocuALL" },
      { name: "description", content: "View, sign, and share this document." },
      { property: "og:title", content: "Document — DocuALL" },
      { property: "og:description", content: "View, sign, and share this document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentDetailPage,
});

function DocumentDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: doc, isLoading } = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id) });
  const { data: pages = [] } = useDocumentPages(id);
  const { data: requests = [] } = useQuery({
    queryKey: ["signing-requests", id],
    queryFn: () => listSigningRequests(id),
  });

  if (isLoading || !doc) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Loading…</div>;
  }

  const pdfName = `${doc.title.replace(/[^\w\- ]+/g, "").trim() || "document"}.pdf`;

  const doDownload = async () => {
    setBusy(true);
    try {
      downloadBytes(await downloadDocumentPdf(doc), pdfName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const doShare = async () => {
    setBusy(true);
    try {
      const bytes = await downloadDocumentPdf(doc);
      const { isAndroidApp, shareSignedPdfAndroid } = await import("@/lib/android-bridge");
      if (await isAndroidApp()) await shareSignedPdfAndroid(bytes, doc.title);
      else await shareOrDownload(bytes, pdfName, doc.title);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share failed");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!window.confirm("Delete this document? This can't be undone.")) return;
    try {
      await deleteDocument(doc.id);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document deleted");
      navigate({ to: "/documents" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const doRename = async () => {
    if (!newTitle.trim()) return;
    try {
      await renameDocument(doc.id, newTitle);
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setRenaming(false);
      toast.success("Renamed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed");
    }
  };

  return (
    <div className="min-h-screen studio-screen pb-8">
      <header className="studio-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/documents" })} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {renaming ? (
          <div className="flex flex-1 items-center gap-2">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="h-8" autoFocus />
            <Button size="sm" onClick={doRename}>Save</Button>
          </div>
        ) : (
          <>
            <BrandHomeLink iconClassName="h-7 w-7 shrink-0 shadow-[0_0_14px_var(--primary)]" />
            <h1 className="min-w-0 flex-1 truncate font-medium text-foreground">{doc.title}</h1>
            <Button variant="ghost" size="icon" onClick={() => { setNewTitle(doc.title); setRenaming(true); }} aria-label="Rename">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={doDelete} aria-label="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        )}
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <Button asChild>
            <Link to="/document/$id/prepare" params={{ id: doc.id }}>
              <PenLine className="mr-2 h-4 w-4" /> Prepare &amp; sign
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/document/$id/send" params={{ id: doc.id }}>
              <Send className="mr-2 h-4 w-4" /> Send for signature
            </Link>
          </Button>
          <Button variant="secondary" onClick={doShare} disabled={busy}>
            <Share2 className="mr-2 h-4 w-4" /> Share
          </Button>
          <Button variant="secondary" onClick={doDownload} disabled={busy}>
            <Download className="mr-2 h-4 w-4" /> Export PDF
          </Button>
        </div>

        {requests.length > 0 && (
          <section className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h2 className="font-display text-sm font-semibold text-foreground">Signature requests</h2>
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate text-foreground">{r.signer_name}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={r.status === "completed" ? "default" : "secondary"}>{r.status}</Badge>
                  {r.status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => {
                          navigator.clipboard.writeText(signingLink(r.token));
                          toast.success("Link copied");
                        }}
                      >
                        Copy link
                      </button>
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={async () => {
                          await cancelSigningRequest(r.id);
                          queryClient.invalidateQueries({ queryKey: ["signing-requests", id] });
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        <div className="space-y-3">
          {pages.map((url, i) => (
            <ZoomFrame key={i} className="overflow-hidden rounded-xl border border-border bg-white">
              <img src={url} alt={`Page ${i + 1}`} className="block w-full" draggable={false} />
            </ZoomFrame>
          ))}
          {pages.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Rendering pages…</p>
          )}
        </div>
      </div>
    </div>
  );
}
