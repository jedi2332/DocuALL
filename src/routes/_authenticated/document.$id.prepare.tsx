import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Wand2 } from "lucide-react";
import { BrandHomeLink } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { FieldPlacer } from "@/components/FieldPlacer";
import { getDocument, applyFieldsToDocument, listSignatures, getProfile } from "@/lib/docs-api";
import { useDocumentPages } from "./document.$id";
import type { FieldPlacement } from "@/lib/docuall-types";

export const Route = createFileRoute("/_authenticated/document/$id/prepare")({
  head: () => ({
    meta: [
      { title: "Prepare & sign — DocuALL" },
      { name: "description", content: "Place signature, initials, date, and text fields on your document." },
      { property: "og:title", content: "Prepare & sign — DocuALL" },
      { property: "og:description", content: "Place signature, initials, date, and text fields on your document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PreparePage,
});

const PROFILE_KEYS: [string, keyof ProfileValues][] = [
  ["name", "full_name"],
  ["full name", "full_name"],
  ["email", "email"],
  ["phone", "phone"],
  ["address", "address"],
  ["city", "city"],
  ["state", "state"],
  ["zip", "zip_code"],
  ["zip code", "zip_code"],
  ["employer", "employer"],
];

interface ProfileValues {
  full_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  employer: string;
}

function PreparePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<FieldPlacement[]>([]);
  const [applying, setApplying] = useState(false);

  const { data: doc } = useQuery({ queryKey: ["document", id], queryFn: () => getDocument(id) });
  const { data: pages = [], isLoading } = useDocumentPages(id);
  const { data: sigs = [] } = useQuery({ queryKey: ["signatures"], queryFn: listSignatures });
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });

  const autoFill = () => {
    if (!profile) return;
    const values: ProfileValues = {
      full_name: profile.full_name,
      email: "",
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      state: profile.state,
      zip_code: profile.zip_code,
      employer: profile.employer,
    };
    let matched = 0;
    const next = fields.map((f) => {
      if (f.type !== "text") return f;
      const label = (f.text || f.label || "").trim().toLowerCase();
      if (!label) return f;
      const hit = PROFILE_KEYS.find(([key]) => label.includes(key));
      const value = hit ? values[hit[1]] : "";
      if (value) {
        matched++;
        return { ...f, text: value };
      }
      return f;
    });
    if (matched > 0) {
      setFields(next);
      toast.success(`Filled ${matched} field${matched === 1 ? "" : "s"} from your profile`);
    } else {
      toast.error("No fields matched. Label text fields things like name, phone, or address.");
    }
  };

  const apply = async () => {
    if (!doc) return;
    if (fields.length === 0) {
      toast.error("Add at least one field first");
      return;
    }
    const missingSig = fields.some((f) => (f.type === "signature" || f.type === "initials") && !f.signatureId);
    if (missingSig) {
      toast.error("Pick a saved signature for every signature/initials field");
      return;
    }
    setApplying(true);
    try {
      await applyFieldsToDocument(doc, fields);
      queryClient.invalidateQueries({ queryKey: ["document", id] });
      queryClient.invalidateQueries({ queryKey: ["doc-pages", id] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Fields applied");
      navigate({ to: "/document/$id", params: { id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
      setApplying(false);
    }
  };

  return (
    <div className="min-h-screen studio-screen pb-8">
      <header className="studio-header sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/document/$id", params: { id } })} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <BrandHomeLink iconClassName="h-7 w-7 shrink-0 shadow-[0_0_14px_var(--primary)]" />
        <h1 className="flex-1 font-medium text-foreground">Prepare &amp; sign</h1>
        <Button variant="ghost" size="icon" onClick={autoFill} aria-label="Auto-fill from profile" title="Auto-fill from profile">
          <Wand2 className="h-4 w-4 text-cyan-glow" />
        </Button>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {sigs.length === 0 && (
          <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
            No saved signatures yet — add one in the Signatures tab, then come back to place it.
          </p>
        )}

        {isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Rendering pages…</p>
        ) : (
          <FieldPlacer
            pages={pages}
            fields={fields}
            onChange={setFields}
            renderSelectedExtra={(field, update) =>
              field.type === "signature" || field.type === "initials" ? (
                <select
                  className="h-8 min-w-32 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={field.signatureId ?? ""}
                  onChange={(e) => update({ signatureId: e.target.value })}
                >
                  <option value="">Pick signature…</option>
                  {sigs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.kind === "type" ? "Typed" : "Drawn"} · {new Date(s.created_at).toLocaleDateString("en-US")}
                    </option>
                  ))}
                </select>
              ) : null
            }
          />
        )}

        <Button className="w-full" size="lg" onClick={apply} disabled={applying || fields.length === 0}>
          {applying ? "Applying…" : `Apply ${fields.length || ""} field${fields.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
