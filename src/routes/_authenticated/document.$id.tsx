import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDocument, signedUrl } from "@/lib/docs-api";
import { renderPdfPages } from "@/lib/pdf-render";

export const Route = createFileRoute("/_authenticated/document/$id")({
  component: () => <Outlet />,
});

/** Page images for display: stored page images for scans, rendered PDF pages for imports. */
export function useDocumentPages(docId: string) {
  return useQuery({
    queryKey: ["doc-pages", docId],
    queryFn: async () => {
      const doc = await getDocument(docId);
      const pagePaths = Array.isArray(doc.page_paths) ? (doc.page_paths as string[]) : [];
      if (pagePaths.length > 0) {
        return Promise.all(pagePaths.map((p) => signedUrl("documents", p)));
      }
      if (doc.pdf_path) {
        const url = await signedUrl("documents", doc.pdf_path);
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const rendered = await renderPdfPages(bytes);
        return rendered.map((r) => r.dataUrl);
      }
      return [];
    },
  });
}
