import { Link } from "@tanstack/react-router";
import { FileText, FileUp } from "lucide-react";
import type { DocumentRow } from "@/lib/docs-api";

export function DocumentCard({ doc, thumbUrl }: { doc: DocumentRow; thumbUrl?: string | undefined }) {
  return (
    <Link
      to="/document/$id"
      params={{ id: doc.id }}
      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/50"
    >
      <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : doc.kind === "imported" ? (
          <FileUp className="h-5 w-5 text-muted-foreground" />
        ) : (
          <FileText className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{doc.title}</p>
        <p className="text-xs text-muted-foreground">
          {doc.page_count} {doc.page_count === 1 ? "page" : "pages"} ·{" "}
          {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>
      </div>
    </Link>
  );
}
