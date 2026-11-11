import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImagePlus, FileUp, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { DocumentCard } from "@/components/DocumentCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listDocuments, importPdfDocument, createDocumentFromPages, signedUrl } from "@/lib/docs-api";
import { fileToProcessedJpeg } from "@/lib/image-utils";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [
      { title: "Documents — DocuALL" },
      { name: "description", content: "Your scanned and imported documents." },
      { property: "og:title", content: "Documents — DocuALL" },
      { property: "og:description", content: "Your scanned and imported documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const { data: docs = [], isLoading } = useQuery({ queryKey: ["documents"], queryFn: listDocuments });

  const { data: thumbs = {} } = useQuery({
    queryKey: ["thumbs", docs.map((d) => d.thumbnail_path).join(",")],
    enabled: docs.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        docs
          .filter((d) => d.thumbnail_path)
          .map(async (d) => {
            try {
              out[d.id] = await signedUrl("documents", d.thumbnail_path!);
            } catch {
              /* no thumb */
            }
          }),
      );
      return out;
    },
  });

  const filtered = docs.filter((d) => d.title.toLowerCase().includes(search.toLowerCase()));

  const onPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setImporting(true);
    try {
      const pages: Uint8Array[] = [];
      for (const file of Array.from(files)) {
        pages.push(await fileToProcessedJpeg(file, { enhance: true }));
      }
      const doc = await createDocumentFromPages(pages);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document created");
      navigate({ to: "/document/$id", params: { id: doc.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  };

  const onPdf = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const doc = await importPdfDocument(file);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("PDF imported");
      navigate({ to: "/document/$id", params: { id: doc.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
      if (pdfInput.current) pdfInput.current.value = "";
    }
  };

  return (
    <AppShell title="Documents">
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search documents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => photoInput.current?.click()} disabled={importing}>
            <ImagePlus className="mr-2 h-4 w-4" /> Import photos
          </Button>
          <Button variant="secondary" onClick={() => pdfInput.current?.click()} disabled={importing}>
            <FileUp className="mr-2 h-4 w-4" /> Import PDF
          </Button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPhotos(e.target.files)} />
        <input ref={pdfInput} type="file" accept="application/pdf" className="hidden" onChange={(e) => onPdf(e.target.files)} />

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-medium text-foreground">{search ? "No matches" : "No documents yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? "Try a different search." : "Tap the Scan button below, or import photos or a PDF."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} thumbUrl={thumbs[doc.id]} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
