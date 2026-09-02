import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Channel,
  Lead,
  LeadComment,
  LeadEvent,
  Message,
  NewsItem,
  Person,
} from "../types";
import {
  SEED_CHANNELS,
  SEED_LEAD_COMMENTS,
  SEED_LEAD_EVENTS,
  SEED_LEADS,
  SEED_MESSAGES,
  SEED_NEWS,
  SEED_PEOPLE,
} from "./seed";
import {
  SlugTakenError,
  type DataStore,
  type HubSpotResult,
  type LeadFilter,
  type LeadPatch,
  type NewLead,
} from "./store";

/**
 * Development-only data store backed by a JSON file in .data/.
 *
 * It exists so the entire UI can be built and exercised before Supabase
 * credentials are available. It is deliberately simple: the whole database is
 * one object, read once and written on every mutation.
 *
 * This is NOT a production store. It has no real concurrency control beyond a
 * single-process write queue, and a serverless deployment would give every
 * instance its own copy of the file. `assertUsable` below makes that failure
 * loud rather than silent, unless ALLOW_DEV_STORE=true opts into it knowingly.
 */

interface Database {
  people: Person[];
  leads: Lead[];
  leadEvents: LeadEvent[];
  leadComments: LeadComment[];
  channels: Channel[];
  messages: Message[];
  news: NewsItem[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

function seedDatabase(): Database {
  return {
    people: structuredClone(SEED_PEOPLE),
    leads: structuredClone(SEED_LEADS),
    leadEvents: structuredClone(SEED_LEAD_EVENTS),
    leadComments: structuredClone(SEED_LEAD_COMMENTS),
    channels: structuredClone(SEED_CHANNELS),
    messages: structuredClone(SEED_MESSAGES),
    news: structuredClone(SEED_NEWS),
  };
}

function assertUsable(): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_DEV_STORE !== "true"
  ) {
    throw new Error(
      "The file-backed development store cannot run in production. " +
        "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and " +
        "SUPABASE_SERVICE_ROLE_KEY to use the Supabase store, or set " +
        "ALLOW_DEV_STORE=true to accept ephemeral local disk.",
    );
  }
}

/*
 * Cached on globalThis so the dev server's module reloading does not reset
 * state between requests, and so concurrent requests share one write queue.
 */
const globalForStore = globalThis as unknown as {
  __leadHubDb?: Promise<Database>;
  __leadHubWriteQueue?: Promise<unknown>;
};

async function load(): Promise<Database> {
  let raw: string;
  try {
    raw = await readFile(DATA_FILE, "utf8");
  } catch (error) {
    /*
     * Seed ONLY when the file genuinely does not exist. Treating every read
     * failure as "no database yet" would persist a fresh seed over a file that
     * was merely locked, permission-denied, or half-written, destroying every
     * locally created lead, comment and message.
     */
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const seeded = seedDatabase();
      await persist(seeded);
      return seeded;
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as Database;
  } catch {
    // Corrupt JSON is a problem to surface, never something to overwrite.
    throw new Error(
      `${DATA_FILE} is not valid JSON. Inspect or delete it — deleting reseeds ` +
        `from lib/db/seed.ts and loses any locally created data.`,
    );
  }
}

function db(): Promise<Database> {
  const cached = globalForStore.__leadHubDb;
  if (cached) return cached;

  const pending = load();
  globalForStore.__leadHubDb = pending;
  /*
   * Drop a rejected promise from the cache, otherwise one transient read
   * failure is memoised and every later request fails with the same error.
   */
  pending.catch(() => {
    if (globalForStore.__leadHubDb === pending) {
      globalForStore.__leadHubDb = undefined;
    }
  });
  return pending;
}

