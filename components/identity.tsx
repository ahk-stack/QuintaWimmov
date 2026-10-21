"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState } from "react";

import { ROLE_LABEL } from "@/lib/status";
import type { Person } from "@/lib/types";

import { Avatar } from "./ui";

/**
 * The signed-in person, handed down from the server.
 *
 * The hub layout resolves the session and passes the person in; nothing here
 * reads a cookie or storage. Components use it to decide what to SHOW — the
 * server re-checks the session on every request, so nothing is allowed on the
 * strength of this value.
 */

interface IdentityContextValue {
  people: Person[];
  current: Person;
  /** Always true now; kept so components written for the old picker still read naturally. */
  ready: true;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({
  people,
  me,
  children,
}: {
  people: Person[];
  me: Person;
  children: React.ReactNode;
}) {
  const value = useMemo<IdentityContextValue>(
    () => ({ people, current: me, ready: true }),
    [people, me],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used inside an IdentityProvider");
  }
  return context;
}

/** Nav control: who is signed in, the admin link for admins, and sign out. */
export function UserMenu() {
  const { current } = useIdentity();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      // Only leave once the server has ended the session; otherwise the login
      // page would bounce a still-signed-in person straight back here.
      if (response.ok) {
        router.replace("/login");
        router.refresh();
        return;
      }
      setSignOutError("Could not sign out. Try again.");
    } catch {
      setSignOutError("Could not reach the server. Try again.");
    }
    setSigningOut(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-line-strong py-1 pr-3 pl-1 text-sm font-bold hover:bg-surface"
      >
        <Avatar person={current} size="sm" />
        <span className="max-w-32 truncate">{current.name}</span>
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="truncate text-sm font-bold">{current.name}</p>
              <p className="text-xs text-muted">
                {ROLE_LABEL[current.role]}
                {current.territory ? ` · ${current.territory}` : ""}
              </p>
            </div>
            {current.role === "admin" ? (
              <Link
                href="/admin/users"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block px-4 py-2 text-sm hover:bg-surface"
              >
                Manage users
              </Link>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={signingOut}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-surface disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            {signOutError ? (
              <p role="alert" className="px-4 pb-3 text-xs text-status-lost">
                {signOutError}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
