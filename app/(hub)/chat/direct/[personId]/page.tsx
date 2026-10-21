import { notFound } from "next/navigation";

import { ChatSidebar } from "@/components/chat-sidebar";
import { DirectThread } from "@/components/direct-thread";
import { getStore, storeKind } from "@/lib/db";
import { getSession, requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  // Metadata runs outside the route-group layout, so it needs its own guard.
  if (storeKind() === "unconfigured") return { title: "Direct message" };
  // Signed-out visitors get a generic title, not a lead or person name.
  if (!(await getSession())) return { title: "Direct message" };

  const { personId } = await params;
  const person = await getStore().getPerson(personId);
  return { title: person ? person.name : "Person not found" };
}

export default async function DirectMessagePage({
  params,
}: {
  params: Promise<{ personId: string }>;
}) {
  const { person: me } = await requireUser();
  const { personId } = await params;
  const store = getStore();

  const [other, people, channels] = await Promise.all([
    store.getPerson(personId),
    store.listPeople(),
    store.listChannels(),
  ]);

  if (!other) notFound();

  /*
   * Only ever the thread between the signed-in person and `other`: the viewer
   * comes from the session, so a URL can name the other participant but never
   * swap in someone else as the reader.
   */
  const [messages, conversations] = await Promise.all([
    store.listDirectMessages(me.id, other.id),
    store.listConversations(me.id),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr]">
      <ChatSidebar
        channels={channels}
        conversations={conversations}
        activePersonId={other.id}
        people={people}
        currentPerson={me}
      />

      <div className="flex h-[calc(100vh-16rem)] min-h-[28rem] flex-col">
        {me.id === other.id ? (
          <p className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center text-sm text-muted">
            That is you. Pick someone else to message.
          </p>
        ) : (
          <DirectThread
            // Keyed by the pair so switching threads mounts a fresh view.
            key={`${me.id}:${other.id}`}
            other={other}
            initialMessages={messages}
            people={people}
          />
        )}
      </div>
    </div>
  );
}
