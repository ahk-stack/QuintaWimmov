import type { Person, Role } from "../types";

/**
 * The contract for sign-in and account management.
 *
 * Kept apart from `DataStore` because it holds the only data in the system
 * that must never reach a page: password hashes and session token hashes.
 * Nothing here is imported by a client component, and the two implementations
 * are both `server-only`.
 */

/** What login needs. The hash goes to the verifier and nowhere else. */
export interface LoginRecord {
  personId: string;
  passwordHash: string;
  active: boolean;
}

export interface SessionRecord {
  id: string;
  personId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  reauthenticatedAt: string;
}

/** One row on the admin's user list. Never carries the hash. */
export interface AccountSummary {
  person: Person;
  username: string | null;
  passwordChangedAt: string | null;
}

export interface AuditEntry {
  id: string;
  actorId: string | null;
  targetId: string | null;
  action: "bootstrap" | "user_created" | "user_updated" | "credentials_set" | "user_deleted";
  createdAt: string;
}

export interface ProfileInput {
  name: string;
  email: string | null;
  role: Role;
  territory: string | null;
  initials: string;
}

export type AccountErrorCode =
  | "not_admin"
  | "last_admin"
  | "self"
  | "not_found"
  | "username_taken"
  | "email_taken"
  | "credentials_required"
  | "nothing_to_change"
  | "already_bootstrapped";

/**
 * A refused account change, with a code the route maps to a status.
 *
 * Carries no row contents — Postgres errors quote the offending values, so
 * only the code is kept.
 */
export class AccountError extends Error {
  constructor(public readonly code: AccountErrorCode) {
    super(`Account change refused: ${code}`);
    this.name = "AccountError";
  }
}

export interface AuthStore {
  // Sign-in -----------------------------------------------------------------
  findLogin(username: string): Promise<LoginRecord | null>;
  getPasswordHash(personId: string): Promise<string | null>;
  getUsername(personId: string): Promise<string | null>;

  // Sessions ----------------------------------------------------------------
  createSession(input: {
    tokenHash: string;
    personId: string;
    expiresAt: string;
  }): Promise<SessionRecord>;
  /** The session and its person, or null. Expiry is checked by the caller. */
  findSession(tokenHash: string): Promise<{ session: SessionRecord; person: Person } | null>;
  touchSession(id: string): Promise<void>;
  markReauthenticated(id: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Removes sessions past their absolute expiry or idle limit. */
  deleteStaleSessions(idleCutoff: string): Promise<void>;

  // Throttling --------------------------------------------------------------
  /**
   * Counts one attempt against each key, atomically, and returns the new counts
   * in the same order. Shared across every app instance, unlike the in-memory
   * limiter. Keys are already hashed (`scope:hex`), so no username or IP is
   * stored raw.
   */
  throttleHit(keys: string[], windowSeconds: number): Promise<number[]>;
  throttleClear(keys: string[]): Promise<void>;

  // Administration ----------------------------------------------------------
  // Each call is one transaction that re-checks the actor is an admin and that
  // an admin able to sign in remains. Callers check too, for a fast answer, but
  // these are the checks that count.
  listAccounts(): Promise<AccountSummary[]>;
  listAudit(limit: number): Promise<AuditEntry[]>;
  createUser(
    actorId: string,
    profile: ProfileInput,
    credentials: { username: string; passwordHash: string },
  ): Promise<string>;
  updateUser(actorId: string, targetId: string, profile: ProfileInput): Promise<void>;
  setCredentials(
    actorId: string,
    targetId: string,
    change: { username: string | null; passwordHash: string | null },
  ): Promise<void>;
  deleteUser(actorId: string, targetId: string): Promise<void>;
}
