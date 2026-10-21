"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { formatDate } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/status";
import type { Role } from "@/lib/types";

import { Avatar, Button } from "./ui";

export interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  territory: string | null;
  initials: string;
  username: string | null;
  passwordChangedAt: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  actor: string;
  target: string;
  createdAt: string;
}

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm placeholder:text-muted/70";
const LABEL_CLASS = "block text-xs font-bold tracking-[0.12em] uppercase";
const ROLES: Role[] = ["sales", "consultant", "admin"];

const AUDIT_LABEL: Record<string, string> = {
  bootstrap: "set up the first sign-in for",
  user_created: "created",
  user_updated: "edited",
  credentials_set: "changed the sign-in of",
  user_deleted: "deleted",
};

/**
 * A strong password to hand over, generated in the browser.
 *
 * 20 characters from an alphabet without look-alikes (no 0/O, 1/l/I), so it
 * survives being read out or retyped. crypto.getRandomValues, never Math.random.
 * Rejection sampling keeps every character equally likely.
 */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const limit = 256 - (256 % alphabet.length);
  const out: string[] = [];
  while (out.length < 20) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const b of bytes) {
      if (b < limit && out.length < 20) out.push(alphabet[b % alphabet.length]);
    }
  }
  return out.join("");
}

type Result =
  | { ok: true; signedOut?: boolean }
  | { ok: false; error: string; fields?: Record<string, string> };

/**
 * Sends an admin request, asking for the admin's password first when the
 * server says the last confirmation is too old, then retrying once.
 */
function useAdminRequest() {
  const router = useRouter();
  const [reauth, setReauth] = useState<null | ((ok: boolean) => void)>(null);

  async function send(url: string, method: string, body?: unknown): Promise<Result> {
    const attempt = () =>
      fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });

    try {
      let response = await attempt();
      if (response.status === 403) {
        const result = await response.clone().json().catch(() => ({}));
        if (result.reauth) {
          const confirmed = await new Promise<boolean>((resolve) => setReauth(() => resolve));
          setReauth(null);
          if (!confirmed) return { ok: false, error: "Cancelled." };
          response = await attempt();
        }
      }
      if (response.status === 401) {
        router.replace("/login");
        return { ok: false, error: "Your session has ended." };
      }
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        return { ok: true, signedOut: result.signedOut === true };
      }
      const result = await response.json().catch(() => ({}));
      return { ok: false, error: result.error ?? "That didn't work.", fields: result.fields };
    } catch {
      return { ok: false, error: "Could not reach the server." };
    }
  }

  return { send, reauth };
}

function ReauthDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        onDone(true);
        return;
      }
      const result = await response.json().catch(() => ({}));
      setError(result.error ?? "That password didn't match.");
      setPassword("");
    } catch {
      setError("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 px-6">
      <form
        onSubmit={confirm}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        className="w-full max-w-sm rounded-xl border border-line bg-paper p-6 shadow-lg"
      >
        <h2 id="reauth-title" className="text-xl">
          Confirm your password
        </h2>
        <p className="mt-2 text-sm text-muted">
          Changing accounts needs your password again, at most every 10 minutes.
        </p>
        <label className="mt-5 block">
          <span className={LABEL_CLASS}>Your password</span>
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-status-lost">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !password}>
            {busy ? "Checking…" : "Confirm"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  return message ? <p className="mt-1 text-xs text-status-lost">{message}</p> : null;
}

/** Password input with a generator. Shown as text so it can be copied and handed over. */
function PasswordField({
  value,
  onChange,
  error,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  label: string;
}) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      <div className="mt-1 flex gap-2">
        <input
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="At least 15 characters"
          className={`${INPUT_CLASS} mt-0 font-mono`}
        />
        <Button type="button" variant="secondary" onClick={() => onChange(generatePassword())}>
          Generate
        </Button>
      </div>
      <FieldError message={error} />
    </label>
  );
}

interface ProfileDraft {
  name: string;
  email: string;
  role: Role;
  territory: string;
}

