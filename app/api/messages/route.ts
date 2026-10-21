import { z } from "zod";

import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { findMentions } from "@/lib/mentions";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { fieldErrors, messageSchema } from "@/lib/validation";

/*
 * A message timestamp exactly as this API returned it. Checked strictly because
 * it becomes a query filter.
 */
const cursorSchema = z
  .string()
  .max(40)
  .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/)
  .refine((v) => !Number.isNaN(Date.parse(v)));

/**
 * New messages in a channel, for the chat window's polling.
 *
 * Replaces the Supabase Realtime subscription, which needed the publishable key
 * to be able to read `messages` — i.e. anyone, signed in or not. `after` is
 * inclusive, so a message sharing the cursor's timestamp is never skipped; the
 * client de-duplicates by id.
 *
 * Polls do not count as activity, so an unattended tab still times out.
 */
export async function GET(request: Request) {
  const auth = await authorize(request, { touch: false });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "messages:poll", 120, 60_000);
  if (limited) return limited;

  const url = new URL(request.url);
  const channelId = url.searchParams.get("channelId") ?? "";
  const after = cursorSchema.safeParse(url.searchParams.get("after"));
  if (!channelId || channelId.length > 64 || !after.success) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const messages = await getStore().listMessagesSince(channelId, after.data, 100);
    return Response.json({ messages }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ error: "Could not load messages" }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

/**
 * Posts a chat message as the signed-in person. The limit is tighter than the
 * lead endpoints because chat is the easiest thing to flood.
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const authorId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "messages:create", 30, 60_000);
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

  // Reject an unknown channel rather than storing a dangling reference.
  const channels = await store.listChannels();
  if (!channels.some((c) => c.id === parsed.data.channelId)) {
    return Response.json({ error: "Channel not found" }, { status: 404 });
  }

  try {
    /*
     * Mentions are derived here from the submitted text, not taken from the
     * client. The composer's picks are only a typing aid — the author can edit
     * or delete a name afterwards, and a client-supplied list could name anyone.
     */
    const people = await store.listPeople();
    const mentions = findMentions(parsed.data.body, people);
    const message = await store.createMessage({ ...parsed.data, authorId, mentions });

    /*
     * Notify the people mentioned, never the author. Being told you tagged
     * yourself is noise, and it would leave a badge nobody can explain.
     */
    const recipients = mentions.filter((id) => id !== authorId);
    if (recipients.length > 0) {
      const channelSlug =
        channels.find((c) => c.id === parsed.data.channelId)?.slug ?? "";
      await store.createNotifications(
        recipients.map((personId) => ({
          personId,
          kind: "mention" as const,
          actorId: authorId,
          sourceId: message.id,
          href: `/chat/${channelSlug}`,
          preview: parsed.data.body.slice(0, 160),
        })),
      );
    }

    return Response.json({ id: message.id }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not send the message" },
      { status: 500 },
    );
  }
}
