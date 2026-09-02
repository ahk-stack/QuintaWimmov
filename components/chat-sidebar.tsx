import Link from "next/link";

import { formatDate } from "@/lib/format";
import type { Channel, Conversation, Person } from "@/lib/types";

import { Avatar } from "./ui";
import { NewDirectMessage } from "./new-direct-message";

/**
 * Channel list plus direct-message conversations.
 *
 * Conversations are rendered from the identity cookie server-side, so this page
 * never has to expose an endpoint that would let anyone list another person's
 * threads.
 */
export function ChatSidebar({
  channels,
  activeChannelSlug,
  conversations,
  activePersonId,
  people,
  currentPerson,
}: {
  channels: Channel[];
  activeChannelSlug?: string;
  conversations: Conversation[];
  activePersonId?: string;
  people: Person[];
  currentPerson: Person | null;
}) {
  const peopleById = new Map(people.map((p) => [p.id, p]));

  return (
    <nav aria-label="Conversations" className="space-y-8">
      <div>
        <h2 className="mb-3 text-xs font-bold tracking-[0.18em] uppercase">
          Channels
        </h2>
        <ul className="space-y-1">
          {channels.map((item) => {
            const active = item.slug === activeChannelSlug;
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
        <p className="mt-3 text-xs text-muted">Everyone can read these.</p>
      </div>

      <div>
        <h2 className="mb-3 text-xs font-bold tracking-[0.18em] uppercase">
          Direct
        </h2>

        {currentPerson ? (
          <>
            {conversations.length > 0 ? (
              <ul className="mb-3 space-y-1">
                {conversations.map((conversation) => {
                  const other = peopleById.get(conversation.personId) ?? null;
                  const active = conversation.personId === activePersonId;
                  return (
                    <li key={conversation.personId}>
                      <Link
                        href={`/chat/direct/${conversation.personId}`}
                        aria-current={active ? "page" : undefined}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                          active
                            ? "bg-ink font-bold text-paper"
                            : "text-muted hover:bg-surface hover:text-ink"
                        }`}
                      >
                        <Avatar person={other} size="sm" />
                        <span className="min-w-0 flex-1 truncate">
                          {other?.name ?? "Unknown"}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] ${active ? "text-paper/70" : ""}`}
                        >
                          {formatDate(conversation.lastMessage.createdAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-muted">No conversations yet.</p>
            )}

            <NewDirectMessage people={people} />
          </>
        ) : (
          <p className="text-xs text-muted">
            Pick your name in the top right to send a direct message.
          </p>
        )}
      </div>
    </nav>
  );
}
