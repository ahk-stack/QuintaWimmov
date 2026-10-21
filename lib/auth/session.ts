import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuthStore, storeKind } from "../db";
import type { Person } from "../types";

/**
 * Server-side sessions.
 *
 * The cookie holds 32 random bytes and nothing else. The database holds only
 * their SHA-256, so neither a stolen cookie jar nor a read of the sessions
 * table on its own is enough to forge the other. Every request re-checks the
 * session against the database: nothing is trusted from the cookie except as a
 * lookup key, and revoking a session takes effect on the very next request.
 */

/** Hard limit from sign-in. Never extended. */
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Signed out after this long without real activity. */
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
/** Activity is written at most this often, to keep page loads to one read. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
/** How recently an admin must have re-entered their password to change accounts. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/**
 * Secure cookies need HTTPS, which production has. `AUTH_INSECURE_COOKIES` is
 * an escape hatch for an internal deployment served over plain HTTP, where the
 * browser would otherwise silently drop the cookie and sign-in would loop.
 */
function secureCookies(): boolean {
  return process.env.NODE_ENV === "production" && process.env.AUTH_INSECURE_COOKIES !== "true";
}

/*
 * `__Host-` makes the browser refuse the cookie unless it is Secure, has
 * Path=/ and no Domain — so a sibling subdomain cannot plant or widen it. It
 * requires HTTPS, hence the plain name in development.
 */
function cookieName(): string {
  return secureCookies() ? "__Host-leadhub_session" : "leadhub_session";
}

/** 32 bytes, base64url: exactly 43 characters from this alphabet. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CurrentSession {
  sessionId: string;
  person: Person;
  createdAt: string;
  reauthenticatedAt: string;
}

async function presentedToken(): Promise<string | null> {
  const value = (await cookies()).get(cookieName())?.value;
  return value && TOKEN_PATTERN.test(value) ? value : null;
}

/**
 * Resolves the session behind the cookie, or null.
 *
 * `touch` records activity for the idle limit. Background polling passes
 * false, so a tab left open is still signed out when nobody is using it.
 */
async function resolve(touch: boolean): Promise<CurrentSession | null> {
  if (storeKind() === "unconfigured") return null;
  const token = await presentedToken();
  if (!token) return null;

  const found = await getAuthStore().findSession(hashToken(token));
  if (!found) return null;

  const { session, person } = found;
  const now = Date.now();
  if (Date.parse(session.expiresAt) <= now) return null;
  if (Date.parse(session.lastSeenAt) <= now - SESSION_IDLE_MS) return null;
  // Deleting someone removes their sessions; this covers any race with that.
  if (!person.active) return null;

  if (touch && Date.parse(session.lastSeenAt) <= now - TOUCH_INTERVAL_MS) {
    await getAuthStore().touchSession(session.id);
  }

  return {
    sessionId: session.id,
    person,
    createdAt: session.createdAt,
    reauthenticatedAt: session.reauthenticatedAt,
  };
}

/**
 * The signed-in person for this render, or null.
 *
 * Wrapped in React `cache`, so a layout and its page share one lookup. That
 * memo lasts one render pass only; route handlers call `sessionForRequest`.
 */
export const getSession = cache(() => resolve(true));

/** For route handlers. Background polls pass `touch: false`. */
export function sessionForRequest(options: { touch?: boolean } = {}): Promise<CurrentSession | null> {
  return resolve(options.touch ?? true);
}

/** For pages: the signed-in person, or a redirect to the sign-in screen. */
export async function requireUser(): Promise<CurrentSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export function isRecentlyReauthenticated(session: CurrentSession): boolean {
  return Date.parse(session.reauthenticatedAt) > Date.now() - REAUTH_WINDOW_MS;
}

/**
 * Starts a session for someone who has just proved their password.
 *
 * Always a brand-new token. Any session the browser presented is ended first,
 * never adopted, so a token planted before sign-in (session fixation) is
 * worthless afterwards.
 */
export async function startSession(personId: string): Promise<void> {
  const store = getAuthStore();
  const jar = await cookies();

  const previous = jar.get(cookieName())?.value;
  if (previous && TOKEN_PATTERN.test(previous)) {
    await store.deleteSession(hashToken(previous));
  }

  // Opportunistic cleanup, so the table cannot grow without a scheduled job.
  await store.deleteStaleSessions(new Date(Date.now() - SESSION_IDLE_MS).toISOString());

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
  await store.createSession({
    tokenHash: hashToken(token),
    personId,
    expiresAt: expiresAt.toISOString(),
  });

  jar.set(cookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Ends the session behind the cookie, if any, and clears the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (token && TOKEN_PATTERN.test(token)) {
    await getAuthStore().deleteSession(hashToken(token));
  }
  jar.set(cookieName(), "", {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
