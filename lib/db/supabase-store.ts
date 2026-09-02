import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
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
  type HubSpotResult,
  type LeadFilter,
  type LeadPatch,
  type NewLead,
} from "./store";

/**
 * Supabase-backed store.
 *
 * Runs under the service-role key, which bypasses RLS. That is the whole point:
 * the database denies the anon key everything except reading `channels` and
 * `messages`, and every write in the app arrives here from a route handler
 * instead. This module is `server-only` so it can never be pulled into a client
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
  hubspot_deal_id: string | null;
  hubspot_synced_at: string | null;
  hubspot_sync_error: string | null;
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
  hubspotDealId: r.hubspot_deal_id,
  hubspotSyncedAt: r.hubspot_synced_at,
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

function client(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Supabase environment variables are missing");
  }

  cached = createClient(url, serviceRoleKey, {
    // No user sessions exist, so there is nothing to persist or refresh.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

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
      })
      .select("*")
      .single();
    if (error) fail("createLead");

    const lead = toLead(data as LeadRow);

    await client().from("lead_events").insert({
      lead_id: lead.id,
      actor_id: input.createdBy,
      type: "created",
      to_status: "new",
    });

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

  async recordHubSpotResult(id, result: HubSpotResult) {
    const changes: Record<string, unknown> = result.error
      ? { hubspot_sync_error: result.error }
      : {
          hubspot_contact_id: result.contactId ?? null,
          hubspot_company_id: result.companyId ?? null,
          hubspot_deal_id: result.dealId ?? null,
          hubspot_synced_at: new Date().toISOString(),
          hubspot_sync_error: null,
        };

    const { data, error } = await client()
      .from("leads")
      .update(changes)
      .eq("id", id)
      .select("*")
      .single();
    if (error) fail("recordHubSpotResult");

    if (!result.error) {
      await client().from("lead_events").insert({
        lead_id: id,
        actor_id: null,
        type: "hubspot_synced",
      });
    }

    return toLead(data as LeadRow);
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
   * table grants the anon key nothing. See migration 0004 for why.
   */
  async listConversations(personId) {
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
