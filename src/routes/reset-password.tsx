import { BrandIcon } from "@/components/BrandLogo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — DocuALL" },
      { name: "description", content: "Choose a new DocuALL password." },
      { property: "og:title", content: "Reset password — DocuALL" },
      { property: "og:description", content: "Choose a new DocuALL password." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Recovery links arrive with type=recovery in the URL hash; the supabase
    // client exchanges it for a session automatically.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get("type") === "recovery") {
      setReady(true);
    } else {
      supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/documents" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <BrandIcon className="mx-auto block h-16 w-16" />
        <h1 className="text-center font-display text-2xl font-bold text-foreground">Choose a new password</h1>
        {ready ? (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            This reset link is invalid or has expired. Request a new one from the sign-in page.
          </div>
        )}
      </div>
    </div>
  );
}
