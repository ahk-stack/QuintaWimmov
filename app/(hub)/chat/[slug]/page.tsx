import { notFound } from "next/navigation";

import { ChatRoom } from "@/components/chat-room";
import { ChatSidebar } from "@/components/chat-sidebar";
import { getClaimedPerson } from "@/lib/current-person";
import { getStore, storeKind } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Route segments under /chat that are not channel slugs.
 *
 * A channel with one of these slugs would be shadowed by the static route and
 * unreachable. Channels are seeded rather than user-created today, so this is a
 * note for whoever adds channel creation.
 */
export const RESERVED_CHAT_SLUGS = ["direct"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  /*
   * generateMetadata runs outside the route-group layout, so the layout's
   * storeKind() guard does not protect it. Without this check an unconfigured
   * deployment throws here and returns a 500, instead of the setup screen the
   * guard exists to render.
   */
  if (storeKind() === "unconfigured") return { title: "Chat" };

  const { slug } = await params;
  const channel = await getStore().getChannelBySlug(slug);
  return { title: channel ? channel.name : "Channel not found" };
}

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = getStore();

  const [channel, channels, people, claimed] = await Promise.all([
    store.getChannelBySlug(slug),
    store.listChannels(),
    store.listPeople(),
    // Attribution only — decides what to show, never what to allow.
    getClaimedPerson(),
  ]);

  if (!channel) notFound();

  const [messages, conversations] = await Promise.all([
    store.listMessages(channel.id),
    claimed ? store.listConversations(claimed.id) : Promise.resolve([]),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
      <ChatSidebar
        channels={channels}
        activeChannelSlug={channel.slug}
        conversations={conversations}
        people={people}
        currentPerson={claimed}
      />

      {/*
        The room manages its own scrolling, so it is given a bounded height
        rather than letting the page grow with the message list.
      */}
      <div className="flex h-[calc(100vh-16rem)] min-h-[28rem] flex-col">
        {/*
          Keyed by channel so switching channels mounts a fresh room.
          Next remounts this segment on a param change today, so the messages,
          draft and socket already reset — but relying on framework
          reconciliation for that would be fragile, and one stale message list
          bleeding into another channel is a bad failure. The key makes it
          explicit and costs nothing.
        */}
        <ChatRoom
          key={channel.id}
          channel={channel}
          initialMessages={messages}
          people={people}
        />
      </div>
    </div>
  );
}
