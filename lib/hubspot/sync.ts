import "server-only";

import { randomUUID } from "node:crypto";

import { getStore } from "../db";
import type { HubSpotClaim } from "../db/store";
import type { HubSpotErrorCode, Lead, Person } from "../types";
import { HubSpotError, hubspotRequest } from "./client";
import { ASSOC, EXTERNAL_ID_PROPERTY, LEAD_PIPELINE_ID, STAGE_FOR_STATUS } from "./config";

/**
 * Syncs one claimed lead to HubSpot, app → HubSpot only.
 *
 * First sync, in this order, saving each HubSpot id the moment it exists so a
 * retry resumes rather than recreates:
 *   1. a HubSpot Lead already carrying this lead's id? (an earlier attempt
 *      that timed out after HubSpot accepted it) — adopt it;
 *   2. company: by website domain only — never by name, hotel names repeat
 *      across chains. A domain registry in Postgres makes sure two workers
 *      never both create it. Several HubSpot matches: no company, not a guess;
 *   3. contact: by email (search first, always); created only when absent,
 *      and only a NEW contact is linked to the company — an existing contact's
 *      primary company is never changed;
 *   4. the Lead, at its stage, with this lead's id in `quinta_lead_hub_id`
 *      (a unique property: a duplicate create is rejected and adopted);
 *   5. a note on the Lead, carrying a reference marker so a retry finds it
 *      instead of adding a second.
 * Existing contacts and companies are never modified.
 *
 * Later syncs only set the Lead's stage and owner from the CURRENT lead.
 *
 * Before every HubSpot write the lease is renewed; if it has expired another
 * worker may own the lead, so this one stops without writing.
 *
 * Nothing here logs or stores contact details or HubSpot's responses.
 */

/** Renewed before each write; generous for one step plus its retries. */
const STEP_LEASE_SECONDS = 120;

interface Created {
  id: string;
}

interface SearchResult {
  total: number;
  results: { id: string }[];
}

/** Thrown when the lease was lost mid-sync: another worker owns the lead now. */
export class LeaseLost extends Error {}

/** Another worker is creating this lead's company right now: try again shortly. */
const companyBusy = () => new HubSpotError("company_busy", null, true, false);

async function search(objectType: string, property: string, value: string): Promise<SearchResult> {
  return hubspotRequest<SearchResult>(
    "POST",
    `/crm/v3/objects/${objectType}/search`,
    {
      filterGroups: [{ filters: [{ propertyName: property, operator: "EQ", value }] }],
      properties: [property],
      limit: 2,
    },
    { idempotent: true },
  );
}

// Owner -----------------------------------------------------------------------

/*
 * Per-process cache of roster email → HubSpot owner id. Owners change rarely;
 * ten minutes keeps a sweep from asking HubSpot the same thing per lead.
 */
const ownerCache = new Map<string, { id: string | null; at: number }>();
const OWNER_TTL_MS = 10 * 60 * 1000;

async function ownerIdFor(person: Person | null): Promise<string | null> {
  const email = person?.email?.trim().toLowerCase();
  if (!email) return null;
  const cached = ownerCache.get(email);
  if (cached && Date.now() - cached.at < OWNER_TTL_MS) return cached.id;

  const page = await hubspotRequest<{ results: { id: string }[] }>(
    "GET",
    `/crm/v3/owners?email=${encodeURIComponent(email)}&archived=false&limit=1`,
    undefined,
    { idempotent: true },
  );
  const id = page?.results?.[0]?.id ?? null;
  ownerCache.set(email, { id, at: Date.now() });
  return id;
}

// Company ---------------------------------------------------------------------

/** Bare hostname of a website, or null when it is not a usable domain. */
export function domainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/\.$/, "");
    const bare = host.startsWith("www.") ? host.slice(4) : host;
    // A real registrable-looking name, not an IP or a single label.
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare) || /^[0-9.]+$/.test(bare)) return null;
    return bare;
  } catch {
    return null;
  }
}

async function findOrCreateCompany(lead: Lead, guard: () => Promise<void>): Promise<string | null> {
  const domain = domainOf(lead.website);
  if (!domain) return null;

  const store = getStore();
  const token = randomUUID();
  const claim = await store.hubspotClaimCompany(domain, token);
  if (claim.companyId) return claim.companyId;
  if (!claim.mine) throw companyBusy();

  const found = await search("companies", "domain", domain);
  let companyId: string | null = null;
  if (found.total === 1 && found.results[0]) {
    companyId = found.results[0].id;
  } else if (found.total > 1) {
    return null; // ambiguous: no company beats the wrong one (claim lapses)
  } else if (claim.uncertain) {
    /*
     * An earlier create may have gone through without us hearing back, and the
     * search may not show it yet. Never create again: try later, and after the
     * retries run out the lead syncs with no company rather than a duplicate.
     */
    throw companyBusy();
  } else {
    await guard();
    try {
      const created = await hubspotRequest<Created>(
        "POST",
        "/crm/v3/objects/companies",
        {
          properties: {
            name: lead.hotelName,
            domain,
            ...(lead.city ? { city: lead.city } : {}),
            ...(lead.country ? { country: lead.country } : {}),
          },
        },
        { idempotent: false },
      );
      companyId = created.id;
    } catch (error) {
      if (error instanceof HubSpotError && error.ambiguous) {
        await store.hubspotMarkCompanyUncertain(domain, token);
      }
      throw error;
    }
  }
  // False only if the claim was taken over meanwhile; this id is still right.
  await store.hubspotSetCompany(domain, token, companyId);
  return companyId;
}

