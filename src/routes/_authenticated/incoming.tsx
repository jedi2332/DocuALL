import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, ImageIcon, AlertTriangle, PenLine, X } from "lucide-react";
import { BrandHomeLink } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { classifyIncoming, planImports, type IncomingVerdict } from "@/lib/android-intake";
import { clearPendingIncoming, getPendingIncoming, onIncoming, readPendingFile } from "@/lib/android-bridge";
import { importPdfDocument, createDocumentFromPages, type DocumentRow } from "@/lib/docs-api";
import { fileToProcessedJpeg } from "@/lib/image-utils";

export const Route = createFileRoute("/_authenticated/incoming")({
  head: () => ({
    meta: [
      { title: "Open in DocuALL" },
      { name: "description", content: "Import a document shared from another app." },
      { property: "og:title", content: "Open in DocuALL" },
      { property: "og:description", content: "Import a document shared from another app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IncomingPage,
});

interface Item {
  path: string | null;
  bytes: Uint8Array | null;
  verdict: IncomingVerdict;
}

type Phase = "loading" | "review" | "importing" | "done" | "empty";

function IncomingPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<Item[]>([]);
  const [created, setCreated] = useState<DocumentRow[]>([]);
  const [failed, setFailed] = useState<string[]>([]);

  const load = async () => {
    setPhase("loading");
    const pending = await getPendingIncoming().catch(() => []);
    const out: Item[] = [];
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i]!;
      let bytes: Uint8Array | null = null;
      if (f.path && !f.error) {
        try {
          bytes = await readPendingFile(f.path);
        } catch {
          out.push({ path: f.path, bytes: null, verdict: classifyIncoming({ ...f, error: "unreadable" }, undefined, i) });
          continue;
        }
      }
      out.push({ path: f.path ?? null, bytes, verdict: classifyIncoming(f, bytes ?? undefined, i) });
    }
    setItems(out);
    setPhase(out.length ? "review" : "empty");
  };

  useEffect(() => {
    load();
    let off = () => {};
    onIncoming(load).then((fn) => (off = fn));
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { imports, rejected } = planImports(items);

  const cancel = async () => {
    await clearPendingIncoming().catch(() => {});
    navigate({ to: "/documents" });
  };

  const doImport = async () => {
    setPhase("importing");
    const docs: DocumentRow[] = [];
    const errs: string[] = [];
    for (const imp of imports) {
      try {
        if (imp.kind === "pdf") {
          const it = imp.files[0]!;
          const file = new File([it.bytes!.buffer as ArrayBuffer], it.verdict.name, { type: "application/pdf" });
          docs.push(await importPdfDocument(file, imp.title));
        } else {
          const pages: Uint8Array[] = [];
          for (const it of imp.files) pages.push(await fileToProcessedJpeg(new Blob([it.bytes!.buffer as ArrayBuffer]), { enhance: false }));
          docs.push(await createDocumentFromPages(pages, imp.title));
        }
      } catch {
        errs.push(imp.title);
      }
    }
    await clearPendingIncoming().catch(() => {});
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    setCreated(docs);
    setFailed(errs);
    setPhase("done");
  };

  return (
    <div className="min-h-screen studio-screen pb-8">
      <header className="studio-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <BrandHomeLink iconClassName="h-7 w-7 shrink-0 shadow-[0_0_14px_var(--primary)]" />
        <h1 className="flex-1 font-medium text-foreground">Open in DocuALL</h1>
        {phase === "review" && (
          <Button variant="ghost" size="icon" onClick={cancel} aria-label="Cancel">
            <X className="h-5 w-5" />
          </Button>
        )}
      </header>

      <div className="mx-auto max-w-xl space-y-3 px-4 pt-4">
        {phase === "loading" && <p className="py-12 text-center text-sm text-muted-foreground">Reading attachment…</p>}
        {phase === "importing" && <p className="py-12 text-center text-sm text-muted-foreground">Importing…</p>}

        {phase === "empty" && (
          <div className="py-12 text-center">
            <p className="font-medium text-foreground">Nothing to open</p>
            <p className="mt-1 text-sm text-muted-foreground">No file came through from the other app.</p>
            <Button className="mt-4" asChild>
              <Link to="/documents">Go to documents</Link>
            </Button>
          </div>
        )}

        {phase === "review" && (
          <>
            {imports.map((imp) => (
              <div key={imp.title + imp.files.length} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                {imp.kind === "pdf" ? <FileText className="h-6 w-6 text-primary" /> : <ImageIcon className="h-6 w-6 text-primary" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{imp.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {imp.kind === "pdf" ? "PDF" : `${imp.files.length} photo${imp.files.length > 1 ? "s" : ""} → one document`}
                  </p>
                </div>
              </div>
            ))}
            {rejected.map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-destructive/40 bg-card p-3">
                <AlertTriangle className="h-6 w-6 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{r.verdict.name}</p>
                  <p className="text-xs text-muted-foreground">{!r.verdict.ok && r.verdict.reason}</p>
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button variant="secondary" size="lg" onClick={cancel}>Cancel</Button>
              <Button size="lg" onClick={doImport} disabled={imports.length === 0}>
                Import {imports.length > 1 ? `${imports.length} documents` : ""}
              </Button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            {created.map((d) => (
              <div key={d.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                <p className="font-medium text-foreground">{d.title}</p>
                <p className="text-xs text-muted-foreground">{d.page_count} page{d.page_count === 1 ? "" : "s"} imported</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" asChild>
                    <Link to="/document/$id" params={{ id: d.id }}>View</Link>
                  </Button>
                  <Button asChild>
                    <Link to="/document/$id/prepare" params={{ id: d.id }}>
                      <PenLine className="mr-2 h-4 w-4" /> Prepare &amp; sign
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {failed.map((t) => (
              <p key={t} className="text-sm text-destructive">Couldn't import "{t}". The file may be damaged or password-protected.</p>
            ))}
            {created.length === 0 && (
              <Button className="w-full" asChild>
                <Link to="/documents">Go to documents</Link>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
