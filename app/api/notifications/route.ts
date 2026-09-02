import { getClaimedPersonId } from "@/lib/current-person";
import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

/**
 * Unread notifications for whoever the identity cookie claims to be.
 *
 * Whose notifications is taken from the COOKIE, never from a query parameter.
 * A `?personId=` version of this would let anyone read another person's bell —
 * including direct-message previews — by editing a URL. Forging a cookie is no
 * harder in principle, but this is not an endpoint that can be enumerated, and
 * it keeps the shape honest for when a real sign-in lands.
 *
 * Polled by the bell, so the limit is generous but present.
 */
export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "notifications:read", 120, 60_000);
  if (limited) return limited;

  const personId = await getClaimedPersonId();
  // Nobody claimed: an empty bell, not an error.
  if (!personId) return Response.json({ count: 0, items: [] });

  try {
    const items = await getStore().listUnreadNotifications(personId);
    return Response.json({
      count: items.length,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        actorId: n.actorId,
        href: n.href,
        preview: n.preview,
        createdAt: n.createdAt,
      })),
    });
  } catch {
    // A failing bell must not break the page it sits in.
    return Response.json({ count: 0, items: [] }, { status: 200 });
  }
}
