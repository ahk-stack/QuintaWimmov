"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { dayKey, formatDate, formatTime } from "@/lib/format";
import type { DirectMessage, Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { MessageComposer } from "./message-composer";
import { Avatar } from "./ui";

/**
 * A direct-message thread.
 *
 * Unlike channels there is no Realtime subscription, because `direct_messages`
 * grants the anon key nothing — an anon read policy would publish every
 * conversation through the REST API. New messages arrive by asking the server
 * to re-render instead, which keeps the contents behind the service-role key.
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

  // Keep the newest message in view when the server sends more.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [initialMessages.length]);

  /*
   * router.refresh() re-runs the server component, which re-reads the thread.
   * Paused while the tab is hidden so a forgotten tab does not poll all day.
   */
  useEffect(() => {
    if (!current) return;

    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, current]);

  async function send(body: string): Promise<string | null> {
    if (!current) return "Pick your name in the top right first.";
    try {
      const response = await fetch("/api/direct-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: current.id,
          recipientId: other.id,
          body,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        return result.error ?? "Could not send that";
      }
      // The server re-render is the source of truth for the thread.
      router.refresh();
      return null;
    } catch {
      return "Could not reach the server.";
    }
  }

  const grouped = useMemo(() => {
    const groups: { day: string; items: DirectMessage[] }[] = [];
    for (const message of initialMessages) {
      const day = dayKey(message.createdAt);
      const last = groups.at(-1);
      if (last && last.day === day) last.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [initialMessages]);

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
        <p className="mt-4 rounded-lg border border-status-watch px-3 py-2 text-xs text-status-watch">
          <span className="font-bold">Not confidential.</span> The app has no
          sign-in, so anyone who picks your name can read this. Keep anything
          sensitive out of it.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-6">
        {initialMessages.length === 0 ? (
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
