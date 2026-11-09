import type {
  AppNotification,
  HubSpotErrorCode,
  Channel,
  Conversation,
  DirectMessage,
  Lead,
  LeadComment,
  LeadDirection,
  LeadEvent,
  LeadStatus,
  Message,
  NewsItem,
  Person,
} from "../types";

/**
 * The data-access contract.
 *
 * Everything the app reads or writes goes through this interface, so the
 * Supabase-backed implementation and the local development store stay
 * interchangeable and pages never build queries inline.
 */

export interface LeadFilter {
  direction?: LeadDirection;
  status?: LeadStatus;
  assignedTo?: string;
}

export interface NewLead {
  createdBy: string;
  direction: LeadDirection;
  hotelName: string;
  website?: string | null;
  city?: string | null;
  country?: string | null;
  rooms?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  productInterest?: string | null;
  context?: string | null;
  priority?: Lead["priority"];
  /** Optional owner at creation; null leaves the lead unclaimed. */
  assignedTo?: string | null;
}

/** Fields a user may change after creation. Deliberately narrow. */
export interface LeadPatch {
  status?: LeadStatus;
  assignedTo?: string | null;
  priority?: Lead["priority"];
}

/**
 * Raised when a news slug is already taken.
 *
 * Lives here rather than in one store so BOTH implementations signal a
 * collision the same way, and the route's retry works regardless of which
 * store is active. Carries no row content, so acting on it leaks nothing.
 */
export class SlugTakenError extends Error {
  constructor(public readonly slug: string) {
    super("News slug already taken");
    this.name = "SlugTakenError";
  }
}

export interface NewNews {
  title: string;
  /** Unique, URL-safe. Derived from the title server-side. */
  slug: string;
  excerpt?: string | null;
  /** Markdown. Rendered without raw-HTML support, so it cannot inject markup. */
  body: string;
  category?: string | null;
  authorId: string;
  pinned?: boolean;
}

export interface NewNotification {
  personId: string;
  kind: AppNotification["kind"];
  actorId: string | null;
  sourceId: string;
  href: string;
  preview?: string | null;
}

/** A lead claimed by a HubSpot worker. Only the lease holder may record results. */
export interface HubSpotClaim {
  leadId: string;
  leaseToken: string;
  /** The revision being synced; later changes re-queue the lead. */
  revision: number;
}

/** HubSpot objects created so far. Null leaves a stored id alone. */
export interface HubSpotIds {
  contactId?: string | null;
  companyId?: string | null;
  leadId?: string | null;
  noteId?: string | null;
}

export interface DataStore {
  // People ------------------------------------------------------------------
  listPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | null>;

  // Leads -------------------------------------------------------------------
  listLeads(filter?: LeadFilter): Promise<Lead[]>;
  getLead(id: string): Promise<Lead | null>;
  createLead(input: NewLead): Promise<Lead>;
  /**
   * Applies the patch and records the corresponding audit events.
   * `actorId` is an attribution label only, never an authorisation claim.
   */
  updateLead(
    id: string,
    patch: LeadPatch,
    actorId: string | null,
  ): Promise<Lead>;

