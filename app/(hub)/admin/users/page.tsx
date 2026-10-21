import { notFound } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { UserAdmin, type AccountRow, type AuditRow } from "@/components/user-admin";
import { requireUser } from "@/lib/auth/session";
import { getAuthStore, getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Manage users" };

/**
 * Admin-only account management.
 *
 * Non-admins get a 404 rather than a "forbidden" page, so the screen does not
 * advertise itself. Every action it offers is re-checked by its route handler
 * and again inside the database transaction.
 */
export default async function ManageUsersPage() {
  const { person: me } = await requireUser();
  if (me.role !== "admin") notFound();

  const auth = getAuthStore();
  const [accounts, audit, people] = await Promise.all([
    auth.listAccounts(),
    auth.listAudit(20),
    getStore().listPeople(),
  ]);

  // Only what the screen shows: never hashes, never sessions.
  const rows: AccountRow[] = accounts.map((a) => ({
    id: a.person.id,
    name: a.person.name,
    email: a.person.email || null,
    role: a.person.role,
    territory: a.person.territory,
    initials: a.person.initials,
    username: a.username,
    passwordChangedAt: a.passwordChangedAt,
  }));

  const names = new Map(people.map((p) => [p.id, p.name]));
  const auditRows: AuditRow[] = audit.map((entry) => ({
    id: entry.id,
    action: entry.action,
    actor: entry.actorId ? (names.get(entry.actorId) ?? "Someone") : "Setup script",
    target: entry.targetId ? (names.get(entry.targetId) ?? "Someone") : "—",
    createdAt: entry.createdAt,
  }));

  const withLogin = rows.filter((r) => r.username).length;

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Manage users"
        lede={`${rows.length} people, ${withLogin} able to sign in. Only admins can create users, change sign-ins or delete users.`}
      />
      <UserAdmin accounts={rows} audit={auditRows} meId={me.id} />
    </div>
  );
}
