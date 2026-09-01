"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Nav item that marks the active section. Monochrome, so the current page is
 * indicated by weight plus an underline rather than a colour change.
 */
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // "/" must match exactly; every other section also matches its subpages.
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
        active
          ? "bg-surface font-bold underline decoration-2 underline-offset-4"
          : "text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