  // HubSpot sync queue (migration 0009) ---------------------------------------
  // The queue state is set by the database in the same statement that creates
  // or changes a lead; these only move it along.
  /** Claims due leads with a lease. Expired leases are reclaimed. */
  hubspotClaim(limit: number, leaseSeconds: number): Promise<HubSpotClaim[]>;
  /** Queues a manual send or a retry. False when there is nothing to do. */
  hubspotRequest(leadId: string): Promise<boolean>;
  /** Stores HubSpot ids as soon as they exist. False if the lease was lost. */
  hubspotSaveIds(leadId: string, leaseToken: string, ids: HubSpotIds): Promise<boolean>;
  hubspotComplete(
    leadId: string,
    leaseToken: string,
    revision: number,
    warning: HubSpotErrorCode | null,
  ): Promise<boolean>;
  hubspotFail(
    leadId: string,
    leaseToken: string,
    code: HubSpotErrorCode,
    options: { retryable: boolean; blocked: boolean },
  ): Promise<boolean>;
  /** The saved HubSpot note id, which the Lead type does not carry. */
  hubspotNoteId(leadId: string): Promise<string | null>;
  /**
   * Extends a live lease. False means it expired (and may have been
   * reclaimed): the caller must stop before writing anything to HubSpot.
   */
  hubspotRenew(leadId: string, leaseToken: string, seconds: number): Promise<boolean>;
  /**
   * Domain registry, so two workers never both create one company. Returns the
   * known company id, or `mine` when the caller should find or create it, or
   * neither when another worker is creating it right now.
   */
  hubspotClaimCompany(
    domain: string,
    token: string,
  ): Promise<{ companyId: string | null; mine: boolean; uncertain: boolean }>;
  hubspotSetCompany(domain: string, token: string, companyId: string): Promise<boolean>;
  /** A create's answer was lost: from now on only search for it, never create. */
  hubspotMarkCompanyUncertain(domain: string, token: string): Promise<boolean>;

  listLeadEvents(leadId: string): Promise<LeadEvent[]>;
  listLeadComments(leadId: string): Promise<LeadComment[]>;
  createLeadComment(input: {
    leadId: string;
    authorId: string;
    body: string;
  }): Promise<LeadComment>;

  // Chat --------------------------------------------------------------------
  listChannels(): Promise<Channel[]>;
  getChannelBySlug(slug: string): Promise<Channel | null>;
  listMessages(channelId: string, limit?: number): Promise<Message[]>;
  /**
   * Messages at or after `after` (inclusive), oldest first. Drives chat
   * polling; inclusive so a message sharing the cursor's timestamp is never
   * missed, and the caller de-duplicates by id.
   */
  listMessagesSince(channelId: string, after: string, limit: number): Promise<Message[]>;
  createMessage(input: {
    channelId: string;
    authorId: string;
    body: string;
    mentions?: string[];
  }): Promise<Message>;

  // Direct messages ---------------------------------------------------------
  /**
   * Conversations involving `personId`, most recently active first.
   * Server-side only: this table has no anon access by design.
   */
  listConversations(personId: string): Promise<Conversation[]>;
  /** The thread between two people, oldest first. Order of arguments is irrelevant. */
  listDirectMessages(
    personA: string,
    personB: string,
    limit?: number,
  ): Promise<DirectMessage[]>;
  createDirectMessage(input: {
    senderId: string;
    recipientId: string;
    body: string;
  }): Promise<DirectMessage>;

  // Notifications -----------------------------------------------------------
  /**
   * Records notifications. Server-side only, and the caller is responsible for
   * never notifying someone about their own action.
   *
   * MUST NOT THROW. Every implementation swallows its own failures and logs
   * instead.
   *
   * A notification is always a side effect of something more important that has
   * already been persisted — a lead created, a message sent, an owner changed.
   * If this threw, the route handler around it would return 500 for work that
   * actually succeeded, and the person would retry and duplicate it. Losing a
   * bell badge is a far smaller problem than that.
   */
  createNotifications(inputs: NewNotification[]): Promise<void>;
  /** Unread notifications for one person, newest first. */
  listUnreadNotifications(
    personId: string,
    limit?: number,
  ): Promise<AppNotification[]>;
  /**
   * Marks notifications read. With no ids, marks all of this person's unread
   * ones. `personId` is always applied, so a caller cannot mark someone
   * else's notifications by passing their ids.
   */
  markNotificationsRead(personId: string, ids?: string[]): Promise<number>;

  // News --------------------------------------------------------------------
  listNews(limit?: number): Promise<NewsItem[]>;
  getNewsBySlug(slug: string): Promise<NewsItem | null>;
  createNews(input: NewNews): Promise<NewsItem>;
}
