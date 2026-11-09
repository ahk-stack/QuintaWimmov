import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { hubspotEnabled } from "@/lib/hubspot/config";
import { wakeHubSpot } from "@/lib/hubspot/worker";
import { enforcePersonRateLimit } from "@/lib/rate-limit";

/**
 * Queues a lead for HubSpot: the first send of a lead that predates the sync,
 * or a new round after a final failure. Any signed-in person may ask. A lead
 * waiting on a scheduled retry is left to its backoff.
 *
 * It only queues — 202 — and the worker does the work after the response, so
 * a slow or failing HubSpot never holds the request. Asking twice is harmless:
 * an already queued or synced lead is left alone.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "leads:hubspot", 10, 60_000);
  if (limited) return limited;

  if (!hubspotEnabled()) {
    return Response.json({ error: "HubSpot is not connected yet." }, { status: 409, headers: PRIVATE_HEADERS });
  }

  const { id } = await params;
  try {
    const queued = await getStore().hubspotRequest(id);
    if (queued) wakeHubSpot();
    return Response.json({ queued }, { status: 202, headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ error: "Could not queue that lead." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
