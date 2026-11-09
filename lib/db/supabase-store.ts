import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AppNotification,
  Channel,
  Conversation,
  DirectMessage,
  Lead,
  LeadComment,
  LeadEvent,
  Message,
  NewsItem,
  Person,
} from "../types";
import {
  SlugTakenError,
  type DataStore,
  type LeadFilter,
  type LeadPatch,
  type NewLead,
} from "./store";

/**
 * Supabase-backed store.
 *
 * Runs under the service-role key, which bypasses RLS. That is the whole point:
 * the database denies the publishable key everything, and every read and write
 * in the app arrives here from a server component or route handler that has
 * already checked the session. This module is `server-only` so it can never be pulled into a client
 * bundle alongside that key.
 *
 * Column names are snake_case in Postgres and camelCase in the domain types, so
 * every read goes through a mapper below rather than leaking row shapes upward.
 */

// Row shapes ------------------------------------------------------------------

interface PersonRow {
  id: string;
  name: string;
  email: string;
  role: Person["role"];
  territory: string | null;
  initials: string;
  active: boolean;
}

interface LeadRow {
  id: string;
  created_at: string;
  created_by: string;
  direction: Lead["direction"];
  hotel_name: string;
  website: string | null;
  city: string | null;
  country: string | null;
  rooms: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  product_interest: string | null;
  context: string | null;
  priority: Lead["priority"];
  status: Lead["status"];
  assigned_to: string | null;
  hubspot_contact_id: string | null;
  hubspot_company_id: string | null;
  hubspot_lead_id: string | null;
  hubspot_deal_id: string | null;
  hubspot_deal_outcome: Lead["hubspotDealOutcome"];
  outcome_at: string | null;
  hubspot_synced_at: string | null;
  hubspot_sync_state: Lead["hubspotSyncState"];
  hubspot_sync_error: Lead["hubspotSyncError"];
}

interface LeadEventRow {
  id: string;
  lead_id: string;
  actor_id: string | null;
  type: LeadEvent["type"];
  from_status: Lead["status"] | null;
  to_status: Lead["status"] | null;
  note: string | null;
  created_at: string;
}

interface LeadCommentRow {
  id: string;
  lead_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

interface ChannelRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  mentions: string[] | null;
}

interface NotificationRow {
  id: string;
  person_id: string;
  kind: AppNotification["kind"];
  actor_id: string | null;
  source_id: string;
  href: string;
  preview: string | null;
  created_at: string;
  read_at: string | null;
}

interface DirectMessageRow {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
}

interface NewsRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  category: string | null;
  author_id: string | null;
  published_at: string;
  pinned: boolean;
}

// Mappers ---------------------------------------------------------------------

const toPerson = (r: PersonRow): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  territory: r.territory,
  initials: r.initials,
  active: r.active,
});

const toLead = (r: LeadRow): Lead => ({
  id: r.id,
  createdAt: r.created_at,
  createdBy: r.created_by,
  direction: r.direction,
  hotelName: r.hotel_name,
  website: r.website,
  city: r.city,
  country: r.country,
  rooms: r.rooms,
  contactName: r.contact_name,
  contactEmail: r.contact_email,
  contactPhone: r.contact_phone,
  productInterest: r.product_interest,
  context: r.context,
  priority: r.priority,
  status: r.status,
  assignedTo: r.assigned_to,
  hubspotContactId: r.hubspot_contact_id,
  hubspotCompanyId: r.hubspot_company_id,
  hubspotLeadId: r.hubspot_lead_id,
  hubspotDealId: r.hubspot_deal_id,
  hubspotDealOutcome: r.hubspot_deal_outcome ?? null,
  outcomeAt: r.outcome_at ?? null,
  hubspotSyncedAt: r.hubspot_synced_at,
  hubspotSyncState: r.hubspot_sync_state,
  hubspotSyncError: r.hubspot_sync_error,
});

const toLeadEvent = (r: LeadEventRow): LeadEvent => ({
  id: r.id,
  leadId: r.lead_id,
  actorId: r.actor_id,
  type: r.type,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  note: r.note,
  createdAt: r.created_at,
});

const toLeadComment = (r: LeadCommentRow): LeadComment => ({
  id: r.id,
  leadId: r.lead_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
});

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  channelId: r.channel_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  // Older rows predate the column; the default is '{}' but be defensive.
  mentions: r.mentions ?? [],
});

const toNotification = (r: NotificationRow): AppNotification => ({
  id: r.id,
  personId: r.person_id,
  kind: r.kind,
  actorId: r.actor_id,
  sourceId: r.source_id,
  href: r.href,
  preview: r.preview,
  createdAt: r.created_at,
  readAt: r.read_at,
});

