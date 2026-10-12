import { getStore, storeKind } from "@/lib/db";

/**
 * Liveness and readiness probe.
 *
 * Built for a load balancer or container healthcheck, so it is deliberately
 * cheap and says nothing an outsider could use:
 *
 * - No versions, hostnames, connection strings or error text. A failing store
 *   reports "degraded" and nothing more; the detail stays in the server log.
 * - The query is a channel read, which is three rows, so polling it every few
 *   seconds costs effectively nothing.
 * - Not rate limited, because a probe is supposed to call it constantly. That
 *   is safe precisely because the response is a fixed shape and the work is
 *   trivial.
 *
 * 200 means this instance can serve requests. 503 means it cannot reach its
 * database, which is the failure a probe needs to act on.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const kind = storeKind();

  if (kind === "unconfigured") {
    return Response.json(
      { status: "unconfigured", store: kind },
      { status: 503 },
    );
  }

  try {
    // Cheapest read that proves the data layer is actually reachable.
    await getStore().listChannels();
    return Response.json({ status: "ok", store: kind });
  } catch {
    return Response.json({ status: "degraded", store: kind }, { status: 503 });
  }
}
