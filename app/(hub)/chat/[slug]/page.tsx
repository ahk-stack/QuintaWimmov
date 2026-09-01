import Link from "next/link";
import { notFound } from "next/navigation";

import { ChatRoom } from "@/components/chat-room";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
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

  const [channel, channels, people] = await Promise.all([
    store.getChannelBySlug(slug),
    store.listChannels(),
    store.listPeople(),
  ]);

  if (!channel) notFound();

  const messages = await store.listMessages(channel.id);

  return (
    <div className="grid gap-10 lg:grid-cols-[13rem_1fr]">
      <nav aria-label="Channels">
        <h2 className="mb-3 text-xs font-bold tracking-[0.18em] uppercase">
          Channels
        </h2>
        <ul className="space-y-1">
          {channels.map((item) => {
            const active = item.slug === channel.slug;
            return (
              <li key={item.id}>
                <Link
                  href={`/chat/${item.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? "bg-ink font-bold text-paper"
                      : "text-muted hover:bg-surface hover:text-ink"
                  }`}
                >
                  {item.name}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-6 text-xs text-muted">
          Discussion about a specific lead belongs on that lead, not here.
        </p>
      </nav>

      {/*
        The room manages its own scrolling, so it is given a bounded height
        rather than letting the page grow with the message list.
      */}
      <div className="flex h-[calc(100vh-16rem)] min-h-[28rem] flex-col">
        <ChatRoom
          channel={channel}
          initialMessages={messages}
          people={people}
        />
      </div>
    </div>
  );
}
