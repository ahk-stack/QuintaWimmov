import Link from "next/link";

import { LeadRow } from "@/components/lead-list";
import { ButtonLink, EmptyState, PageHeader, Stat } from "@/components/ui";
import { getStore } from "@/lib/db";
import {
  DIRECTION_META,
  LEAD_STATUSES,
  STATUS_META,
  isOpen,
} from "@/lib/status";
import type { LeadDirection, LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/*
 * Filters live in the URL rather than in component state, so a filtered board
 * is linkable and shareable in chat, and the page stays a server component.
 */

const DIRECTION_VALUES = ["for_sales", "for_consultant"] as const;

function parseDirection(value: string | undefined): LeadDirection | undefined {
  return DIRECTION_VALUES.find((d) => d === value);
}

function parseStatus(value: string | undefined): LeadStatus | undefined {
  return LEAD_STATUSES.find((s) => s === value);
}

/** Single-valued read; a repeated query param arrives as an array. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildHref(current: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(current)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `/leads?${query}` : "/leads";
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold whitespace-nowrap transition-colors ${
        active
          ? "border-ink bg-ink text-paper"
          : "border-line-strong text-muted hover:bg-surface hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const direction = parseDirection(first(params.direction));
  const status = parseStatus(first(params.status));
  const assignee = first(params.assignee);

  const store = getStore();
  const [people, allLeads] = await Promise.all([
    store.listPeople(),
    store.listLeads(),
  ]);

  const peopleById = new Map(people.map((p) => [p.id, p]));

  const leads = allLeads
    .filter((l) => !direction || l.direction === direction)
    .filter((l) => !status || l.status === status)
    .filter((l) => {
      if (!assignee) return true;
      if (assignee === "unassigned") return l.assignedTo === null;
      return l.assignedTo === assignee;
    });

  const anyFilterActive = Boolean(direction || status || assignee);
  const base = { direction, status, assignee };

  return (
    <>
      <PageHeader
        eyebrow="Leads"
        title="The board"
        lede="Everything moving between sales and consultants. Claim what you can work, and close it out so the person who raised it hears how it went."
        action={<ButtonLink href="/leads/new">Post a lead</ButtonLink>}
      />

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Showing" value={leads.length} hint="After filters" />
        <Stat
          label="Open"
          value={allLeads.filter((l) => isOpen(l.status)).length}
          hint="Across the whole board"
        />
        <Stat
          label="Unclaimed"
          value={allLeads.filter((l) => l.assignedTo === null && isOpen(l.status)).length}
          hint="Nobody has taken these"
        />
      </section>

      <div className="mt-10 space-y-4 border-y border-line py-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 w-20 text-xs font-bold tracking-[0.14em] text-muted uppercase">
            For
          </span>
          <FilterChip
            href={buildHref({ ...base, direction: undefined })}
            active={!direction}
          >
            Everyone
          </FilterChip>
          {DIRECTION_VALUES.map((value) => (
            <FilterChip
              key={value}
              href={buildHref({ ...base, direction: value })}
              active={direction === value}
            >
              {DIRECTION_META[value].short}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 w-20 text-xs font-bold tracking-[0.14em] text-muted uppercase">
            Status
          </span>
          <FilterChip
            href={buildHref({ ...base, status: undefined })}
            active={!status}
          >
            Any
          </FilterChip>
          {LEAD_STATUSES.map((value) => (
            <FilterChip
              key={value}
              href={buildHref({ ...base, status: value })}
              active={status === value}
            >
              {STATUS_META[value].label}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 w-20 text-xs font-bold tracking-[0.14em] text-muted uppercase">
            Owner
          </span>
          <FilterChip
            href={buildHref({ ...base, assignee: undefined })}
            active={!assignee}
          >
            Anyone
          </FilterChip>
          <FilterChip
            href={buildHref({ ...base, assignee: "unassigned" })}
            active={assignee === "unassigned"}
          >
            Unclaimed
          </FilterChip>
          {people
            .filter((p) => p.active)
            .map((person) => (
              <FilterChip
                key={person.id}
                href={buildHref({ ...base, assignee: person.id })}
                active={assignee === person.id}
              >
                {person.name}
              </FilterChip>
            ))}
        </div>

        {anyFilterActive ? (
          <p className="pt-1">
            <Link
              href="/leads"
              className="text-xs font-bold underline decoration-1 underline-offset-4 hover:no-underline"
            >
              Clear all filters
            </Link>
          </p>
        ) : null}
      </div>

      <section className="mt-8">
        {leads.length === 0 ? (
          <EmptyState
            title={anyFilterActive ? "Nothing matches" : "No leads yet"}
            hint={
              anyFilterActive
                ? "Loosen a filter, or clear them all to see the whole board."
                : "Post a hotel you have spoken to and let the other side pick it up."
            }
            action={
              anyFilterActive ? (
                <ButtonLink href="/leads" variant="secondary">
                  Clear filters
                </ButtonLink>
              ) : (
                <ButtonLink href="/leads/new">Post a lead</ButtonLink>
              )
            }
          />
        ) : (
          <div>
            {leads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} peopleById={peopleById} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
