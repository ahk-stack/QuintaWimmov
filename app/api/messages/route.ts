import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fieldErrors, messageSchema } from "@/lib/validation";

/**
 * Posts a chat message.
 *
 * The browser subscribes to Realtime for reads, but writes come here so the
 * anon key never needs insert rights. Chat is the easiest endpoint to abuse on
 * an open URL, so the limit is tighter than the lead endpoints.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "messages:create", 30, 60_000);
  if (limited) return limited;

  const payload = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "That message is not valid", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const store = getStore();

  const author = await store.getPerson(parsed.data.authorId);
  if (!author) {
    return Response.json(
      { error: "That name is not on the roster" },
      { status: 400 },
    );
  }

  // Reject an unknown channel rather than storing a dangling reference.
  const channels = await store.listChannels();
  if (!channels.some((c) => c.id === parsed.data.channelId)) {
    return Response.json({ error: "Channel not found" }, { status: 404 });
  }

  try {
    const message = await store.createMessage(parsed.data);
    return Response.json({ id: message.id }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not send the message" },
      { status: 500 },
    );
  }
}
