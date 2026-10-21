"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { dayKey, formatDate, formatTime } from "@/lib/format";
import type { DirectMessage, Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { MessageComposer } from "./message-composer";
import { Avatar } from "./ui";

/**
 * A direct-message thread.
 *
 * New messages come from polling GET /api/direct-messages, which only ever
 * returns the thread between the signed-in person and `other`. Polls do not
 * count as activity, so a thread left open still lets the session time out —
 * which a page refresh would not. `direct_messages` grants the publishable key
 * nothing.
 */

/** Poll cadence. Slow enough to be cheap, fast enough to feel like a chat. */
const REFRESH_MS = 6000;

export function DirectThread({
  other,
  initialMessages,
  people,
}: {
  other: Person;
  initialMessages: DirectMessage[];
  people: Person[];
}) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>(initialMessages);

  // Keep the newest message in view as more arrive.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/direct-messages?with=${encodeURIComponent(other.id)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.ok) {
        const { messages: thread } = (await response.json()) as { messages: DirectMessage[] };
        setMessages(thread);
      }
    } catch {
      // Offline for a moment; the next tick tries again.
    }
  }, [other.id, router]);

  // Paused while the tab is hidden so a forgotten tab does not poll all day.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  async function send(body: string): Promise<string | null> {
    if (!current) return "Pick your name in the top right first.";
    try {
      const response = await fetch("/api/direct-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: other.id,
          body,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        return result.error ?? "Could not send that";
      }
      // The server's copy of the thread is the source of truth.
      await load();
      return null;
    } catch {
      return "Could not reach the server.";
    }
  }

  const grouped = useMemo(() => {
    const groups: { day: string; items: DirectMessage[] }[] = [];
    for (const message of messages) {
      const day = dayKey(message.createdAt);
      const last = groups.at(-1);
      if (last && last.day === day) last.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [messages]);

  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.id, p])),
    [people],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line pb-4">
        <div className="flex items-center gap-3">
          <Avatar person={other} />
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight">{other.name}</h1>
            <p className="text-sm text-muted">
              Direct message
              {other.territory ? ` · ${other.territory}` : ""}
            </p>
          </div>
        </div>

        {/*
          Stated where it matters rather than buried in a policy page. Someone
          about to type something sensitive should see this first.
        */}
        <p className="mt-4 text-xs text-muted">
          Only you and {other.name} see this conversation in the app. Quinta
          administrators of the underlying database can still access it, so
          keep passwords and personal data out of chat.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            No messages yet. Say hello.
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
                    const author = peopleById.get(message.senderId) ?? null;
                    const mine = current?.id === message.senderId;
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
            Pick your name in the top right to send a message.
          </p>
        ) : (
          <MessageComposer
            people={people}
            placeholder={`Message ${other.name}`}
            /*
             * Mentions are off here. In a two-person thread there is nobody to
             * notify, and tagging a third party would imply they can see it.
             */
            enableMentions={false}
            hint={<>as {current.name} · Enter sends</>}
            onSend={send}
          />
        )}
      </div>
    </div>
  );
}
