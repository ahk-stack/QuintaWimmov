import type {
  Channel,
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
  }): Promise<Message>;

  // News --------------------------------------------------------------------
  listNews(limit?: number): Promise<NewsItem[]>;
  getNewsBySlug(slug: string): Promise<NewsItem | null>;
  createNews(input: NewNews): Promise<NewsItem>;
}