function ProfileFields({
  draft,
  setDraft,
  fields,
  lockRole,
}: {
  draft: ProfileDraft;
  setDraft: (d: ProfileDraft) => void;
  fields: Record<string, string>;
  lockRole?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block">
        <span className={LABEL_CLASS}>Name</span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={INPUT_CLASS}
        />
        <FieldError message={fields.name} />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>Email</span>
        <input
          type="email"
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          placeholder="Optional"
          className={INPUT_CLASS}
        />
        <FieldError message={fields.email} />
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>Role</span>
        <select
          value={draft.role}
          disabled={lockRole}
          onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
          className={INPUT_CLASS}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {lockRole ? (
          <p className="mt-1 text-xs text-muted">You can&apos;t remove your own admin role.</p>
        ) : null}
      </label>
      <label className="block">
        <span className={LABEL_CLASS}>Territory</span>
        <input
          value={draft.territory}
          onChange={(e) => setDraft({ ...draft, territory: e.target.value })}
          placeholder="Optional, e.g. CME"
          className={INPUT_CLASS}
        />
        <FieldError message={fields.territory} />
      </label>
    </div>
  );
}

const toPayload = (d: ProfileDraft) => ({
  name: d.name,
  email: d.email || null,
  role: d.role,
  territory: d.territory || null,
});

