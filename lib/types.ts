/**
 * Domain model for the Lead Hub.
 *
 * These types are the contract between the data layer (`lib/db`) and the UI.
 * They intentionally mirror the Postgres schema so the Supabase-backed store
 * can map rows to them with no reshaping.
 */

export type Role = "sales" | "consultant" | "admin";

/**
 * Who a lead is *for*. This single field is what makes the board
 * bidirectional: sales and consultants share one table and one board.
 */
export type LeadDirection = "for_sales" | "for_consultant";

export type LeadStatus = "new" | "claimed" | "in_progress" | "won" | "lost";

export type LeadPriority = "low" | "normal" | "high";

/**
 * Where a lead stands with HubSpot. Mirrors `hubspot_sync_state` (migration
 * 0009): `manual` leads predate the sync and are sent only on request.
 */
export type HubSpotSyncState =
  | "manual"
  | "pending"
  | "running"
  | "retry"
  | "synced"
  | "blocked"
  | "failed";

/**
 * Why a sync failed, or a caveat on one that succeeded. Fixed codes only:
 * HubSpot's own messages quote contact emails and phones, so they are never
 * stored, logged or shown. The UI maps each code to fixed text. The database
 * CHECK in migration 0009 lists exactly these; change both together.
 */
export type HubSpotErrorCode =
  | "no_contact"
  | "not_configured"
  | "owner_unmapped"
  | "company_busy"
  | "hubspot:auth"
  | "hubspot:scope"
  | "hubspot:validation"
  | "hubspot:not_found"
  | "hubspot:rate_limited"
  | "hubspot:server"
  | "hubspot:timeout"
  | "hubspot:network"
  | "hubspot:unexpected"
  | "internal";

export interface Person {
  id: string;
  name: string;
  email: string;
  role: Role;
  /** Quinta territory code, e.g. "CME", "MLH". Optional for admins. */
  territory: string | null;
  /** Two-letter monogram used as the avatar. Monochrome by design. */
  initials: string;
  active: boolean;
}

export interface Lead {
  id: string;
  createdAt: string;
  createdBy: string;
  direction: LeadDirection;

  hotelName: string;
  website: string | null;
  city: string | null;
  country: string | null;
  rooms: number | null;

  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;

  /** Which Quinta product the lead is about, e.g. "Velma", "Q-Data". */
  productInterest: string | null;
  /** Free-text background from whoever raised the lead. */
  context: string | null;
  priority: LeadPriority;

  status: LeadStatus;
  assignedTo: string | null;

  hubspotContactId: string | null;
  hubspotCompanyId: string | null;
  /** The HubSpot Lead (object 0-136) this lead became. */
  hubspotLeadId: string | null;
  hubspotSyncedAt: string | null;
  hubspotSyncState: HubSpotSyncState;
  /** A fixed code, never a HubSpot message. See HubSpotErrorCode. */
  hubspotSyncError: HubSpotErrorCode | null;
}

/** Append-only audit trail. Renders as the timeline on the lead detail page. */
export interface LeadEvent {
  id: string;
  leadId: string;
  actorId: string | null;
  type: "created" | "status_changed" | "assigned" | "hubspot_synced" | "note";
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  note: string | null;
  createdAt: string;
}

export interface LeadComment {
  id: string;
  leadId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** People mentioned with @, recorded at send time. */
  mentions: string[];
}

/**
 * A message addressed to one person.
 *
 * Shown in the app only to its two participants, by session. The table grants
 * the publishable key nothing. Database administrators can still read it, and
 * the UI says so.
 */
export interface DirectMessage {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  createdAt: string;
}

export type NotificationKind =
  | "mention"
  | "direct_message"
  | "lead_assigned";

/**
 * Something that should light up the bell.
 *
 * `href` and `preview` are captured at write time so rendering the dropdown
 * needs no further lookups, and so a later rename or edit does not change what
 * the notification said when it arrived.
 */
export interface AppNotification {
  id: string;
  personId: string;
  kind: NotificationKind;
  actorId: string | null;
  sourceId: string;
  href: string;
  preview: string | null;
  createdAt: string;
  readAt: string | null;
}

/** One row in the direct-message sidebar. */
export interface Conversation {
  /** The other participant, from the point of view of whoever is looking. */
  personId: string;
  lastMessage: DirectMessage;
  messageCount: number;
}

export interface NewsItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  /** Markdown. */
  body: string;
  category: string | null;
  authorId: string | null;
  publishedAt: string;
  pinned: boolean;
}

