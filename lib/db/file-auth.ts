import "server-only";

import { randomUUID } from "node:crypto";

import type { Person } from "../types";
import {
  AccountError,
  type AuthStore,
  type ProfileInput,
  type SessionRecord,
} from "./auth-store";
import { mutate, read, type Database, type SessionRow } from "./file-store";

/**
 * Development implementation of the sign-in contract, on the JSON file store.
 *
 * Mirrors the Postgres functions in migration 0007 rule for rule, so the admin
 * screens behave the same locally. Every change runs inside the file store's
 * single write lock, which is what stands in for the advisory lock and the
 * transaction: the checks and the change cannot interleave with another one.
 */

const toSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  personId: r.personId,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  lastSeenAt: r.lastSeenAt,
  reauthenticatedAt: r.reauthenticatedAt,
});

function assertAdmin(d: Database, actorId: string): void {
  const actor = d.people.find((p) => p.id === actorId);
  const hasLogin = d.credentials.some((c) => c.personId === actorId);
  if (!actor || !actor.active || actor.role !== "admin" || !hasLogin) {
    throw new AccountError("not_admin");
  }
}

function assertAdminsRemain(d: Database): void {
  const remaining = d.people.some(
    (p) =>
      p.active &&
      p.role === "admin" &&
      d.credentials.some((c) => c.personId === p.id),
  );
  if (!remaining) throw new AccountError("last_admin");
}

function assertEmailFree(d: Database, email: string | null, exceptId?: string): void {
  if (!email) return;
  const taken = d.people.some(
    (p) => p.id !== exceptId && p.email.toLowerCase() === email.toLowerCase(),
  );
  if (taken) throw new AccountError("email_taken");
}

function assertUsernameFree(d: Database, username: string, exceptId?: string): void {
  if (d.credentials.some((c) => c.username === username && c.personId !== exceptId)) {
    throw new AccountError("username_taken");
  }
}

function audit(
  d: Database,
  actorId: string | null,
  targetId: string,
  action: Database["adminAudit"][number]["action"],
): void {
  d.adminAudit.push({
    id: randomUUID(),
    actorId,
    targetId,
    action,
    createdAt: new Date().toISOString(),
  });
}

/*
 * Mutations made inside `mutate` are persisted even when the callback throws
 * after making them, so every check runs BEFORE anything is changed — or the
 * change is undone before rethrowing. That is the file store's version of a
 * rolled-back transaction.
 */

