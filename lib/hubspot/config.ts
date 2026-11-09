import "server-only";

import type { LeadStatus } from "../types";

/**
 * HubSpot configuration for the Quinta portal.
 *
 * The pipeline, stage and association ids are this portal's, confirmed against
 * its schema; `npm run hubspot:preflight` re-checks them with the real token
 * before go-live. They are constants rather than settings because changing one
 * changes what the sync means — that should be a reviewed code change.
 */

/** Private-app token. Server-only; absent means the sync is switched off. */
export function hubspotToken(): string | null {
  const token = process.env.HUBSPOT_TOKEN?.trim();
  return token ? token : null;
}

export function hubspotEnabled(): boolean {
  return hubspotToken() !== null;
}

/**
 * API base. Overridable ONLY outside production, so local tests can point the
 * sync at a mock. In production a misconfigured override would hand the token
 * to whatever host it named.
 */
export function hubspotApiBase(): string {
  const override = process.env.HUBSPOT_API_BASE?.trim();
  if (override && process.env.NODE_ENV !== "production") return override.replace(/\/+$/, "");
  return "https://api.hubapi.com";
}

/** For "Open in HubSpot" links. Not secret. */
export const HUBSPOT_PORTAL_ID = "25445053";
export const HUBSPOT_UI_DOMAIN = "app-eu1.hubspot.com";

export function hubspotLeadUrl(hubspotLeadId: string): string {
  return `https://${HUBSPOT_UI_DOMAIN}/contacts/${HUBSPOT_PORTAL_ID}/record/0-136/${encodeURIComponent(hubspotLeadId)}`;
}

/*
 * These look like placeholders but are the real ids: HubSpot keeps literal ids
 * such as "lead-pipeline-id" and "connected-stage-id" for the default Lead
 * pipeline, even after its stages are renamed (Quinta's "Sales Qualified Lead"
 * is `connected-stage-id`). `npm run hubspot:preflight` verifies them live.
 */
export const LEAD_PIPELINE_ID = "lead-pipeline-id";

/**
 * App status → HubSpot lead stage. New leads arrive already vetted by a
 * colleague, so they start as Sales Qualified Lead and stay there while
 * someone works them; the outcome moves them to Open Deal or Disqualified.
 */
export const STAGE_FOR_STATUS: Record<LeadStatus, string> = {
  new: "connected-stage-id", // Sales Qualified Lead
  claimed: "connected-stage-id",
  in_progress: "connected-stage-id",
  won: "qualified-stage-id", // Open Deal
  lost: "unqualified-stage-id", // Disqualified
};

/** HubSpot-defined association type ids (documented, direction matters). */
export const ASSOC = {
  leadToPrimaryContact: 578,
  leadToPrimaryCompany: 580,
  noteToLead: 855,
  contactToPrimaryCompany: 1,
} as const;

/**
 * Custom Lead property holding this app's lead uuid. It is what lets a create
 * that timed out be retried safely: the worker searches for it first.
 */
export const EXTERNAL_ID_PROPERTY = "quinta_lead_hub_id";
