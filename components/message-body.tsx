"use client";

import { splitMentions } from "@/lib/mentions";
import type { Person } from "@/lib/types";

/**
 * Renders a message body with @mentions highlighted.
 *
 * Two separate jobs, deliberately kept apart:
 *
 * - WHETHER a message mentions someone is decided by the CALLER, from the
 *   `mentions` ids recorded at send time. That survives a rename or a roster
 *   removal, and is what drives the "mentions you" marker on the row.
 * - WHERE to draw the inline highlight is decided here, by parsing the text
 *   against the current roster — the stored ids say who was mentioned, not
 *   which characters to mark. After a rename the old spelling stops matching
 *   and loses its highlight, while the row still reports the mention.
 *
 * Segments render as text nodes, never HTML, so a body cannot inject markup.
 * Emphasis is weight and a filled background, never colour.
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
