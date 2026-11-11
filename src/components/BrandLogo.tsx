import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import icon from "@/assets/docuall_icon.png.asset.json";
import { cn } from "@/lib/utils";

export const brandIconUrl = icon.url;

/** The source art has a black margin around a rounded tile; crop to the tile. */
export function BrandIcon({ className }: { className?: string | undefined }) {
  return (
    <span className={cn("inline-block overflow-hidden rounded-[22%] align-middle", className)}>
      <img src={icon.url} alt="DocuALL" className="h-full w-full scale-[1.24] select-none object-cover" draggable={false} />
    </span>
  );
}

/** The brand in a header. Tapping it returns to the app's home screen. */
export function BrandHomeLink({
  className,
  iconClassName,
  children,
}: {
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      to="/"
      aria-label="DocuALL home"
      title="DocuALL home"
      className={cn("flex shrink-0 items-center gap-2", className)}
    >
      <BrandIcon className={iconClassName} />
      {children}
    </Link>
  );
}
