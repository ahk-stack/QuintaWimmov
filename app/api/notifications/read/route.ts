import { z } from "zod";

import { authorize } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";

const bodySchema = z.object({
  /** Omit to mark everything unread as read. */
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * Marks the signed-in person's notifications read.
 *
 * The person comes from the session and is always applied in the store query,
 * so passing another person's notification ids is a no-op rather than a way to
 * clear their bell.
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const personId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "notifications:mark", 60, 60_000);
  if (limited) return limited;

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
