import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { directMessageSchema, fieldErrors } from "@/lib/validation";

/**
 * Sends a direct message.
 *
 * Reads and writes both happen server-side under the service-role key, because
 * `direct_messages` grants the anon key nothing. That is deliberate: the anon
 * key ships in the browser bundle, so an anon read policy on this table would
 * publish every conversation through the REST API. See migration 0004.
 *
 * It does NOT make messages confidential from colleagues. There is no sign-in,
 * so `senderId` is a name chosen from a dropdown and anyone can claim it. The UI
 * states this where people can see it.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "dm:create", 30, 60_000);
  if (limited) return limited;

  const payload = await request.json().catch(() => null);
  const parsed = directMessageSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "That message is not valid", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { senderId, recipientId, body } = parsed.data;

  // The database rejects this too; catching it here gives a usable message.
  if (senderId === recipientId) {
    return Response.json(
      { error: "You cannot message yourself" },
      { status: 400 },
    );
  }

  const store = getStore();
  const [sender, recipient] = await Promise.all([
    store.getPerson(senderId),
    store.getPerson(recipientId),
  ]);
  if (!sender) {
    return Response.json(
      { error: "That name is not on the roster" },
      { status: 400 },
    );
  }
  if (!recipient) {
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
