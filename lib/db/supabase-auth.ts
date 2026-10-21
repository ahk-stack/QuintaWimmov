import "server-only";

import type { Person } from "../types";
import {
  AccountError,
  type AccountErrorCode,
  type AuditEntry,
  type AuthStore,
  type SessionRecord,
} from "./auth-store";
import { serviceClient } from "./supabase-store";

/**
 * Supabase implementation of the sign-in contract.
 *
 * Every table it touches is closed to the publishable key (migration 0007), so
 * it runs under the service-role client like the rest of the data layer. Admin
 * changes go through Postgres functions so each one is a single transaction.
 */

interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  role: Person["role"];
  territory: string | null;
  initials: string;
  active: boolean;
}

interface SessionRow {
  id: string;
  person_id: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  reauthenticated_at: string;
}

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  // The column became optional in 0003; the domain type predates that.
  email: r.email ?? "",
  role: r.role,
  territory: r.territory,
  initials: r.initials,
  active: r.active,
});

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  personId: r.person_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastSeenAt: r.last_seen_at,
  reauthenticatedAt: r.reauthenticated_at,
});

/** Generic, like the main store: Postgres errors can quote row values. */
function fail(operation: string): never {
  throw new Error(`Supabase ${operation} failed`);
}

const RAISED: Record<string, AccountErrorCode> = {
  LH_NOT_ADMIN: "not_admin",
  LH_LAST_ADMIN: "last_admin",
  LH_SELF: "self",
  LH_NOT_FOUND: "not_found",
  LH_CREDENTIALS_REQUIRED: "credentials_required",
  LH_NOTHING_TO_CHANGE: "nothing_to_change",
  LH_ALREADY_BOOTSTRAPPED: "already_bootstrapped",
};

/**
 * Turns a function error into an AccountError where it is one we expect.
 *
 * Unique violations are told apart by constraint name, which Postgres puts in
 * the message; the message is inspected here and then discarded.
 */
function accountFailure(
  operation: string,
  error: { code?: string; message?: string },
): never {
  const message = error.message ?? "";
  for (const [token, code] of Object.entries(RAISED)) {
    if (message.includes(token)) throw new AccountError(code);
  }
  if (error.code === "23505") {
    if (message.includes("person_credentials_username_key")) {
      throw new AccountError("username_taken");
    }
    if (message.includes("people_email_key")) throw new AccountError("email_taken");
  }
  // 22P02: a malformed uuid cannot match anyone.
  if (error.code === "22P02") throw new AccountError("not_found");
  fail(operation);
}

