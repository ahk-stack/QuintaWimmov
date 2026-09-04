import type {
  AppNotification,
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

export interface HubSpotResult {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  error?: string | null;
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
  recordHubSpotResult(id: string, result: HubSpotResult): Promise<Lead>;

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
