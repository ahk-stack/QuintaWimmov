import { EmptyState, PageHeader } from "./ui";

/**
 * Stand-in for a section that lands in a later phase. Keeps the app navigable
 * and says plainly what is missing, rather than 404ing from the nav.
 */
export function Placeholder({
  title,
  lede,
  arriving,
}: {
  title: string;
  lede: string;
  arriving: string;
}) {
  return (
    <>
      <PageHeader title={title} lede={lede} />
      <EmptyState title="Not built yet" hint={arriving} />
    </>
  );
}
