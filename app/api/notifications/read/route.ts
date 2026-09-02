import { z } from "zod";

import { getClaimedPersonId } from "@/lib/current-person";
import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  /** Omit to mark everything unread as read. */
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * Marks notifications read for whoever the cookie claims to be.
 *
 * The person is resolved from the cookie and always applied in the store query,
 * so passing another person's notification ids is a no-op rather than a way to
 * clear their bell.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "notifications:mark", 60, 60_000);
  if (limited) return limited;

  const personId = await getClaimedPersonId();
  if (!personId) return Response.json({ marked: 0 });

  const payload = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const marked = await getStore().markNotificationsRead(
      personId,
      parsed.data.ids,
    );
    return Response.json({ marked });
  } catch {
    return Response.json(
      { error: "Could not update notifications" },
      { status: 500 },
    );
  }
}
