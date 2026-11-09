import { createHash, timingSafeEqual } from "node:crypto";

import { runHubSpotSweep } from "@/lib/hubspot/worker";

/**
 * Scheduled HubSpot sweep, for a scheduler rather than a person.
 *
 * The one route that does not use `authorize()`: there is no session. It is
 * authenticated by `Authorization: Bearer <CRON_SECRET>` instead — the header
 * Vercel Cron sends, and what a Kubernetes CronJob sends with curl. No secret
 * configured means the route is off. It only drains the existing queue, so the
 * worst a caller with the secret can do is make the sync run sooner.
 *
 * GET because that is what Vercel Cron calls; POST for everything else.
 */

const MIN_SECRET_LENGTH = 32;

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return false;
  const presented = request.headers.get("authorization") ?? "";
  // Hash both sides so the comparison is constant-time whatever the lengths.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }
  const processed = await runHubSpotSweep(20);
  return Response.json({ processed });
}

export const GET = handle;
export const POST = handle;
