import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, PenLine, Send, ChevronRight } from "lucide-react";
import { BrandIcon } from "@/components/BrandLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DocuALL — Scan it. Sign it. Send it." },
      { name: "description", content: "DocuALL turns your phone into a document scanner: scan or import pages and PDFs, sign them, and share them anywhere." },
      { property: "og:title", content: "DocuALL — Scan it. Sign it. Send it." },
      { property: "og:description", content: "Scan or import pages and PDFs, sign them, and share them anywhere." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Landing,
});

const features = [
  { to: "/scan", icon: ScanLine, title: "Scan or import", body: "Camera, photo library, or existing PDFs — all become clean documents." },
  { to: "/signatures", icon: PenLine, title: "Sign anything", body: "Draw or type your signature once, then drop it on any page." },
  { to: "/documents", icon: Send, title: "Send for signature", body: "Share a link — they sign in their browser, no account needed." },
] as const;

function Landing() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--primary)_28%,transparent),transparent_60%),radial-gradient(ellipse_at_bottom,color-mix(in_oklab,var(--violet-glow)_18%,transparent),transparent_60%)]" />

      <div className="brand-content relative z-10 w-full max-w-md space-y-8 text-center">
        <div>
          <div className="relative mx-auto mb-6 h-40 w-40">
            <div aria-hidden className="brand-pulse absolute inset-0 rounded-full bg-primary/50 blur-3xl" />
            <BrandIcon className="relative block h-40 w-40" />
          </div>
          <h1 className="font-display text-5xl font-bold tracking-tight text-foreground">
            Docu<span className="text-primary">ALL</span>
          </h1>
          <p className="mt-3 text-lg text-foreground">Scan it. Sign it. Send it.</p>
        </div>

        <div className="grid gap-3 text-left">
          {features.map((f) => (
            <Link
              key={f.title}
              to={f.to}
              className="flex min-h-12 items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-4 backdrop-blur-xl transition-colors hover:border-primary active:scale-[0.99]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <f.icon className="h-5 w-5 text-primary" />
              </span>
              <div className="flex-1">
                <p className="font-medium text-foreground">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.body}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-primary" />
            </Link>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">
          No account needed to start.{" "}
          <Link to="/auth" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
