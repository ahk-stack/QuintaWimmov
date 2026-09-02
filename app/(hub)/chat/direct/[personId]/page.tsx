import { notFound } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { DirectThread } from "@/components/direct-thread";
import { getStore, storeKind } from "@/lib/db";
import { getClaimedPerson } from "@/lib/current-person";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  // Metadata runs outside the route-group layout, so it needs its own guard.
  if (storeKind() === "unconfigured") return { title: "Direct message" };

  const { personId } = await params;
  const person = await getStore().getPerson(personId);
  return { title: person ? person.name : "Person not found" };
}

export default async function DirectMessagePage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { personId } = await params;
  const store = getStore();

  const [other, people, channels, claimed] = await Promise.all([
    store.getPerson(personId),
    store.listPeople(),
    store.listChannels(),
    // Attribution only — decides what to show, never what to allow.
    getClaimedPerson(),
  ]);

  if (!other) notFound();

  /*
   * The thread is only read when the viewer claims an identity, and only for
   * the pair (them, me). Without a claimed identity there is no thread to
   * render, so nothing is fetched.
   */
  const [messages, conversations] = claimed
    ? await Promise.all([
        store.listDirectMessages(claimed.id, other.id),
        store.listConversations(claimed.id),
      ])
    : [[], []];

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
      <ChatSidebar
        channels={channels}
        conversations={conversations}
        activePersonId={other.id}
        people={people}
        currentPerson={claimed}
      />

      <div className="flex h-[calc(100vh-16rem)] min-h-[28rem] flex-col">
        {claimed && claimed.id === other.id ? (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
            That is you. Pick someone else from the roster.
          </p>
        ) : (
          <DirectThread
            // Keyed by the pair so switching threads mounts a fresh view.
            key={`${claimed?.id ?? "anon"}:${other.id}`}
            other={other}
            initialMessages={messages}
            people={people}
          />
        )}
      </div>
    </div>
  );
}
