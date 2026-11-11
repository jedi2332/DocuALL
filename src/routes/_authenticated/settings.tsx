import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProfile, updateProfile } from "@/lib/docs-api";
import { supabase } from "@/integrations/supabase/client";
import { SaveAccountCard } from "@/components/SaveAccountCard";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DocuALL" },
      { name: "description", content: "Your DocuALL profile and account settings." },
      { property: "og:title", content: "Settings — DocuALL" },
      { property: "og:description", content: "Your DocuALL profile and account settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

const FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "phone", label: "Phone" },
  { key: "address", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip_code", label: "ZIP code" },
  { key: "employer", label: "Employer" },
] as const;

function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: getProfile });

  useEffect(() => {
    if (profile) {
      setValues({
        full_name: profile.full_name,
        phone: profile.phone,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zip_code: profile.zip_code,
        employer: profile.employer,
      });
    }
  }, [profile]);

  const [isGuest, setIsGuest] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setIsGuest(!!data.user?.is_anonymous);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile(values);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <AppShell title="Settings">
      <div className="space-y-6">
        {isGuest ? (
          <SaveAccountCard />
        ) : (
          <section className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-display text-lg font-semibold text-foreground">Account</h2>
            <p className="mt-1 text-sm text-muted-foreground">{email}</p>
            <Button variant="secondary" className="mt-4" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-semibold text-foreground">Your details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used to auto-fill forms when you sign documents.
          </p>
          <div className="mt-4 space-y-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <Button className="w-full" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save details"}
            </Button>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