export const fileAuth: AuthStore = {
  async findLogin(username) {
    return read((d) => {
      const credential = d.credentials.find((c) => c.username === username);
      if (!credential) return null;
      const person = d.people.find((p) => p.id === credential.personId);
      return {
        personId: credential.personId,
        passwordHash: credential.passwordHash,
        active: Boolean(person?.active),
      };
    });
  },

  async getPasswordHash(personId) {
    return read(
      (d) => d.credentials.find((c) => c.personId === personId)?.passwordHash ?? null,
    );
  },

  async getUsername(personId) {
    return read((d) => d.credentials.find((c) => c.personId === personId)?.username ?? null);
  },

  async createSession(input) {
    return mutate((d) => {
      const now = new Date().toISOString();
      const row: SessionRow = {
        id: randomUUID(),
        tokenHash: input.tokenHash,
        personId: input.personId,
        createdAt: now,
        expiresAt: input.expiresAt,
        lastSeenAt: now,
        reauthenticatedAt: now,
      };
      d.sessions.push(row);
      return toSession(row);
    });
  },

  async findSession(tokenHash) {
    return read((d) => {
      const row = d.sessions.find((s) => s.tokenHash === tokenHash);
      if (!row) return null;
      const person = d.people.find((p) => p.id === row.personId);
      if (!person) return null;
      return { session: toSession(row), person: structuredClone(person) };
    });
  },

  async touchSession(id) {
    await mutate((d) => {
      const row = d.sessions.find((s) => s.id === id);
      if (row) row.lastSeenAt = new Date().toISOString();
    });
  },

  async markReauthenticated(id) {
    await mutate((d) => {
      const row = d.sessions.find((s) => s.id === id);
      if (!row) return;
      const now = new Date().toISOString();
      row.reauthenticatedAt = now;
      row.lastSeenAt = now;
    });
  },

  async deleteSession(tokenHash) {
    await mutate((d) => {
      d.sessions = d.sessions.filter((s) => s.tokenHash !== tokenHash);
    });
  },

  async deleteStaleSessions(idleCutoff) {
    await mutate((d) => {
      const now = new Date().toISOString();
      d.sessions = d.sessions.filter(
        (s) => s.expiresAt >= now && s.lastSeenAt >= idleCutoff,
      );
    });
  },

  async throttleHit(keys, windowSeconds) {
    return mutate((d) => {
      const now = Date.now();
      const counts = keys.map((key) => {
        let row = d.loginThrottle.find((t) => t.key === key);
        if (!row) {
          row = { key, attempts: 0, windowStartedAt: new Date(now).toISOString() };
          d.loginThrottle.push(row);
        } else if (Date.parse(row.windowStartedAt) <= now - windowSeconds * 1000) {
          row.attempts = 0;
          row.windowStartedAt = new Date(now).toISOString();
        }
        row.attempts += 1;
        return row.attempts;
      });
      const dayAgo = now - 24 * 60 * 60 * 1000;
      d.loginThrottle = d.loginThrottle.filter((t) => Date.parse(t.windowStartedAt) >= dayAgo);
      return counts;
    });
  },

  async throttleClear(keys) {
    await mutate((d) => {
      d.loginThrottle = d.loginThrottle.filter((t) => !keys.includes(t.key));
    });
  },

  async listAccounts() {
    return read((d) =>
      d.people
        .filter((p) => p.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => {
          const credential = d.credentials.find((c) => c.personId === person.id);
          return {
            person: structuredClone(person),
            username: credential?.username ?? null,
            passwordChangedAt: credential?.passwordChangedAt ?? null,
          };
        }),
    );
  },

  async listAudit(limit) {
    return read((d) =>
      [...d.adminAudit]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map((a) => ({ ...a })),
    );
  },

  async createUser(actorId, profile, credentials) {
    return mutate((d) => {
      assertAdmin(d, actorId);
      assertEmailFree(d, profile.email);
      assertUsernameFree(d, credentials.username);

      const person: Person = {
        id: randomUUID(),
        name: profile.name,
        email: profile.email ?? "",
        role: profile.role,
        territory: profile.territory,
        initials: profile.initials,
        active: true,
      };
      d.people.push(person);
      d.credentials.push({
        personId: person.id,
        username: credentials.username,
        passwordHash: credentials.passwordHash,
        passwordChangedAt: new Date().toISOString(),
      });
      audit(d, actorId, person.id, "user_created");
      return person.id;
    });
  },

  async updateUser(actorId, targetId, profile: ProfileInput) {
    await mutate((d) => {
      assertAdmin(d, actorId);
      const target = d.people.find((p) => p.id === targetId && p.active);
      if (!target) throw new AccountError("not_found");
      if (targetId === actorId && profile.role !== "admin") throw new AccountError("self");
      assertEmailFree(d, profile.email, targetId);

      // Would this leave no admin? Checked before changing anything.
      if (target.role === "admin" && profile.role !== "admin") {
        const others = d.people.some(
          (p) =>
            p.id !== targetId &&
            p.active &&
            p.role === "admin" &&
            d.credentials.some((c) => c.personId === p.id),
        );
        if (!others) throw new AccountError("last_admin");
      }

      const roleChanged = target.role !== profile.role;
      target.name = profile.name;
      target.email = profile.email ?? "";
      target.role = profile.role;
      target.territory = profile.territory;
      target.initials = profile.initials;
      if (roleChanged) d.sessions = d.sessions.filter((s) => s.personId !== targetId);
      assertAdminsRemain(d);
      audit(d, actorId, targetId, "user_updated");
    });
  },

  async setCredentials(actorId, targetId, change) {
    await mutate((d) => {
      assertAdmin(d, actorId);
      const target = d.people.find((p) => p.id === targetId && p.active);
      if (!target) throw new AccountError("not_found");
      if (change.username === null && change.passwordHash === null) {
        throw new AccountError("nothing_to_change");
      }
      if (change.username !== null) assertUsernameFree(d, change.username, targetId);

      const existing = d.credentials.find((c) => c.personId === targetId);
      if (existing) {
        if (change.username !== null) existing.username = change.username;
        if (change.passwordHash !== null) {
          existing.passwordHash = change.passwordHash;
          existing.passwordChangedAt = new Date().toISOString();
        }
      } else {
        if (change.username === null || change.passwordHash === null) {
          throw new AccountError("credentials_required");
        }
        d.credentials.push({
          personId: targetId,
          username: change.username,
          passwordHash: change.passwordHash,
          passwordChangedAt: new Date().toISOString(),
        });
      }

      // Every session ends, the caller's own included; see migration 0007.
      d.sessions = d.sessions.filter((s) => s.personId !== targetId);
      audit(d, actorId, targetId, "credentials_set");
    });
  },

  async deleteUser(actorId, targetId) {
    await mutate((d) => {
      assertAdmin(d, actorId);
      if (targetId === actorId) throw new AccountError("self");
      const target = d.people.find((p) => p.id === targetId && p.active);
      if (!target) throw new AccountError("not_found");

      if (target.role === "admin") {
        const others = d.people.some(
          (p) =>
            p.id !== targetId &&
            p.active &&
            p.role === "admin" &&
            d.credentials.some((c) => c.personId === p.id),
        );
        if (!others) throw new AccountError("last_admin");
      }

      target.active = false;
      d.credentials = d.credentials.filter((c) => c.personId !== targetId);
      d.sessions = d.sessions.filter((s) => s.personId !== targetId);
      audit(d, actorId, targetId, "user_deleted");
    });
  },
};
