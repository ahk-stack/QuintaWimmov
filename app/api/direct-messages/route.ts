import { authorize } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { directMessageSchema, fieldErrors } from "@/lib/validation";

/**
 * The thread between the signed-in person and `?with=`, for the open
 * conversation's polling. The reader is always the session's person — the
 * parameter can only name the other participant, never swap in a reader.
 * Polls do not count as activity, so an open thread still times out.
 */
export async function GET(request: Request) {
  const auth = await authorize(request, { touch: false });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "dm:poll", 120, 60_000);
  if (limited) return limited;

  const other = new URL(request.url).searchParams.get("with") ?? "";
  // Ids are uuids (or short slugs in the dev store): never punctuation that a
  // query builder could read as syntax. The store re-checks for Supabase.
  if (!/^[A-Za-z0-9-]{1,64}$/.test(other)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const messages = await getStore().listDirectMessages(auth.session.person.id, other);
    return Response.json({ messages });
  } catch {
    return Response.json({ error: "Could not load messages" }, { status: 500 });
  }
}

/**
 * Sends a direct message.
 *
 * The sender is the signed-in person. Threads are shown only to their two
 * participants, by session. Reads and writes happen server-side because
 * `direct_messages` grants the publishable key nothing (migration 0004).
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const senderId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "dm:create", 30, 60_000);
  if (limited) return limited;

  const payload = await request.json().catch(() => null);
  const parsed = directMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "That message is not valid", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { recipientId, body } = parsed.data;

  // The database rejects this too; catching it here gives a usable message.
  if (senderId === recipientId) {
    return Response.json(
      { error: "You cannot message yourself" },
      { status: 400 },
    );
  }

  const store = getStore();
  const recipient = await store.getPerson(recipientId);
  if (!recipient || !recipient.active) {
    return Response.json(
      { error: "That person is not on the roster" },
      { status: 404 },
    );
  }

  try {
    const message = await store.createDirectMessage({
      senderId,
      recipientId,
      body,
    });

    /*
     * The preview quotes the message. That is the same sensitivity as the
     * message itself, and `notifications` has no anon access for exactly that
     * reason — see migration 0005.
     */
    await store.createNotifications([
      {
        personId: recipientId,
        kind: "direct_message",
        actorId: senderId,
        sourceId: message.id,
        // Points at the thread with the SENDER, which is where the reply goes.
        href: `/chat/direct/${senderId}`,
        preview: body.slice(0, 160),
      },
    ]);

    return Response.json({ id: message.id }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not send the message" },
      { status: 500 },
    );
  }
}
