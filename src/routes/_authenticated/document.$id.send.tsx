import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Copy, Share2 } from "lucide-react";
import { BrandHomeLink } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldPlacer } from "@/components/FieldPlacer";
import { getDocument, createSigningRequest, signingLink } from "@/lib/docs-api";
import { useDocumentPages } from "./document.$id";
import type { FieldPlacement } from "@/lib/docuall-types";

export const Route = createFileRoute("/_authenticated/document/$id/send")({
  head: () => ({
    meta: [
      { title: "Send for signature — DocuALL" },
      { name: "description", content: "Place blank fields and send a signing link." },
      { property: "og:title", content: "Send for signature — DocuALL" },
      { property: "og:description", content: "Place blank fields and send a signing link." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SendPage,
});

function SendPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signerName, setSignerName] = useState("");
  const [fields, setFields] = useState<FieldPlacement[]>([]);
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const { data: doc } = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id) });
  const { data: pages = [], isLoading } = useDocumentPages(id);

  const create = async () => {
    if (!doc) return;
    if (!signerName.trim()) {
      toast.error("Who's signing? Add their name.");
      return;
    }
    if (fields.length === 0) {
      toast.error("Place at least one field for them to fill");
      return;
    }
    setCreating(true);
    try {
      const req = await createSigningRequest(doc.id, signerName, fields);
      queryClient.invalidateQueries({ queryKey: ["signing-requests", id] });
      setLink(signingLink(req.token));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create link");
    } finally {
      setCreating(false);
    }
  };

  const shareLink = async () => {
    if (!link) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Sign: ${doc?.title ?? "document"}`, url: link });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
      }
    }
    await navigator.clipboard.writeText(link);
    toast.success("Link copied");
  };

  return (
    <div className="min-h-screen studio-screen pb-8">
      <header className="studio-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/document/$id", params: { id } })} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <BrandHomeLink iconClassName="h-7 w-7 shrink-0 shadow-[0_0_14px_var(--primary)]" />
        <h1 className="flex-1 font-medium text-foreground">Send for signature</h1>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {link ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-6 text-center">
            <p className="font-display text-lg font-semibold text-foreground">Link ready for {signerName}</p>
            <p className="break-all rounded-lg bg-secondary p-3 text-sm text-muted-foreground">{link}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  toast.success("Link copied");
                }}
              >
                <Copy className="mr-2 h-4 w-4" /> Copy
              </Button>
              <Button onClick={shareLink}>
                <Share2 className="mr-2 h-4 w-4" /> Share
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              They open the link in any browser — no account or app needed. The document updates when they submit.
            </p>
            <Button variant="ghost" onClick={() => navigate({ to: "/document/$id", params: { id } })}>
              Back to document
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="signer">Who's signing?</Label>
              <Input
                id="signer"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Their name"
                maxLength={80}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              Place blank fields where they should sign, initial, date, or write. Drag to move, tap a field to label it.
            </p>

            {isLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Rendering pages…</p>
            ) : (
              <FieldPlacer pages={pages} fields={fields} onChange={setFields} />
            )}

            <Button className="w-full" size="lg" onClick={create} disabled={creating}>
              {creating ? "Creating link…" : "Send link to sign"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
