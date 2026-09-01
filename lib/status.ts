import type { LeadDirection, LeadPriority, LeadStatus } from "./types";

/**
 * Presentation metadata for the enums.
 *
 * Status is the only place colour is permitted, so mapping it lives here rather
 * than being spelled out at each call site — that keeps the palette auditable in
 * one file, which is what the review rules in AGENTS.md check against.
 */

type Tone = "won" | "watch" | "lost" | "info" | "pending";

const TONE_TEXT: Record<Tone, string> = {
  won: "text-status-won",
  watch: "text-status-watch",
  lost: "text-status-lost",
  info: "text-status-info",
  pending: "text-status-pending",
};

export function toneTextClass(tone: Tone): string {
  return TONE_TEXT[tone];
}

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "claimed",
  "in_progress",
  "won",
  "lost",
];

export const STATUS_META: Record<
  LeadStatus,
  { label: string; tone: Tone; help: string }
> = {
  new: {
    label: "New",
    tone: "info",
    help: "Posted, waiting for someone to pick it up.",
  },
  claimed: {
    label: "Claimed",
    tone: "watch",
    help: "Someone has taken ownership.",
  },
  in_progress: {
    label: "In progress",
    tone: "watch",
    help: "Actively being worked.",
  },
  won: { label: "Won", tone: "won", help: "Closed successfully." },
  lost: { label: "Lost", tone: "lost", help: "Closed without a deal." },
};

/** Statuses that still need attention — drives the dashboard's "open" count. */
export const OPEN_STATUSES: LeadStatus[] = ["new", "claimed", "in_progress"];

export function isOpen(status: LeadStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export const DIRECTION_META: Record<
  LeadDirection,
  { label: string; short: string; help: string }
> = {
  for_sales: {
    label: "For sales",
    short: "Sales",
    help: "A consultant found an opportunity and is handing it to sales.",
  },
  for_consultant: {
    label: "For consultants",
    short: "Consultants",
    help: "Sales need consultant expertise on an account.",
  },
};

export const PRIORITY_META: Record<
  LeadPriority,
  { label: string; tone: Tone }
> = {
  low: { label: "Low", tone: "pending" },
  normal: { label: "Normal", tone: "pending" },
  high: { label: "High", tone: "lost" },
};

export const ROLE_LABEL = {
  sales: "Sales",
  consultant: "Consultant",
  admin: "Admin",
} as const;
