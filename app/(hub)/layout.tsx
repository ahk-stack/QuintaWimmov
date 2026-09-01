import { AppShell } from "@/components/app-shell";
import { SetupRequired } from "@/components/setup-required";
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

  const people = await getStore().listPeople();
  return <AppShell people={people}>{children}</AppShell>;
}
