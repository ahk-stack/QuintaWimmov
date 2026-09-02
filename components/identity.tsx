"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { ROLE_LABEL } from "@/lib/status";
import type { Person } from "@/lib/types";

import { Avatar } from "./ui";

/**
 * "Who am I" without a sign-in.
 *
 * The chosen person is an attribution label so leads and messages have an
 * author. It is stored in localStorage and sent with mutations, and it must
 * never be treated as proof of anything: anyone can pick any name. Every
 * server-side check has to assume the value was chosen freely.
 */

const STORAGE_KEY = "leadhub.identity";

/*
 * localStorage is an external system, so it is read through
 * useSyncExternalStore rather than mirrored into state by an effect. That keeps
 * the value correct after hydration without a cascading re-render, and makes
 * the choice track across browser tabs.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Fires when another tab writes the key.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing or blocked storage: behave as if nothing is stored.
    return null;
  }
}

/*
 * Identity is mirrored into a cookie as well as localStorage.
 *
 * localStorage is invisible to the server, and server components need to know
 * who is looking in order to render "my direct messages" without exposing an
 * endpoint that would let anyone enumerate another person's conversations.
 *
 * Not httpOnly and not Secure-only, because the client sets it. It is still an
 * attribution label, not a credential: anyone can edit a cookie, exactly as
 * anyone can pick any name from the roster. Nothing may be authorised from it.
 */
const COOKIE_KEY = "leadhub_identity";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function writeStoredId(id: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal; the choice simply will not survive a reload.
  }
  try {
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(id)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } catch {
    // Blocked cookies only cost server-side personalisation, not the app.
  }
  // The storage event does not fire in the tab that wrote, so notify directly.
  for (const listener of listeners) listener();
}

/** null on the server and during the hydration render. */
function serverStoredId(): null {
  return null;
}

const alwaysTrue = () => true;
const alwaysFalse = () => false;
const noopSubscribe = () => () => {};

interface IdentityContextValue {
  people: Person[];
  current: Person | null;
  /** False during server render and hydration, so the UI can avoid flicker. */
  ready: boolean;
  select: (id: string) => void;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({
  people,
  children,
}: {
  people: Person[];
  children: React.ReactNode;
}) {
  const storedId = useSyncExternalStore(
    subscribe,
    readStoredId,
    serverStoredId,
  );
  const ready = useSyncExternalStore(noopSubscribe, alwaysTrue, alwaysFalse);

  const select = useCallback((id: string) => writeStoredId(id), []);

  const value = useMemo<IdentityContextValue>(() => {
    // Resolving against the roster also discards an id that no longer exists.
    const current = people.find((p) => p.id === storedId) ?? null;
    if (ready) syncCookie(current?.id ?? null);
    return { people, current, ready, select };
  }, [people, storedId, ready, select]);

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

/**
 * Backfills the cookie for anyone whose identity predates it, and clears it when
 * the stored id no longer matches the roster.
 */
function syncCookie(resolvedId: string | null): void {
  try {
    if (resolvedId) {
      document.cookie = `${COOKIE_KEY}=${encodeURIComponent(resolvedId)}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
    } else {
      document.cookie = `${COOKIE_KEY}=; path=/; max-age=0; SameSite=Lax`;
    }
  } catch {
    // Non-fatal.
  }
}

export function useIdentity(): IdentityContextValue {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used inside an IdentityProvider");
  }
  return context;
}

/** Nav control: shows the current person and opens the roster to switch. */
export function IdentityMenu() {
  const { people, current, ready, select } = useIdentity();
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const order: Person["role"][] = ["sales", "consultant", "admin"];
    return order
      .map((role) => ({
        role,
        members: people.filter((p) => p.active && p.role === role),
      }))
      .filter((group) => group.members.length > 0);
  }, [people]);

  // Reserve the footprint before hydration so the nav does not jump.
  if (!ready) {
    return <span className="inline-block h-8 w-32" aria-hidden />;
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
        <span className="max-w-32 truncate">
          {current ? current.name : "Who are you?"}
        </span>
      </button>

      {open ? (
        <>
          {/* Click-away layer. */}
          <button
            type="button"
            aria-label="Close roster"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
          >
            <p className="border-b border-line px-4 py-3 text-xs text-muted">
              This labels your leads and messages. There are no passwords.
            </p>
            <div className="max-h-80 overflow-y-auto py-1">
              {grouped.map((group) => (
                <div key={group.role}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold tracking-[0.16em] text-muted uppercase">
                    {ROLE_LABEL[group.role]}
                  </p>
                  {group.members.map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        select(person.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface ${
                        person.id === current?.id ? "font-bold" : ""
                      }`}
                    >
                      <Avatar person={person} size="sm" />
                      <span className="min-w-0 flex-1 truncate">
                        {person.name}
                      </span>
                      {person.territory ? (
                        <span className="text-xs text-muted">
                          {person.territory}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Banner shown until someone picks a name. Without it, a first-time visitor can
 * fill in a lead form and only discover the problem on submit.
 */
export function IdentityPrompt() {
  const { current, ready } = useIdentity();
  if (!ready || current) return null;
  return (
    <div className="border-b border-line bg-surface px-6 py-3">
      <p className="mx-auto max-w-6xl text-sm">
        <span className="font-bold">Pick your name</span>
        <span className="text-muted">
          {" "}
          in the top right so your leads and messages are attributed to you.
        </span>
      </p>
    </div>
  );
}
