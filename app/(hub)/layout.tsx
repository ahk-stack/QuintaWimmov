import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { SetupRequired } from "@/components/setup-required";
import { getClaimedPersonId } from "@/lib/current-person";
import { getStore, storeKind } from "@/lib/db";

/*
 * The shell needs the roster for the identity picker, so this layout reads the
 * store and is therefore request-time rather than prerendered. Kept in a route
 * group so the root layout stays static and `robots.txt` still prerenders.
 */
export const dynamic = "force-dynamic";

export default async function HubLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  /*
   * Check configuration before touching the store, and return without rendering
   * `children` when there is none. React never invokes the page component in
   * that case, so an unconfigured deployment shows one readable screen instead
   * of a 500 on every route.
   */
  if (storeKind() === "unconfigured") {
    return <SetupRequired />;
  }

  const store = getStore();
  const [people, claimedId] = await Promise.all([
    store.listPeople(),
    // Attribution only — decides what to show, never what to allow.
    getClaimedPersonId(),
  ]);

  /*
   * Seeded here so the bell's badge is correct on first paint rather than
   * flashing empty, and so its polling effect stays a pure subscription.
   */
  const notifications: BellItem[] = claimedId
    ? (await store.listUnreadNotifications(claimedId)).map((n) => ({
        id: n.id,
        kind: n.kind,
        actorId: n.actorId,
        href: n.href,
        preview: n.preview,
        createdAt: n.createdAt,
      }))
    : [];

  return (
    <AppShell
      people={people}
      initialNotifications={notifications}
      claimedPersonId={claimedId}
    >
      {children}
    </AppShell>
  );
}