// Contact ---------------------------------------------------------------------

function splitName(name: string | null): { firstname?: string; lastname?: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstname: parts[0] };
  return { firstname: parts[0], lastname: parts.slice(1).join(" ") };
}

async function findOrCreateContact(
  lead: Lead,
  companyId: string | null,
  guard: () => Promise<void>,
): Promise<string> {
  const email = (lead.contactEmail ?? "").trim().toLowerCase();

  const found = await search("contacts", "email", email);
  if (found.results[0]) return found.results[0].id;

  await guard();
  try {
    const created = await hubspotRequest<Created>(
      "POST",
      "/crm/v3/objects/contacts",
      {
        properties: {
          email,
          ...splitName(lead.contactName),
          ...(lead.contactPhone ? { phone: lead.contactPhone } : {}),
        },
        // Only a contact we create gets a primary company.
        associations: companyId
          ? [
              {
                to: { id: companyId },
                types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC.contactToPrimaryCompany }],
              },
            ]
          : [],
      },
      { idempotent: false },
    );
    return created.id;
  } catch (error) {
    // 409: it exists after all (created meanwhile, or search had not caught up).
    // Ambiguous: it may exist now. Either way, look again before giving up.
    if (error instanceof HubSpotError && (error.status === 409 || error.ambiguous)) {
      const again = await search("contacts", "email", email);
      if (again.results[0]) return again.results[0].id;
    }
    throw error;
  }
}

// Note ------------------------------------------------------------------------

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** In every note this app writes, so a retry can recognise its own note. */
const noteMarker = (leadId: string) => `Lead Hub ref: ${leadId}`;

