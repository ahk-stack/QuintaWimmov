import Image from "next/image";
import Link from "next/link";

import type { Person } from "@/lib/types";

import { IdentityMenu, IdentityPrompt, IdentityProvider } from "./identity";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/chat", label: "Chat" },
  { href: "/news", label: "News" },
] as const;

/**
 * Application chrome: a white nav carrying the real Quinta wordmark, and the
 * brand's black footer bar. The logo files are locked assets, used at their
 * native aspect ratio and never recoloured.
 */
export function AppShell({
  people,
  children,
}: {
  people: Person[];
  children: React.ReactNode;
}) {
  return (
    <IdentityProvider people={people}>
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        {/*
          Wraps rather than scrolls. Inline on one row the logo and identity
          control squeeze the nav to a sliver on a phone, leaving only the first
          item reachable, so below `sm` the nav drops to its own full-width row.
        */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link
            href="/"
            className="flex shrink-0 items-baseline gap-3"
            aria-label="Quinta Lead Hub, home"
          >
            <Image
              src="/brand/quinta-wordmark-black.svg"
              alt="Quinta"
              width={286}
              height={88}
              priority
              className="h-5 w-auto"
            />
            <span className="hidden border-l border-line-strong pl-3 text-sm font-bold sm:inline">
              Lead Hub
            </span>
          </Link>

          <nav className="order-last flex w-full min-w-0 items-center gap-1 overflow-x-auto sm:order-none sm:w-auto sm:flex-1">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* ml-auto pins the control right on the wrapped mobile row, where
              the nav is no longer between it and the logo. */}
          <div className="ml-auto sm:ml-0">
            <IdentityMenu />
          </div>
        </div>
      </header>

      <IdentityPrompt />

      <div className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-6 py-12">{children}</div>
      </div>

      <footer className="mt-auto bg-ink text-paper">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <Image
            src="/brand/quinta-wordmark-white.svg"
            alt="Quinta"
            width={286}
            height={88}
            className="h-4 w-auto"
          />
          <p className="text-xs text-paper/60">
            Internal tool. Contains prospect contact data, so keep the link
            inside Quinta.
          </p>
        </div>
      </footer>
    </IdentityProvider>
  );
}
