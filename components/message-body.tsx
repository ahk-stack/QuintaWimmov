"use client";

import { splitMentions } from "@/lib/mentions";
import type { Person } from "@/lib/types";

/**
 * Renders a message body with @mentions highlighted.
 *
 * Segments are rendered as text nodes, never as HTML, so a body cannot inject
 * markup no matter what someone types.
 *
 * A mention of the reader is emphasised more strongly than a mention of someone
 * else — the point of a mention is that you can find the ones aimed at you.
 * Monochrome, so that emphasis is weight and a filled background rather than
 * colour.
 */
export function MessageBody({
  body,
  people,
  currentPersonId,
}: {
  body: string;
  people: Person[];
  currentPersonId?: string | null;
}) {
  const segments = splitMentions(body, people);

  return (
    <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-line">
      {segments.map((segment, index) => {
        if (!segment.personId) {
          return <span key={index}>{segment.text}</span>;
        }
        const isMe = segment.personId === currentPersonId;
        return (
          <span
            key={index}
            className={
              isMe
                ? "rounded bg-ink px-1 font-bold text-paper"
                : "font-bold underline decoration-1 underline-offset-2"
            }
          >
            {segment.text}
          </span>
        );
      })}
    </p>
  );
}
