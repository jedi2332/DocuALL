import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SignaturePad } from "@/components/SignaturePad";
import { Button } from "@/components/ui/button";
import { listSignatures, createSignature, deleteSignature, signedUrl, type SignatureRow } from "@/lib/docs-api";

export const Route = createFileRoute("/_authenticated/signatures")({
  head: () => ({
    meta: [
      { title: "Signatures — DocuALL" },
      { name: "description", content: "Your saved signatures." },
      { property: "og:title", content: "Signatures — DocuALL" },
      { property: "og:description", content: "Your saved signatures." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignaturesPage,
});

function SignaturesPage() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: sigs = [], isLoading } = useQuery({ queryKey: ["signatures"], queryFn: listSignatures });

  const { data: urls = {} } = useQuery({
    queryKey: ["signature-urls", sigs.map((s) => s.id).join(",")],
    enabled: sigs.length > 0,
    queryFn: async () => {
      const out: Record<string, string> = {};
      await Promise.all(
        sigs.map(async (s) => {
          try {
            out[s.id] = await signedUrl("signatures", s.image_path);
          } catch {
            /* skip */
          }
        }),
      );
      return out;
    },
  });

  const onSave = async (kind: "draw" | "type", pngBytes: Uint8Array) => {
    setSaving(true);
    try {
      await createSignature(kind, pngBytes);
      queryClient.invalidateQueries({ queryKey: ["signatures"] });
      toast.success("Signature saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (sig: SignatureRow) => {
    try {
      await deleteSignature(sig);
      queryClient.invalidateQueries({ queryKey: ["signatures"] });
      toast.success("Signature deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <AppShell title="Signatures">
      <div className="space-y-6">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-display text-lg font-semibold text-foreground">New signature</h2>
          <SignaturePad onSave={onSave} saving={saving} />
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-foreground">Saved signatures</h2>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : sigs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              None yet — draw or type one above and it'll be ready to drop on any document.
            </p>
          ) : (
            <div className="space-y-2">
              {sigs.map((sig) => (
                <div key={sig.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                  <div className="flex h-14 flex-1 items-center justify-center rounded-md bg-white px-3">
                    {urls[sig.id] ? (
                      <img src={urls[sig.id]} alt="Signature" className="max-h-12 max-w-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">…</span>
                    )}
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">{sig.kind}</span>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(sig)} aria-label="Delete signature">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
