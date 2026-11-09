import "server-only";

import { after } from "next/server";

import { getStore, storeKind } from "../db";
import { HubSpotError } from "./client";
import { hubspotEnabled } from "./config";
import { LeaseLost, syncLead } from "./sync";

/**
 * Runs the HubSpot queue.
 *
 * Delivery does not depend on any one request: the queue state is in Postgres
 * and set in the same statement as the lead change (migration 0009). This
 * worker only drains it. It is woken three ways:
 *   - right after a lead is created or changed (`after()`, so the request does
 *     not wait on HubSpot);
 *   - opportunistically while anyone uses the app (throttled), which also
 *     picks up retries that came due and leases left by a crashed instance;
 *   - by /api/cron/hubspot on a schedule, so nothing waits on traffic.
 * Any of them may run at once: leases in the database keep each lead with one
 * worker.
 */

/** Initial lease; the sync renews it before every HubSpot write. */
const LEASE_SECONDS = 120;

/**
 * One sweep at a time per process. A wake-up that arrives mid-sweep is not
 * dropped: it asks the running sweep to go round once more, so a lead created
 * during a sweep is not left waiting for the next wake-up.
 */
let sweeping = false;
let rerun = false;
let lastOpportunistic = 0;
const OPPORTUNISTIC_EVERY_MS = 60_000;

export async function runHubSpotSweep(limit = 5): Promise<number> {
  if (!hubspotEnabled() || storeKind() === "unconfigured") return 0;
  if (sweeping) {
    rerun = true;
    return 0;
  }
  sweeping = true;
  let processed = 0;
  try {
    const store = getStore();
    do {
      rerun = false;
      /*
       * One lead per claim, so a lease starts when its work starts. Claiming a
       * batch would let the last ones' leases run out while they wait, and
       * another worker could take them over in the meantime.
       */
      for (let i = 0; i < limit; i++) {
        const [claim] = await store.hubspotClaim(1, LEASE_SECONDS);
        if (!claim) break;
        try {
          const { warning } = await syncLead(claim);
          // False: the lease expired after our writes. Another worker may have
          // written newer values first, so queue the current state again.
          if (!(await store.hubspotComplete(claim.leadId, claim.leaseToken, claim.revision, warning))) {
            await store.hubspotRequeue(claim.leadId);
          }
        } catch (error) {
          if (error instanceof LeaseLost) {
            // Another worker has it now. If we had already written to HubSpot,
            // queue it again so the current state is written last.
            if (error.afterWrite) {
              await store.hubspotRequeue(claim.leadId).catch(() => console.warn(`hubspot sync: could not requeue lead=${claim.leadId}`));
            }
            continue;
          }
          const known = error instanceof HubSpotError;
          const code = known ? error.code : "internal";
          // Ids and codes only: never contact details, bodies or messages.
          console.warn(`hubspot sync failed: lead=${claim.leadId} code=${code}`);
          try {
            const recorded = await store.hubspotFail(claim.leadId, claim.leaseToken, code, {
              retryable: known ? error.retryable : true,
              blocked: code === "no_contact",
            });
            // Lease gone: a write of ours (e.g. one that timed out) may still
            // land after a newer worker's. Queue the current state again.
            if (!recorded) await store.hubspotRequeue(claim.leadId);
          } catch {
            console.warn(`hubspot sync: could not record failure for lead=${claim.leadId}`);
          }
        }
        processed++;
        // A full round may mean more are due; go round again.
        if (i === limit - 1) rerun = true;
      }
    } while (rerun && processed < 100);
  } catch {
    console.warn("hubspot sweep failed before processing");
  } finally {
    sweeping = false;
  }
  return processed;
}

/** Wake the worker once this response has been sent. For lead changes. */
export function wakeHubSpot(): void {
  if (!hubspotEnabled()) return;
  after(() => runHubSpotSweep());
}

/** Throttled wake-up for ordinary page traffic. */
export function nudgeHubSpot(): void {
  if (!hubspotEnabled()) return;
  const now = Date.now();
  if (now - lastOpportunistic < OPPORTUNISTIC_EVERY_MS) return;
  lastOpportunistic = now;
  after(() => runHubSpotSweep());
}
