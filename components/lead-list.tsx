import Link from "next/link";

import { formatDate } from "@/lib/format";
import { DIRECTION_META } from "@/lib/status";
import type { Lead, Person } from "@/lib/types";

import { Avatar, StatusPill, Tag } from "./ui";

/**
 * Compact lead row, shared by the dashboard and the lead board so the two
 * cannot drift apart.
 */
export function LeadRow({
  lead,
  peopleById,
}: {
  lead: Lead;
  peopleById: Map<string, Person>;
}) {
  const assignee = lead.assignedTo
    ? (peopleById.get(lead.assignedTo) ?? null)
    : null;
  const author = peopleById.get(lead.createdBy) ?? null;

  return (
    <Link
      href={`/leads/${lead.id}`}
      className="group flex items-start gap-4 border-b border-line py-4 last:border-b-0 hover:bg-surface"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-heading text-base font-bold group-hover:underline">
            {lead.hotelName}
          </span>
          <StatusPill status={lead.status} />
          {lead.priority === "high" ? <Tag>High priority</Tag> : null}
        </div>

        <p className="mt-1 truncate text-sm text-muted">
          {[
            DIRECTION_META[lead.direction].label,
            lead.productInterest,
            [lead.city, lead.country].filter(Boolean).join(", ") || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className="mt-1 text-xs text-muted">
          Raised by {author?.name ?? "someone no longer on the roster"} on{" "}
          {formatDate(lead.createdAt)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <Avatar person={assignee} size="sm" />
        <span className="text-[10px] text-muted">
          {assignee ? assignee.name.split(" ")[0] : "Unclaimed"}
        </span>
      </div>
    </Link>
  );
}
