import { AppShell } from "@/components/app-shell";
import type { BellItem } from "@/components/notification-bell";
import { SetupRequired } from "@/components/setup-required";
import { requireUser } from "@/lib/auth/session";
import { getStore, storeKind } from "@/lib/db";
import { nudgeHubSpot } from "@/lib/hubspot/worker";

/*
 * Request-time: it resolves the session and reads the roster. Kept in a route
 * group so the root layout stays static and `robots.txt` still prerenders.
 *
 * Redirecting signed-out visitors here is a convenience, NOT the protection. A
 * layout does not stop its pages from rendering, so every page and route
 * handler checks the session itself.
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

  const { person: me } = await requireUser();

  // Keeps the HubSpot queue moving with ordinary traffic (throttled, after the
  // response). Retries and crashed-worker leases are picked up here too.
  nudgeHubSpot();
  const store = getStore();
  const people = await store.listPeople();

  /*
   * Seeded here so the bell's badge is correct on first paint rather than
   * flashing empty, and so its polling effect stays a pure subscription.
   */
  const notifications: BellItem[] = (await store.listUnreadNotifications(me.id)).map(
    (n) => ({
        id: n.id,
        kind: n.kind,
        actorId: n.actorId,
        href: n.href,
        preview: n.preview,
      createdAt: n.createdAt,
    }),
  );

  return (
    <AppShell
      people={people}
      me={me}
      initialNotifications={notifications}
    >
      {children}
    </AppShell>
  );
}