function NewUserPanel({ onClose, send }: { onClose: () => void; send: ReturnType<typeof useAdminRequest>["send"] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>({ name: "", email: "", role: "consultant", territory: "" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result = await send("/api/admin/users", "POST", { ...toPayload(draft), username, password });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else {
      setError(result.error);
      setFields(result.fields ?? {});
    }
  }

  return (
    <form onSubmit={create} className="mb-8 space-y-5 rounded-xl border border-line-strong p-6">
      <h2 className="text-xl">New user</h2>
      <ProfileFields draft={draft} setDraft={setDraft} fields={fields} />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL_CLASS}>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="e.g. jaime.ruiz"
            className={INPUT_CLASS}
          />
          <FieldError message={fields.username} />
        </label>
        <PasswordField label="Password" value={password} onChange={setPassword} error={fields.password} />
      </div>
      <p className="text-xs text-muted">
        Copy the password before saving and give it to them privately — it can&apos;t be shown again.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-status-lost">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !draft.name || !username || !password}>
          {busy ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

function AccountEditor({
  account,
  isMe,
  send,
  onClose,
}: {
  account: AccountRow;
  isMe: boolean;
  send: ReturnType<typeof useAdminRequest>["send"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>({
    name: account.name,
    email: account.email ?? "",
    role: account.role,
    territory: account.territory ?? "",
  });
  const [username, setUsername] = useState(account.username ?? "");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function run(url: string, method: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    setFields({});
    const result = await send(url, method, body);
    setBusy(false);
    if (result.ok && result.signedOut) {
      // Changing your own sign-in ends your session too, by design.
      router.replace("/login");
      return true;
    }
    if (result.ok) {
      setMessage({ tone: "ok", text: done });
      setPassword("");
      router.refresh();
    } else {
      setMessage({ tone: "error", text: result.error });
      setFields(result.fields ?? {});
    }
    return result.ok;
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    await run(`/api/admin/users/${account.id}`, "PATCH", toPayload(draft), "Details saved.");
  }

  async function saveCredentials(event: React.FormEvent) {
    event.preventDefault();
    const body: { username?: string; password?: string } = {};
    if (username && username !== account.username) body.username = username;
    if (password) body.password = password;
    await run(
      `/api/admin/users/${account.id}/credentials`,
      "PUT",
      body,
      "Sign-in updated. Their sessions have ended.",
    );
  }

  async function remove() {
    const sure = window.confirm(
      `Delete ${account.name}? They will no longer be able to sign in and will disappear from every list. Their leads and messages stay.`,
    );
    if (!sure) return;
    const ok = await run(`/api/admin/users/${account.id}`, "DELETE", {}, "Deleted.");
    if (ok) onClose();
  }

  const credentialsChanged = Boolean(password) || (username !== "" && username !== account.username);

  return (
    <div className="space-y-8 border-t border-line bg-surface px-5 py-6">
      <form onSubmit={saveProfile} className="space-y-4">
        <h3 className="text-xs font-bold tracking-[0.18em] uppercase">Details</h3>
        <ProfileFields draft={draft} setDraft={setDraft} fields={fields} lockRole={isMe} />
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" disabled={busy || !draft.name}>
            Save details
          </Button>
        </div>
      </form>

      <form onSubmit={saveCredentials} className="space-y-4">
        <h3 className="text-xs font-bold tracking-[0.18em] uppercase">Sign-in</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={LABEL_CLASS}>Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            <FieldError message={fields.username} />
          </label>
          <PasswordField
            label={account.username ? "New password" : "Password"}
            value={password}
            onChange={setPassword}
            error={fields.password}
          />
        </div>
        <div className="flex items-center justify-end gap-4">
          {isMe ? (
            <p className="text-xs text-muted">Changing your own sign-in signs you out.</p>
          ) : null}
          <Button type="submit" variant="secondary" disabled={busy || !credentialsChanged}>
            {account.username ? "Update sign-in" : "Create sign-in"}
          </Button>
        </div>
      </form>

      {message ? (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`text-sm ${message.tone === "error" ? "text-status-lost" : "text-status-won"}`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-t border-line pt-6">
        <p className="text-xs text-muted">
          {isMe ? "You can't delete yourself." : "Removes their sign-in and hides them. Their leads and messages stay."}
        </p>
        {!isMe ? (
          <Button type="button" variant="ghost" onClick={remove} disabled={busy} className="text-status-lost">
            Delete user
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function UserAdmin({
  accounts,
  audit,
  meId,
}: {
  accounts: AccountRow[];
  audit: AuditRow[];
  meId: string;
}) {
  const { send, reauth } = useAdminRequest();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.username ?? "").includes(q) ||
        (a.territory ?? "").toLowerCase().includes(q),
    );
  }, [accounts, query]);

  return (
    <div>
      {reauth ? <ReauthDialog onDone={reauth} /> : null}

      {creating ? (
        <NewUserPanel onClose={() => setCreating(false)} send={send} />
      ) : (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, username or territory"
            className={`${INPUT_CLASS} mt-0 max-w-sm`}
          />
          <Button type="button" onClick={() => setCreating(true)}>
            New user
          </Button>
        </div>
      )}

      <ul className="overflow-hidden rounded-xl border border-line">
        {visible.map((account) => {
          const open = openId === account.id;
          return (
            <li key={account.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(open ? null : account.id)}
                aria-expanded={open}
                className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-surface"
              >
                <Avatar
                  person={{ name: account.name, initials: account.initials }}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {account.name}
                    {account.id === meId ? <span className="font-normal text-muted"> (you)</span> : null}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {ROLE_LABEL[account.role]}
                    {account.territory ? ` · ${account.territory}` : ""}
                  </span>
                </span>
                <span className="hidden text-right text-xs sm:block">
                  {account.username ? (
                    <>
                      <span className="block font-mono">{account.username}</span>
                      {account.passwordChangedAt ? (
                        <span className="block text-muted">
                          password set {formatDate(account.passwordChangedAt)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-status-pending">No sign-in yet</span>
                  )}
                </span>
              </button>
              {open ? (
                <AccountEditor
                  account={account}
                  isMe={account.id === meId}
                  send={send}
                  onClose={() => setOpenId(null)}
                />
              ) : null}
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="px-5 py-10 text-center text-sm text-muted">Nobody matches that.</li>
        ) : null}
      </ul>

      {audit.length > 0 ? (
        <section className="mt-12">
          <h2 className="mb-4 text-xs font-bold tracking-[0.18em] uppercase">Recent changes</h2>
          <ul className="space-y-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2">
                <span className="font-bold">{entry.actor}</span>
                <span>{AUDIT_LABEL[entry.action] ?? entry.action}</span>
                <span className="font-bold">{entry.target}</span>
                <span className="text-muted">· {formatDate(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