const toDirectMessage = (r: DirectMessageRow): DirectMessage => ({
  id: r.id,
  senderId: r.sender_id,
  recipientId: r.recipient_id,
  body: r.body,
  createdAt: r.created_at,
});

const toNews = (r: NewsRow): NewsItem => ({
  id: r.id,
  title: r.title,
  slug: r.slug,
  excerpt: r.excerpt,
  body: r.body,
  category: r.category,
  authorId: r.author_id,
  publishedAt: r.published_at,
  pinned: r.pinned,
});

// Client ----------------------------------------------------------------------

let cached: SupabaseClient | null = null;

/**
 * The project URL. `SUPABASE_URL` is the name going forward: since sign-in the
 * browser holds no Supabase client, so nothing needs the URL in the bundle. The
 * old `NEXT_PUBLIC_` name is still read so existing deployments keep working.
 */
export function supabaseUrl(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function client(): SupabaseClient {
  if (cached) return cached;

  const url = supabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are missing");
  }

  cached = createClient(url, serviceRoleKey, {
    // App sessions live in our own table; supabase-js keeps none of its own.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** The service-role client, for the sign-in store. Server-only, like this file. */
export const serviceClient = client;

/**
 * Postgres errors quote the offending row, which for `leads` means prospect
 * contact details. Raising a generic error keeps that out of logs and out of
 * anything that might reach the browser; the route handlers turn this into a
 * generic response anyway.
 */
function fail(operation: string): never {
  throw new Error(`Supabase ${operation} failed`);
}

/** Postgres: invalid input syntax for type — e.g. a non-UUID in a uuid column. */
const INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * True when a lookup failed because the id could not be a uuid at all.
 *
 * Such an id cannot match any row, so the honest answer is "not found" rather
 * than an error. Without this, `/leads/anything` returns 500 on a URL anyone can
 * reach, and an API call carrying a malformed person id gets a 500 instead of
 * the 400 the handler is written to return.
 */
function isUnmatchableId(error: { code?: string } | null): boolean {
  return error?.code === INVALID_TEXT_REPRESENTATION;
}

/**
 * A canonical uuid, and nothing else.
 *
 * `.or()` takes a filter STRING, so a value interpolated into it is parsed as
 * PostgREST syntax: a crafted id like `x),id.not.is.null,or(id.is.null` would
 * add its own conditions and return other people's direct messages. Every value
 * that goes into such a string must pass this first; ids that cannot be a uuid
 * cannot match a row anyway.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

/** Postgres: unique constraint violated. */
const UNIQUE_VIOLATION = "23505";

function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

// Store -----------------------------------------------------------------------

export const supabaseStore: DataStore = {
  async listPeople() {
    const { data, error } = await client()
      .from("people")
      .select("*")
      .order("name");
    if (error) fail("listPeople");
    return (data as PersonRow[]).map(toPerson);
  },

  async getPerson(id) {
    const { data, error } = await client()
      .from("people")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isUnmatchableId(error)) return null;
      fail("getPerson");
    }
    return data ? toPerson(data as PersonRow) : null;
  },

  async listLeads(filter: LeadFilter = {}) {
    let query = client()
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (filter.direction) query = query.eq("direction", filter.direction);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.assignedTo) query = query.eq("assigned_to", filter.assignedTo);

    const { data, error } = await query;
    if (error) fail("listLeads");
    return (data as LeadRow[]).map(toLead);
  },

  async getLead(id) {
    const { data, error } = await client()
      .from("leads")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isUnmatchableId(error)) return null;
      fail("getLead");
    }
    return data ? toLead(data as LeadRow) : null;
  },

  async createLead(input: NewLead) {
    const { data, error } = await client()
      .from("leads")
      .insert({
        created_by: input.createdBy,
        direction: input.direction,
        hotel_name: input.hotelName,
        website: input.website ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        rooms: input.rooms ?? null,
        contact_name: input.contactName ?? null,
        contact_email: input.contactEmail ?? null,
        contact_phone: input.contactPhone ?? null,
        product_interest: input.productInterest ?? null,
        context: input.context ?? null,
        priority: input.priority ?? "normal",
        /*
         * Assigning at creation leaves the status "new": someone owns it, but
         * they have not acted yet. The board's "unclaimed" count keys off
         * assigned_to, so an assigned lead correctly drops out of it.
         */
        assigned_to: input.assignedTo ?? null,
      })
      .select("*")
      .single();
    if (error) fail("createLead");

    const lead = toLead(data as LeadRow);

    /*
     * Timestamps are set explicitly and one millisecond apart rather than left
     * to the column default. Both rows go in one statement, so now() would give
     * them the SAME created_at — and listLeadEvents orders by created_at alone,
     * leaving Postgres free to return "assigned" before "created". The
     * timeline would then read as though the lead were assigned before it
     * existed. Distinct timestamps make the chronology real rather than relying
     * on row order.
     */
    const createdAt = new Date(lead.createdAt);
    const assignedAt = new Date(createdAt.getTime() + 1);

    const events: Record<string, unknown>[] = [
      {
        lead_id: lead.id,
        actor_id: input.createdBy,
        type: "created",
        to_status: "new",
        created_at: createdAt.toISOString(),
      },
    ];
    // A second event so the timeline shows the assignment, not just creation.
    if (lead.assignedTo) {
      events.push({
        lead_id: lead.id,
        actor_id: input.createdBy,
        type: "assigned",
        note: lead.assignedTo,
        created_at: assignedAt.toISOString(),
      });
    }
    await client().from("lead_events").insert(events);

    return lead;
  },

  async updateLead(id, patch: LeadPatch, actorId) {
    const before = await this.getLead(id);
    if (!before) fail("updateLead");

    const changes: Record<string, unknown> = {};
    if (patch.status !== undefined) changes.status = patch.status;
    if (patch.assignedTo !== undefined) changes.assigned_to = patch.assignedTo;
    if (patch.priority !== undefined) changes.priority = patch.priority;

    const { data, error } = await client()
      .from("leads")
      .update(changes)
      .eq("id", id)
      .select("*")
      .single();
    if (error) fail("updateLead");

    /*
     * Events are written after the update succeeds, so a failure here leaves a
     * correct lead with a missing history entry rather than a phantom event.
     * The two are not in one transaction: doing that properly needs a Postgres
     * function, which is worth adding if the timeline ever has to be relied on
     * for anything beyond human context.
     */
    const events: Record<string, unknown>[] = [];
    if (patch.status !== undefined && patch.status !== before.status) {
      events.push({
        lead_id: id,
        actor_id: actorId,
        type: "status_changed",
        from_status: before.status,
        to_status: patch.status,
      });
    }
    if (patch.assignedTo !== undefined && patch.assignedTo !== before.assignedTo) {
      events.push({
        lead_id: id,
        actor_id: actorId,
        type: "assigned",
        // `note` carries the new assignee id, matching the file store.
        note: patch.assignedTo,
      });
    }
    if (events.length > 0) {
      await client().from("lead_events").insert(events);
    }

    return toLead(data as LeadRow);
  },

  /*
   * HubSpot queue. The state machine lives in Postgres (migration 0009); these
   * are thin calls so the rules stay in one transactional place.
   */
  async hubspotClaim(limit, leaseSeconds) {
    const { data, error } = await client().rpc("hubspot_claim", {
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    });
    if (error) fail("hubspotClaim");
    return (data as { lead_id: string; lease_token: string; revision: number }[]).map((r) => ({
      leadId: r.lead_id,
      leaseToken: r.lease_token,
      revision: r.revision,
    }));
  },

  async hubspotRequest(leadId) {
    if (!isUuid(leadId)) return false;
    const { data, error } = await client().rpc("hubspot_request", { p_lead: leadId });
    if (error) fail("hubspotRequest");
    return data === true;
  },

  async hubspotSaveIds(leadId, leaseToken, ids) {
    const { data, error } = await client().rpc("hubspot_save_ids", {
      p_lead: leadId,
      p_lease: leaseToken,
      p_contact_id: ids.contactId ?? null,
      p_company_id: ids.companyId ?? null,
      p_lead_id: ids.leadId ?? null,
      p_note_id: ids.noteId ?? null,
    });
    if (error) fail("hubspotSaveIds");
    return data === true;
  },

  async hubspotComplete(leadId, leaseToken, revision, warning) {
    const { data, error } = await client().rpc("hubspot_complete", {
      p_lead: leadId,
      p_lease: leaseToken,
      p_revision: revision,
      p_warning: warning,
    });
    if (error) fail("hubspotComplete");
    return data === true;
  },

  async hubspotFail(leadId, leaseToken, code, options) {
    const { data, error } = await client().rpc("hubspot_fail", {
      p_lead: leadId,
      p_lease: leaseToken,
      p_code: code,
      p_retryable: options.retryable,
      p_blocked: options.blocked,
    });
    if (error) fail("hubspotFail");
    return data === true;
  },

  async hubspotRenew(leadId, leaseToken, seconds) {
    const { data, error } = await client().rpc("hubspot_renew", {
      p_lead: leadId,
      p_lease: leaseToken,
      p_seconds: seconds,
    });
    if (error) fail("hubspotRenew");
    return data === true;
  },

  async hubspotClaimCompany(domain, token) {
    const { data, error } = await client().rpc("hubspot_claim_company", {
      p_domain: domain,
      p_token: token,
    });
    if (error) fail("hubspotClaimCompany");
    const row = (data as { company_id: string | null; mine: boolean; uncertain: boolean }[])[0];
    return { companyId: row?.company_id ?? null, mine: row?.mine === true, uncertain: row?.uncertain === true };
  },

  async hubspotMarkCompanyUncertain(domain, token) {
    const { data, error } = await client().rpc("hubspot_mark_company_uncertain", {
      p_domain: domain,
      p_token: token,
    });
    if (error) fail("hubspotMarkCompanyUncertain");
    return data === true;
  },

  async hubspotSetCompany(domain, token, companyId) {
    const { data, error } = await client().rpc("hubspot_set_company", {
      p_domain: domain,
      p_token: token,
      p_company_id: companyId,
    });
    if (error) fail("hubspotSetCompany");
    return data === true;
  },

  async hubspotSaveDeal(leadId, leaseToken, dealId, outcome) {
    const { data, error } = await client().rpc("hubspot_save_deal", {
      p_lead: leadId,
      p_lease: leaseToken,
      p_deal_id: dealId,
      p_set_outcome: outcome !== undefined,
      p_outcome: outcome?.value ?? null,
    });
    if (error) fail("hubspotSaveDeal");
    return data === true;
  },

  async hubspotRequeue(leadId) {
    const { error } = await client().rpc("hubspot_requeue", { p_lead: leadId });
    if (error) fail("hubspotRequeue");
  },

  async hubspotNoteId(leadId) {
    if (!isUuid(leadId)) return null;
    const { data, error } = await client()
      .from("leads")
      .select("hubspot_note_id")
      .eq("id", leadId)
      .maybeSingle();
    if (error) fail("hubspotNoteId");
    return (data as { hubspot_note_id: string | null } | null)?.hubspot_note_id ?? null;
  },

  async listLeadEvents(leadId) {
    const { data, error } = await client()
      .from("lead_events")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at");
    if (error) fail("listLeadEvents");
    return (data as LeadEventRow[]).map(toLeadEvent);
  },

  async listLeadComments(leadId) {
    const { data, error } = await client()
      .from("lead_comments")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at");
    if (error) fail("listLeadComments");
    return (data as LeadCommentRow[]).map(toLeadComment);
  },

  async createLeadComment(input) {
    const { data, error } = await client()
      .from("lead_comments")
      .insert({
        lead_id: input.leadId,
        author_id: input.authorId,
        body: input.body,
      })
      .select("*")
      .single();
    if (error) fail("createLeadComment");
    return toLeadComment(data as LeadCommentRow);
  },

  async listChannels() {
    const { data, error } = await client()
      .from("channels")
      .select("*")
      .order("created_at");
    if (error) fail("listChannels");
    return (data as ChannelRow[]).map(toChannel);
  },

  async getChannelBySlug(slug) {
    const { data, error } = await client()
      .from("channels")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) fail("getChannelBySlug");
    return data ? toChannel(data as ChannelRow) : null;
  },

  async listMessages(channelId, limit = 200) {
    /*
     * Take the newest `limit` rows, then reverse, so a long-running channel
     * returns its most recent messages rather than its oldest.
     */
    const { data, error } = await client()
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail("listMessages");
    return (data as MessageRow[]).map(toMessage).reverse();
  },

  async listMessagesSince(channelId, after, limit) {
    const { data, error } = await client()
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .gte("created_at", after)
      .order("created_at")
      .limit(limit);
    if (error) {
      if (isUnmatchableId(error)) return [];
      fail("listMessagesSince");
    }
    return (data as MessageRow[]).map(toMessage);
  },

  async createMessage(input) {
    const { data, error } = await client()
      .from("messages")
      .insert({
        channel_id: input.channelId,
        author_id: input.authorId,
        body: input.body,
        mentions: input.mentions ?? [],
      })
      .select("*")
      .single();
    if (error) fail("createMessage");
    return toMessage(data as MessageRow);
  },

  /*
   * Direct messages are read here, under the service-role key, because the
   * table grants the publishable key nothing. See migration 0004 for why.
   */
  async listConversations(personId) {
    // Interpolated into a filter string below: uuid or nothing. See isUuid.
    if (!isUuid(personId)) return [];
    const { data, error } = await client()
      .from("direct_messages")
      .select("*")
      .or(`sender_id.eq.${personId},recipient_id.eq.${personId}`)
      .order("created_at", { ascending: false });
    if (error) {
      if (isUnmatchableId(error)) return [];
      fail("listConversations");
    }

    /*
     * Grouped in JS rather than SQL. A DISTINCT ON over the normalised pair
     * would be tidier, but it needs an RPC, and these volumes are tiny — one
     * internal team messaging each other.
     */
    const rows = (data as DirectMessageRow[]).map(toDirectMessage);
    const byPerson = new Map<string, DirectMessage[]>();
    for (const m of rows) {
      const other = m.senderId === personId ? m.recipientId : m.senderId;
      const bucket = byPerson.get(other);
      if (bucket) bucket.push(m);
      else byPerson.set(other, [m]);
    }

    const conversations: Conversation[] = [...byPerson.entries()].map(
      ([otherId, items]) => ({
        personId: otherId,
        // Query was newest-first, so the head of each bucket is the latest.
        lastMessage: items[0],
        messageCount: items.length,
      }),
    );
    return conversations.sort((a, b) =>
      b.lastMessage.createdAt.localeCompare(a.lastMessage.createdAt),
    );
  },

  async listDirectMessages(personA, personB, limit = 200) {
    // Interpolated into a filter string below: uuid or nothing. See isUuid.
    if (!isUuid(personA) || !isUuid(personB)) return [];
    const { data, error } = await client()
      .from("direct_messages")
      .select("*")
      .or(
        `and(sender_id.eq.${personA},recipient_id.eq.${personB}),` +
          `and(sender_id.eq.${personB},recipient_id.eq.${personA})`,
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isUnmatchableId(error)) return [];
      fail("listDirectMessages");
    }
    return (data as DirectMessageRow[]).map(toDirectMessage).reverse();
  },

  async createDirectMessage(input) {
    const { data, error } = await client()
      .from("direct_messages")
      .insert({
        sender_id: input.senderId,
        recipient_id: input.recipientId,
        body: input.body,
      })
      .select("*")
      .single();
    if (error) fail("createDirectMessage");
    return toDirectMessage(data as DirectMessageRow);
  },

  async createNotifications(inputs) {
    if (inputs.length === 0) return;
    const { error } = await client()
      .from("notifications")
      .insert(
        inputs.map((n) => ({
          person_id: n.personId,
          kind: n.kind,
          actor_id: n.actorId,
          source_id: n.sourceId,
          href: n.href,
          preview: n.preview ?? null,
        })),
      );
    /*
     * A failed notification must not fail the message that caused it. Someone
     * losing a bell badge is a far smaller problem than their message not
     * sending, so this is swallowed rather than thrown.
     */
    if (error) console.warn("notification insert failed");
  },

  async listUnreadNotifications(personId, limit = 30) {
    const { data, error } = await client()
      .from("notifications")
      .select("*")
      .eq("person_id", personId)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      if (isUnmatchableId(error)) return [];
      fail("listUnreadNotifications");
    }
    return (data as NotificationRow[]).map(toNotification);
  },

  async markNotificationsRead(personId, ids) {
    let query = client()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      // Always scoped to this person, so ids belonging to someone else are a
      // no-op rather than a way to clear their bell.
      .eq("person_id", personId)
      .is("read_at", null);
    if (ids && ids.length > 0) query = query.in("id", ids);

    const { data, error } = await query.select("id");
    if (error) {
      if (isUnmatchableId(error)) return 0;
      fail("markNotificationsRead");
    }
    return (data as { id: string }[]).length;
  },

  async listNews(limit) {
    let query = client()
      .from("news")
      .select("*")
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false });
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) fail("listNews");
    return (data as NewsRow[]).map(toNews);
  },

  async getNewsBySlug(slug) {
    const { data, error } = await client()
      .from("news")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error) fail("getNewsBySlug");
    return data ? toNews(data as NewsRow) : null;
  },

  async createNews(input) {
    const { data, error } = await client()
      .from("news")
      .insert({
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt ?? null,
        body: input.body,
        category: input.category ?? null,
        author_id: input.authorId,
        pinned: input.pinned ?? false,
      })
      .select("*")
      .single();
    if (error) {
      // Surface a slug clash distinctly so the caller can pick another.
      if (isDuplicate(error)) throw new SlugTakenError(input.slug);
      fail("createNews");
    }
    return toNews(data as NewsRow);
  },
};
