import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

/** Turns a guest session into a real account, keeping everything already made. */
export function SaveAccountCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ email, password });
      if (error) throw error;
      toast.success("Check your email to confirm — your documents are kept.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-xl border border-primary/50 bg-card p-4">
      <h2 className="font-display text-lg font-semibold text-foreground">Save your work</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You're using DocuALL as a guest. Add an email and password to keep your documents and signatures.
      </p>
      <div className="mt-4 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="save-email">Email</Label>
          <Input id="save-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="save-pw">Password</Label>
          <Input id="save-pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="h-12 w-full" disabled={busy}>
          {busy ? "Saving…" : "Save my account"}
        </Button>
      </div>
    </form>
  );
}
