import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentForm } from "@/components/comment-form";
import { LeadActions } from "@/components/lead-actions";
import {
  Avatar,
  Card,
  SectionHeading,
  StatusPill,
  Tag,
} from "@/components/ui";
import { getStore, storeKind } from "@/lib/db";
import { displayHost, formatDate, formatDateTime } from "@/lib/format";
import { DIRECTION_META, PRIORITY_META, STATUS_META } from "@/lib/status";
import { hubspotSyncState } from "@/lib/types";
import type { Lead, LeadEvent, Person } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Same reason as the chat route: metadata runs outside the layout guard.
  if (storeKind() === "unconfigured") return { title: "Lead" };

  const { id } = await params;
  const lead = await getStore().getLead(id);
  return { title: lead ? lead.hotelName : "Lead not found" };
}

/** One labelled fact. Renders nothing when the value is absent. */
function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  if (children === null || children === undefined || children === "") {
    return null;
  }
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <dt className="text-xs font-bold tracking-[0.12em] text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-words">{children}</dd>
    </div>
  );
}

function describeEvent(event: LeadEvent, peopleById: Map<string, Person>): string {
  const actor = event.actorId
    ? (peopleById.get(event.actorId)?.name ?? "Someone")
    : "The system";

  switch (event.type) {
    case "created":
      return `${actor} raised this lead`;
    case "status_changed":
      return `${actor} moved it from ${
        event.fromStatus ? STATUS_META[event.fromStatus].label : "nothing"
      } to ${event.toStatus ? STATUS_META[event.toStatus].label : "nothing"}`;
    case "assigned": {
      // `note` carries the new assignee id, or null when it was cleared.
      const target = event.note ? peopleById.get(event.note)?.name : null;
      return target
        ? `${actor} assigned it to ${target}`
        : `${actor} removed the owner`;
    }
    case "hubspot_synced":
      return "Pushed to HubSpot";
    case "note":
      return `${actor} added a note`;
    default:
      return `${actor} made a change`;
  }
}

