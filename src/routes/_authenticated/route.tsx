import { createFileRoute, redirect, Outlet } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Anyone can use the app right away: visitors without an account get a private
// guest session. They only create an account when they want to keep their work.
export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) return;
    const { error } = await supabase.auth.signInAnonymously();
    if (error) throw redirect({ to: "/auth", search: { redirect: location.href } });
  },
  component: () => <Outlet />,
});
