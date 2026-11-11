import { Link, useRouterState } from "@tanstack/react-router";
import { FileText, ScanLine, PenLine, Settings, FolderTree } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BrandHomeLink } from "@/components/BrandLogo";

const tabs = [
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/scan", label: "Scan", icon: ScanLine },
  { to: "/signatures", label: "Signatures", icon: PenLine },
  { to: "/organize", label: "Organize", icon: FolderTree },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <BrandHomeLink
            iconClassName="h-8 w-8"
            className="font-display text-lg font-bold tracking-tight text-foreground"
          >
            Docu<span className="text-primary">ALL</span>
          </BrandHomeLink>
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-5">
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.to);
            const Icon = tab.icon;
            if (tab.to === "/scan") {
              return (
                <Link key={tab.to} to={tab.to} className="flex flex-col items-center gap-1 py-2">
                  <span className="flex h-12 w-12 -translate-y-3 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/40">
                    <Icon className="h-6 w-6 text-primary-foreground" />
                  </span>
                  <span className="-mt-2 text-[11px] font-medium text-muted-foreground">{tab.label}</span>
                </Link>
              );
            }
            return (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn(
                  "flex flex-col items-center gap-1 py-3",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