function HubSpotPanel({ lead }: { lead: Lead }) {
  const state = hubspotSyncState(lead);

  const label = {
    idle: "Not pushed yet",
    synced: "Synced",
    failed: "Failed",
  }[state];

  const tone = {
    idle: "text-status-pending",
    synced: "text-status-won",
    failed: "text-status-lost",
  }[state];

  return (
    <div>
      <h2 className="text-xs font-bold tracking-[0.16em] uppercase">HubSpot</h2>
      <p className={`mt-3 text-sm font-bold ${tone}`}>{label}</p>
      {lead.hubspotSyncedAt ? (
        <p className="mt-1 text-xs text-muted">
          {formatDateTime(lead.hubspotSyncedAt)}
        </p>
      ) : null}
      {/*
        Never render hubspotSyncError verbatim. HubSpot rejection messages quote
        the offending request, which for these calls means the prospect's email
        or phone — and this page is reachable by anyone with the URL. The detail
        stays server-side; the page says only that it failed.
      */}
      {lead.hubspotSyncError ? (
        <p className="mt-1 text-xs text-status-lost">
          The last push was rejected. An admin can find the reason in the server
          logs.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        Pushing accepted leads to HubSpot arrives in Phase 5.
      </p>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = getStore();

  const [lead, people] = await Promise.all([
    store.getLead(id),
    store.listPeople(),
  ]);

  if (!lead) notFound();

  const [events, comments] = await Promise.all([
    store.listLeadEvents(id),
    store.listLeadComments(id),
  ]);

  const peopleById = new Map(people.map((p) => [p.id, p]));
  const author = peopleById.get(lead.createdBy) ?? null;
  const location = [lead.city, lead.country].filter(Boolean).join(", ");

  return (
    <>
      <nav className="mb-8">
        <Link
          href="/leads"
          className="text-sm font-bold underline decoration-1 underline-offset-4 hover:no-underline"
        >
          Back to the board
        </Link>
      </nav>

      <header className="mb-10">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={lead.status} />
          <Tag>{DIRECTION_META[lead.direction].label}</Tag>
          {lead.priority !== "normal" ? (
            <span
              className={`${PRIORITY_META[lead.priority].tone === "lost" ? "text-status-lost" : "text-status-pending"} inline-flex items-center rounded-full border border-current px-2.5 py-0.5 text-xs font-bold`}
            >
              {PRIORITY_META[lead.priority].label} priority
            </span>
          ) : null}
        </div>

        <h1 className="mt-4 text-4xl leading-[1.1]">{lead.hotelName}</h1>

        <p className="mt-3 text-sm text-muted">
          Raised by {author?.name ?? "someone no longer on the roster"} on{" "}
          {formatDate(lead.createdAt)}
          {location ? ` · ${location}` : ""}
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-12">
          <section>
            <SectionHeading>The hotel</SectionHeading>
            <dl>
              <Detail label="Website">
                {lead.website ? (
                  <a
                    href={lead.website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline decoration-1 underline-offset-2 hover:no-underline"
                  >
                    {displayHost(lead.website)}
                  </a>
                ) : null}
              </Detail>
              <Detail label="Location">{location || null}</Detail>
              <Detail label="Rooms">{lead.rooms}</Detail>
              <Detail label="Product interest">{lead.productInterest}</Detail>
            </dl>
          </section>

          <section>
            <SectionHeading>Who to talk to</SectionHeading>
            {lead.contactName || lead.contactEmail || lead.contactPhone ? (
              <dl>
                <Detail label="Name">{lead.contactName}</Detail>
                <Detail label="Email">
                  {lead.contactEmail ? (
                    <a
                      href={`mailto:${lead.contactEmail}`}
                      className="underline decoration-1 underline-offset-2 hover:no-underline"
                    >
                      {lead.contactEmail}
                    </a>
                  ) : null}
                </Detail>
                <Detail label="Phone">{lead.contactPhone}</Detail>
              </dl>
            ) : (
              <p className="text-sm text-muted">
                No contact recorded. Ask {author?.name.split(" ")[0] ?? "whoever raised it"} in the thread below.
              </p>
            )}
          </section>

          {lead.context ? (
            <section>
              <SectionHeading>Context</SectionHeading>
              {/* whitespace-pre-line keeps the author's paragraph breaks. */}
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {lead.context}
              </p>
            </section>
          ) : null}

          <section>
            <SectionHeading>
              Discussion{comments.length > 0 ? ` (${comments.length})` : ""}
            </SectionHeading>

            {comments.length > 0 ? (
              <ul className="mb-8 space-y-6">
                {comments.map((comment) => {
                  const commentAuthor =
                    peopleById.get(comment.authorId) ?? null;
                  return (
                    <li key={comment.id} className="flex gap-3">
                      <Avatar person={commentAuthor} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs">
                          <span className="font-bold">
                            {commentAuthor?.name ?? "Unknown"}
                          </span>
                          <span className="text-muted">
                            {" · "}
                            {formatDateTime(comment.createdAt)}
                          </span>
                        </p>
                        <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">
                          {comment.body}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mb-8 text-sm text-muted">
                Nothing yet. If you claimed this, say what you plan to do.
              </p>
            )}

            <CommentForm leadId={lead.id} />
          </section>
        </div>

        <aside className="space-y-12">
          <Card>
            <LeadActions lead={lead} people={people} />
          </Card>

          <Card>
            <HubSpotPanel lead={lead} />
          </Card>

          <section>
            <SectionHeading>History</SectionHeading>
            <ol className="space-y-4">
              {events.map((event) => (
                <li key={event.id} className="border-l border-line pl-4">
                  <p className="text-sm">{describeEvent(event, peopleById)}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDateTime(event.createdAt)}
                  </p>
                  {event.note && event.type !== "assigned" ? (
                    <p className="mt-1 text-xs italic">{event.note}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
