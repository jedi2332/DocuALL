import { BrandIcon } from "@/components/BrandLogo";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string | undefined } => ({
    redirect: typeof search["redirect"] === "string" ? (search["redirect"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — DocuALL" },
      { name: "description", content: "Sign in to DocuALL to scan, sign, and share documents." },
      { property: "og:title", content: "Sign in — DocuALL" },
      { property: "og:description", content: "Sign in to DocuALL to scan, sign, and share documents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  const safeRedirect = redirect?.startsWith("/") && redirect ? redirect : "/documents";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("Check your email for the reset link");
        setMode("signin");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setConfirmSent(true);
        } else {
          navigate({ to: safeRedirect });
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: safeRedirect });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <BrandIcon className="mx-auto mb-3 block h-20 w-20 drop-shadow-[0_0_24px_var(--primary)]" />
          <h1 className="font-display text-3xl font-bold text-foreground">
            Docu<span className="text-primary">ALL</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Scan it. Sign it. Send it.</p>
        </div>

        {confirmSent ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center space-y-2">
            <p className="font-medium text-foreground">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to <span className="text-foreground">{email}</span>. Click it, then come back
              and sign in.
            </p>
            <Button variant="secondary" className="mt-2 w-full" onClick={() => setConfirmSent(false)}>
              Back to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-6">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: window.location.origin,
                });
                if (result.error) {
                  toast.error(result.error.message ?? "Google sign-in failed");
                  setBusy(false);
                  return;
                }
                if (result.redirected) return;
                navigate({ to: safeRedirect });
              }}
              className="flex h-12 w-full items-center justify-center gap-[10px] rounded-md border border-[#747775] bg-[#FFFFFF] px-3 text-[14px] font-medium leading-5 text-[#1F1F1F] disabled:opacity-60"
            >
              <svg aria-hidden="true" width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.140 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.070 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.420C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
              Continue with Google
            </button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              {mode === "signin" ? (
                <>
                  <button type="button" className="text-primary hover:underline" onClick={() => setMode("forgot")}>
                    Forgot password?
                  </button>
                  <button type="button" className="text-primary hover:underline" onClick={() => setMode("signup")}>
                    Create account
                  </button>
                </>
              ) : (
                <button type="button" className="text-primary hover:underline" onClick={() => setMode("signin")}>
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