export const supabaseAuth: AuthStore = {
  async findLogin(username) {
    const { data, error } = await serviceClient()
      .from("person_credentials")
      .select("person_id, password_hash, people!inner(active)")
      .eq("username", username)
      .maybeSingle();
    if (error) fail("findLogin");
    if (!data) return null;
    const row = data as unknown as {
      person_id: string;
      password_hash: string;
      people: { active: boolean };
    };
    return {
      personId: row.person_id,
      passwordHash: row.password_hash,
      active: row.people.active,
    };
  },

  async getPasswordHash(personId) {
    const { data, error } = await serviceClient()
      .from("person_credentials")
      .select("password_hash")
      .eq("person_id", personId)
      .maybeSingle();
    if (error) {
      if (error.code === "22P02") return null;
      fail("getPasswordHash");
    }
    return data ? (data as { password_hash: string }).password_hash : null;
  },

  async getUsername(personId) {
    const { data, error } = await serviceClient()
      .from("person_credentials")
      .select("username")
      .eq("person_id", personId)
      .maybeSingle();
    if (error) {
      if (error.code === "22P02") return null;
      fail("getUsername");
    }
    return data ? (data as { username: string }).username : null;
  },

  async createSession(input) {
    const { data, error } = await serviceClient()
      .from("sessions")
      .insert({
        token_hash: input.tokenHash,
        person_id: input.personId,
        expires_at: input.expiresAt,
      })
      .select("id, person_id, created_at, expires_at, last_seen_at, reauthenticated_at")
      .single();
    if (error) fail("createSession");
    return toSession(data as SessionRow);
  },

  async findSession(tokenHash) {
    const { data, error } = await serviceClient()
      .from("sessions")
      .select(
        "id, person_id, created_at, expires_at, last_seen_at, reauthenticated_at, people!inner(*)",
      )
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) fail("findSession");
    if (!data) return null;
    const row = data as unknown as SessionRow & { people: PersonRow };
    return { session: toSession(row), person: toPerson(row.people) };
  },

  async touchSession(id) {
    const { error } = await serviceClient()
      .from("sessions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", id);
    if (error) fail("touchSession");
  },

  async markReauthenticated(id) {
    const now = new Date().toISOString();
    const { error } = await serviceClient()
      .from("sessions")
      .update({ reauthenticated_at: now, last_seen_at: now })
      .eq("id", id);
    if (error) fail("markReauthenticated");
  },

  async deleteSession(tokenHash) {
    const { error } = await serviceClient()
      .from("sessions")
      .delete()
      .eq("token_hash", tokenHash);
    if (error) fail("deleteSession");
  },

  async deleteStaleSessions(idleCutoff) {
    const { error } = await serviceClient()
      .from("sessions")
      .delete()
      .or(`expires_at.lt.${new Date().toISOString()},last_seen_at.lt.${idleCutoff}`);
    if (error) fail("deleteStaleSessions");
  },

  async throttleHit(keys, windowSeconds) {
    const { data, error } = await serviceClient().rpc("auth_throttle_hit", {
      p_keys: keys,
      p_window_seconds: windowSeconds,
    });
    if (error || !Array.isArray(data) || data.length !== keys.length) fail("throttleHit");
    return (data as number[]).map(Number);
  },

  async throttleClear(keys) {
    const { error } = await serviceClient().rpc("auth_throttle_clear", { p_keys: keys });
    if (error) fail("throttleClear");
  },

  async listAccounts() {
    const { data, error } = await serviceClient()
      .from("people")
      .select("*, person_credentials(username, password_changed_at)")
      .eq("active", true)
      .order("name");
    if (error) fail("listAccounts");
    return (
      data as (PersonRow & {
        person_credentials: { username: string; password_changed_at: string } | null;
      })[]
    ).map((row) => ({
      person: toPerson(row),
      username: row.person_credentials?.username ?? null,
      passwordChangedAt: row.person_credentials?.password_changed_at ?? null,
    }));
  },

  async listAudit(limit) {
    const { data, error } = await serviceClient()
      .from("admin_audit")
      .select("id, actor_id, target_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("listAudit");
    return (
      data as {
        id: string;
        actor_id: string | null;
        target_id: string | null;
        action: AuditEntry["action"];
        created_at: string;
      }[]
    ).map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      targetId: r.target_id,
      action: r.action,
      createdAt: r.created_at,
    }));
  },

  async createUser(actorId, profile, credentials) {
    const { data, error } = await serviceClient().rpc("admin_create_user", {
      p_actor: actorId,
      p_name: profile.name,
      p_email: profile.email,
      p_role: profile.role,
      p_territory: profile.territory,
      p_initials: profile.initials,
      p_username: credentials.username,
      p_password_hash: credentials.passwordHash,
    });
    if (error) accountFailure("createUser", error);
    return data as string;
  },

  async updateUser(actorId, targetId, profile) {
    const { error } = await serviceClient().rpc("admin_update_user", {
      p_actor: actorId,
      p_target: targetId,
      p_name: profile.name,
      p_email: profile.email,
      p_role: profile.role,
      p_territory: profile.territory,
      p_initials: profile.initials,
    });
    if (error) accountFailure("updateUser", error);
  },

  async setCredentials(actorId, targetId, change) {
    const { error } = await serviceClient().rpc("admin_set_credentials", {
      p_actor: actorId,
      p_target: targetId,
      p_username: change.username,
      p_password_hash: change.passwordHash,
    });
    if (error) accountFailure("setCredentials", error);
  },

  async deleteUser(actorId, targetId) {
    const { error } = await serviceClient().rpc("admin_delete_user", {
      p_actor: actorId,
      p_target: targetId,
    });
    if (error) accountFailure("deleteUser", error);
  },
};