function noteBody(lead: Lead, people: Map<string, Person>): string {
  const author = people.get(lead.createdBy)?.name ?? "a colleague";
  const lines: [string, string | null][] = [
    ["Posted in Quinta Lead Hub by", author],
    ["For", lead.direction === "for_sales" ? "Sales" : "Consultants"],
    ["Product interest", lead.productInterest],
    ["Rooms", lead.rooms !== null ? String(lead.rooms) : null],
    ["Priority", lead.priority],
    ["Location", [lead.city, lead.country].filter(Boolean).join(", ") || null],
  ];
  const facts = lines
    .filter(([, value]) => value)
    .map(([label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value as string)}`)
    .join("<br>");
  const context = lead.context ? `<br><br>${escapeHtml(lead.context).replace(/\n/g, "<br>")}` : "";
  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  // Built from configuration, never from a request's Host header.
  const link =
    origin && /^https:\/\/[^/]+$/.test(origin)
      ? `<br><br><a href="${escapeHtml(`${origin}/leads/${lead.id}`)}">Open in Lead Hub</a>`
      : "";
  return `${facts}${context}${link}<br><br><small>${escapeHtml(noteMarker(lead.id))}</small>`;
}

/** A note this app already put on the HubSpot Lead, found by its marker. */
async function findOwnNote(hubspotLeadId: string, leadId: string): Promise<string | null> {
  // Every associated note, page by page — a Lead can have more than 100.
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < 50; page++) {
    const linked = await hubspotRequest<{
      results: { id: string; toObjectId?: string }[];
      paging?: { next?: { after?: string } };
    }>(
      "GET",
      `/crm/v3/objects/leads/${encodeURIComponent(hubspotLeadId)}/associations/notes?limit=100${
        after ? `&after=${encodeURIComponent(after)}` : ""
      }`,
      undefined,
      { idempotent: true },
    );
    ids.push(...(linked?.results ?? []).map((r) => String(r.toObjectId ?? r.id)).filter(Boolean));
    after = linked?.paging?.next?.after;
    if (!after) break;
  }

  const marker = escapeHtml(noteMarker(leadId));
  for (let i = 0; i < ids.length; i += 100) {
    const notes = await hubspotRequest<{ results: { id: string; properties: { hs_note_body?: string } }[] }>(
      "POST",
      "/crm/v3/objects/notes/batch/read",
      { properties: ["hs_note_body"], inputs: ids.slice(i, i + 100).map((id) => ({ id })) },
      { idempotent: true },
    );
    const own = notes?.results?.find((n) => n.properties?.hs_note_body?.includes(marker));
    if (own) return own.id;
  }
  return null;
}

// The sync --------------------------------------------------------------------

export interface SyncOutcome {
  warning: HubSpotErrorCode | null;
}

export async function syncLead(claim: HubSpotClaim): Promise<SyncOutcome> {
  const store = getStore();
  const lead = await store.getLead(claim.leadId);
  if (!lead) throw new HubSpotError("internal", null, false, false);
  if (!lead.contactEmail) throw new HubSpotError("no_contact", null, false, false);

  // Before every HubSpot write: still ours? If not, stop without writing.
  const guard = async () => {
    if (!(await store.hubspotRenew(lead.id, claim.leaseToken, STEP_LEASE_SECONDS))) throw new LeaseLost();
  };
  const saveIds = async (ids: { contactId?: string; companyId?: string; leadId?: string; noteId?: string }) => {
    if (!(await store.hubspotSaveIds(lead.id, claim.leaseToken, ids))) throw new LeaseLost();
  };

  const people = new Map((await store.listPeople()).map((p) => [p.id, p]));
  const assignee = lead.assignedTo ? (people.get(lead.assignedTo) ?? null) : null;
  const ownerId = assignee ? await ownerIdFor(assignee) : null;
  // Assigned to someone who is not a HubSpot user: synced, owner left empty, and said so.
  const warning: HubSpotErrorCode | null = assignee && !ownerId ? "owner_unmapped" : null;
  const stage = STAGE_FOR_STATUS[lead.status];

  let hubspotLeadId = lead.hubspotLeadId;
  // An existing Lead (from a previous sync, or adopted below) gets stage and owner set.
  let needsUpdate = hubspotLeadId !== null;

  const adopt = async (): Promise<boolean> => {
    const existing = await search("leads", EXTERNAL_ID_PROPERTY, lead.id);
    if (!existing.results[0]) return false;
    hubspotLeadId = existing.results[0].id;
    needsUpdate = true;
    await saveIds({ leadId: hubspotLeadId });
    return true;
  };

  // 1. Adopt a Lead an earlier, interrupted attempt already created.
  if (!hubspotLeadId) await adopt();

  if (!hubspotLeadId) {
    // 2–3. Company, then contact.
    let companyId = lead.hubspotCompanyId;
    if (!companyId) {
      companyId = await findOrCreateCompany(lead, guard);
      if (companyId) await saveIds({ companyId });
    }
    let contactId = lead.hubspotContactId;
    if (!contactId) {
      contactId = await findOrCreateContact(lead, companyId, guard);
      await saveIds({ contactId });
    }

    // 4. The Lead. Never retried blind: a rejected duplicate (the property is
    // unique) or an ambiguous failure is resolved by looking it up.
    await guard();
    try {
      const created = await hubspotRequest<Created>(
        "POST",
        "/crm/v3/objects/leads",
        {
          properties: {
            hs_lead_name: lead.hotelName,
            hs_pipeline: LEAD_PIPELINE_ID,
            hs_pipeline_stage: stage,
            [EXTERNAL_ID_PROPERTY]: lead.id,
            ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
          },
          associations: [
            {
              to: { id: contactId },
              types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC.leadToPrimaryContact }],
            },
            ...(companyId
              ? [
                  {
                    to: { id: companyId },
                    types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC.leadToPrimaryCompany }],
                  },
                ]
              : []),
          ],
        },
        { idempotent: false },
      );
      hubspotLeadId = created.id;
      await saveIds({ leadId: hubspotLeadId });
    } catch (error) {
      const duplicate = error instanceof HubSpotError && (error.status === 409 || error.status === 400);
      if (duplicate && (await adopt())) {
        // It existed after all (unique property rejected the second); carry on.
      } else if (duplicate) {
        /*
         * Rejected, but the search cannot see the existing Lead yet (HubSpot's
         * search index lags). Retry later — the next attempt adopts it first —
         * rather than failing for good.
         */
        throw new HubSpotError("hubspot:validation", error.status, true, false);
      } else {
        throw error;
      }
    }
  }

  if (needsUpdate && hubspotLeadId) {
    // Owner and stage from the CURRENT lead. Unassigned clears the owner.
    await guard();
    await hubspotRequest(
      "PATCH",
      `/crm/v3/objects/leads/${encodeURIComponent(hubspotLeadId)}`,
      { properties: { hs_pipeline_stage: stage, hubspot_owner_id: ownerId ?? "" } },
      { idempotent: true },
    );
  }

  // 5. The note, once.
  if (hubspotLeadId && !(await store.hubspotNoteId(lead.id))) {
    const existingNote = await findOwnNote(hubspotLeadId, lead.id);
    if (existingNote) {
      await saveIds({ noteId: existingNote });
    } else {
      await guard();
      const note = await hubspotRequest<Created>(
        "POST",
        "/crm/v3/objects/notes",
        {
          properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteBody(lead, people) },
          associations: [
            {
              to: { id: hubspotLeadId },
              types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: ASSOC.noteToLead }],
            },
          ],
        },
        { idempotent: false },
      );
      await saveIds({ noteId: note.id });
    }
  }

  return { warning };
}
