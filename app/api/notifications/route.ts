import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";

/**
 * Unread notifications for the signed-in person.
 *
 * Whose bell is taken from the session, never from a parameter, so it cannot
 * be pointed at someone else's direct-message previews.
 *
 * Polled by the bell, so the limit is generous, and polls do not count as
 * activity for the idle timeout.
 */
export async function GET(request: Request) {
  const auth = await authorize(request, { touch: false });
  if (!auth.ok) return auth.response;
  const personId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "notifications:read", 120, 60_000);
  if (limited) return limited;

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
    }, { headers: PRIVATE_HEADERS });
  } catch {
    // A failing bell must not break the page it sits in.
    return Response.json({ count: 0, items: [] }, { status: 200, headers: PRIVATE_HEADERS });
  }
}
