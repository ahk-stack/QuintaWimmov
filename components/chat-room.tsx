"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dayKey, formatDate, formatTime } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { Channel, Message, Person } from "@/lib/types";

import { findMentions } from "@/lib/mentions";

import { useIdentity } from "./identity";
import { MessageBody } from "./message-body";
import { MessageComposer } from "./message-composer";
import { Avatar } from "./ui";

/**
 * A live chat channel.
 *
 * Reads arrive over Supabase Realtime using the anon key, which RLS restricts
 * to `SELECT` on `messages` and `channels`. Writes go to /api/messages, so the
 * browser never needs insert rights.
 */

/** Shape Realtime delivers: the raw row, snake_case. */
interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  mentions: string[] | null;
}

const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  channelId: r.channel_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  mentions: r.mentions ?? [],
});

export function ChatRoom({
  channel,
  initialMessages,
  people,
}: {
  channel: Channel;
  initialMessages: Message[];
  people: Person[];
}) {
  const { current, ready } = useIdentity();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [live, setLive] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  /**
   * Merges a message in, keyed by id.
   *
   * The sender appends its own message on a successful POST and Realtime then
   * echoes the same row back, so without keying by id every message the sender
   * writes would appear twice.
   */
  const upsert = useCallback((incoming: Message) => {
    setMessages((previous) => {
      if (previous.some((m) => m.id === incoming.id)) return previous;
      return [...previous, incoming].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
    });
  }, []);

  // Realtime subscription, scoped to this channel.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const subscription = supabase
      .channel(`room:${channel.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channel.id}`,
        },
        (payload) => upsert(rowToMessage(payload.new as MessageRow)),
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(subscription);
    };
  }, [channel.id, upsert]);

  // Keep the newest message in view as messages arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  /**
   * Sends a message. Returns an error string for the composer to show, or null
   * on success so it can clear itself.
   */
  async function send(trimmed: string): Promise<string | null> {
    if (!current) return "Pick your name in the top right first.";
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: channel.id,
          authorId: current.id,
          body: trimmed,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        return result.error ?? "Could not send that";
      }
      const { id } = await response.json();
      /*
       * Show it immediately rather than waiting for the Realtime round trip, so
       * the composer feels instant and still works if the socket is down. The
       * id-keyed upsert makes the echo a no-op.
       */
      upsert({
        id,
        channelId: channel.id,
        authorId: current.id,
        body: trimmed,
        createdAt: new Date().toISOString(),
        editedAt: null,
        // Display-only here; the server records the authoritative list.
        mentions: findMentions(trimmed, people),
      });
      return null;
    } catch {
      return "Could not reach the server.";
    }
  }

  // Group consecutive messages under a date divider.
  const grouped = useMemo(() => {
    const groups: { day: string; items: Message[] }[] = [];
    for (const message of messages) {
      const day = dayKey(message.createdAt);
      const last = groups.at(-1);
      if (last && last.day === day) last.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
        <div>
          <h1 className="text-2xl">{channel.name}</h1>
          {channel.description ? (
            <p className="mt-1 text-sm text-muted">{channel.description}</p>
          ) : null}
        </div>
        <span
          className={`shrink-0 text-xs font-bold ${live ? "text-status-won" : "text-status-pending"}`}
          title={
            live
              ? "New messages appear without a reload"
              : "Not connected; reload to see new messages"
          }
        >
          {live ? "Live" : "Offline"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            Nothing here yet. Say something.
          </p>
        ) : (
          <div className="space-y-8">
            {grouped.map((group) => (
              <div key={group.day}>
                <p className="mb-4 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line" />
                  {formatDate(group.items[0].createdAt)}
                  <span className="h-px flex-1 bg-line" />
                </p>
                <ul className="space-y-5">
                  {group.items.map((message) => {
                    const author = peopleById.get(message.authorId) ?? null;
                    const mine = current?.id === message.authorId;
                    return (
                      <li key={message.id} className="flex gap-3">
                        <Avatar person={author} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs">
                            <span className="font-bold">
                              {author?.name ?? "Unknown"}
                            </span>
                            {mine ? (
                              <span className="text-muted"> (you)</span>
                            ) : null}
                            <span className="text-muted">
                              {" · "}
                              {formatTime(message.createdAt)}
                            </span>
                          </p>
                          <MessageBody
                            body={message.body}
                            people={people}
                            currentPersonId={current?.id}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line pt-4">
        {!ready ? null : !current ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-3 text-sm text-muted">
            Pick your name in the top right to join the conversation.
          </p>
        ) : (
          <MessageComposer
            people={people}
            placeholder={`Message ${channel.name}`}
            hint={
              <>
                as {current.name} · type {"@"} to mention someone · Enter sends
              </>
            }
            onSend={send}
          />
        )}
      </div>
    </div>
  );
}
