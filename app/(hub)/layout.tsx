import { AppShell } from "@/components/app-shell";
import { getStore } from "@/lib/db";

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
  const people = await getStore().listPeople();
  return <AppShell people={people}>{children}</AppShell>;
}