async function persist(data: Database): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  // Write-then-rename so an interrupted write cannot truncate the database.
  const tmp = `${DATA_FILE}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, DATA_FILE);
}

/**
 * Serialises mutations. Without this, two concurrent requests could each read
 * the database, mutate their own copy, and the second write would drop the
 * first change.
 */
function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalForStore.__leadHubWriteQueue ?? Promise.resolve();
  const result = previous.then(fn, fn);
  // Swallow rejections on the queue itself so one failure cannot poison later writes.
  globalForStore.__leadHubWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function mutate<T>(fn: (data: Database) => T | Promise<T>): Promise<T> {
  assertUsable();
  return withWriteLock(async () => {
    const data = await db();
    const result = await fn(data);
    await persist(data);
    return result;
  });
}

async function read<T>(fn: (data: Database) => T): Promise<T> {
  assertUsable();
  return fn(await db());
}

const newest = (a: { createdAt: string }, b: { createdAt: string }) =>
  b.createdAt.localeCompare(a.createdAt);
const oldest = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt.localeCompare(b.createdAt);

export const fileStore: DataStore = {
  async listPeople() {
    return read((d) =>
      [...d.people].sort((a, b) => a.name.localeCompare(b.name)),
    );
  },

  async getPerson(id) {
    return read((d) => d.people.find((p) => p.id === id) ?? null);
  },

  async listLeads(filter: LeadFilter = {}) {
    return read((d) =>
      d.leads
        .filter((l) => !filter.direction || l.direction === filter.direction)
        .filter((l) => !filter.status || l.status === filter.status)
        .filter((l) => !filter.assignedTo || l.assignedTo === filter.assignedTo)
        .sort(newest),
    );
  },

  async getLead(id) {
    return read((d) => d.leads.find((l) => l.id === id) ?? null);
  },

  async createLead(input: NewLead) {
    return mutate((d) => {
      const now = new Date().toISOString();
      const lead: Lead = {
        id: randomUUID(),
        createdAt: now,
        createdBy: input.createdBy,
        direction: input.direction,
        hotelName: input.hotelName,
        website: input.website ?? null,
        city: input.city ?? null,
        country: input.country ?? null,
        rooms: input.rooms ?? null,
        contactName: input.contactName ?? null,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        productInterest: input.productInterest ?? null,
        context: input.context ?? null,
        priority: input.priority ?? "normal",
        status: "new",
        assignedTo: null,
        hubspotContactId: null,
        hubspotCompanyId: null,
        hubspotDealId: null,
        hubspotSyncedAt: null,
        hubspotSyncError: null,
      };
      d.leads.push(lead);
      d.leadEvents.push({
        id: randomUUID(),
        leadId: lead.id,
        actorId: input.createdBy,
        type: "created",
        fromStatus: null,
        toStatus: "new",
        note: null,
        createdAt: now,
      });
      return lead;
    });
  },

  async updateLead(id, patch: LeadPatch, actorId) {
    return mutate((d) => {
      const lead = d.leads.find((l) => l.id === id);
      if (!lead) throw new Error(`Lead ${id} not found`);
      const now = new Date().toISOString();

      if (patch.status && patch.status !== lead.status) {
        d.leadEvents.push({
          id: randomUUID(),
          leadId: id,
          actorId,
          type: "status_changed",
          fromStatus: lead.status,
          toStatus: patch.status,
          note: null,
          createdAt: now,
        });
        lead.status = patch.status;
      }

      if (patch.assignedTo !== undefined && patch.assignedTo !== lead.assignedTo) {
        d.leadEvents.push({
          id: randomUUID(),
          leadId: id,
          actorId,
          type: "assigned",
          fromStatus: null,
          toStatus: null,
          note: patch.assignedTo,
          createdAt: now,
        });
        lead.assignedTo = patch.assignedTo;
      }

      if (patch.priority) lead.priority = patch.priority;

      return structuredClone(lead);
    });
  },

  async recordHubSpotResult(id, result: HubSpotResult) {
    return mutate((d) => {
      const lead = d.leads.find((l) => l.id === id);
      if (!lead) throw new Error(`Lead ${id} not found`);
      const now = new Date().toISOString();

      if (result.error) {
        lead.hubspotSyncError = result.error;
      } else {
        lead.hubspotContactId = result.contactId ?? lead.hubspotContactId;
        lead.hubspotCompanyId = result.companyId ?? lead.hubspotCompanyId;
        lead.hubspotDealId = result.dealId ?? lead.hubspotDealId;
        lead.hubspotSyncedAt = now;
        lead.hubspotSyncError = null;
        d.leadEvents.push({
          id: randomUUID(),
          leadId: id,
          actorId: null,
          type: "hubspot_synced",
          fromStatus: null,
          toStatus: null,
          note: null,
          createdAt: now,
        });
      }

      return structuredClone(lead);
    });
  },

  async listLeadEvents(leadId) {
    return read((d) =>
      d.leadEvents.filter((e) => e.leadId === leadId).sort(oldest),
    );
  },

  async listLeadComments(leadId) {
    return read((d) =>
      d.leadComments.filter((c) => c.leadId === leadId).sort(oldest),
    );
  },

  async createLeadComment(input) {
    return mutate((d) => {
      const comment: LeadComment = {
        id: randomUUID(),
        leadId: input.leadId,
        authorId: input.authorId,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      d.leadComments.push(comment);
      return comment;
    });
  },

  async listChannels() {
    return read((d) => [...d.channels]);
  },

  async getChannelBySlug(slug) {
    return read((d) => d.channels.find((c) => c.slug === slug) ?? null);
  },

  async listMessages(channelId, limit = 200) {
    return read((d) =>
      d.messages
        .filter((m) => m.channelId === channelId)
        .sort(oldest)
        .slice(-limit),
    );
  },

  async createMessage(input) {
    return mutate((d) => {
      const message: Message = {
        id: randomUUID(),
        channelId: input.channelId,
        authorId: input.authorId,
        body: input.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
      };
      d.messages.push(message);
      return message;
    });
  },

  async listNews(limit) {
    return read((d) => {
      const sorted = [...d.news].sort((a, b) => {
        // Pinned items lead, then most recent first.
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.publishedAt.localeCompare(a.publishedAt);
      });
      return limit ? sorted.slice(0, limit) : sorted;
    });
  },

  async getNewsBySlug(slug) {
    return read((d) => d.news.find((n) => n.slug === slug) ?? null);
  },

  async createNews(input) {
    return mutate((d) => {
      /*
       * Must be the same error type the Supabase store raises, so the route's
       * collision retry works on either store. A plain Error here made a
       * concurrent publish return 500 instead of trying the next suffix.
       */
      if (d.news.some((n) => n.slug === input.slug)) {
        throw new SlugTakenError(input.slug);
      }
      const item: NewsItem = {
        id: randomUUID(),
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt ?? null,
        body: input.body,
        category: input.category ?? null,
        authorId: input.authorId,
        publishedAt: new Date().toISOString(),
        pinned: input.pinned ?? false,
      };
      d.news.push(item);
      return item;
    });
  },
};
