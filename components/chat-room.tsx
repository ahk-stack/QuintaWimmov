"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dayKey, formatDate, formatTime } from "@/lib/format";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import type { Channel, Message, Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { Avatar, Button } from "./ui";

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
}

const rowToMessage = (r: MessageRow): Message => ({
  id: r.id,
  channelId: r.channel_id,
  authorId: r.author_id,
  body: r.body,
  createdAt: r.created_at,
  editedAt: r.edited_at,
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
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || sending || !current) return;

    setSending(true);
    setError(null);
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
        setError(result.error ?? "Could not send that");
        return;
      }
      const { id } = await response.json();
      setBody("");
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
      });
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
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
                          <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-line">
                            {message.body}
                          </p>
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
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="sr-only">Message {channel.name}</span>
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter makes a new line.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder={`Message ${channel.name}`}
                className="w-full resize-y rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70"
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs font-bold text-status-lost">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={sending || body.trim().length === 0}>
                {sending ? "Sending..." : "Send"}
              </Button>
              <span className="text-xs text-muted">
                as {current.name} · Enter sends, Shift+Enter for a new line
              </span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
