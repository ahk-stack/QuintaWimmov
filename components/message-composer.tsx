"use client";

import { useMemo, useRef, useState } from "react";

import {
  MENTION_PREFIX,
  activeMentionQuery,
  matchPeople,
} from "@/lib/mentions";
import type { Person } from "@/lib/types";

import { Avatar, Button } from "./ui";

/**
 * Message composer with @mention autocomplete.
 *
 * Shared by channels and direct messages so the two behave identically. Mention
 * ids are not tracked here: the server re-derives them from the submitted text,
 * because the author can edit or delete a name after picking it.
 */
export function MessageComposer({
  people,
  placeholder,
  sendingLabel = "Sending...",
  sendLabel = "Send",
  hint,
  /** Mentions are only meaningful where others can see them. */
  enableMentions = true,
  onSend,
}: {
  people: Person[];
  placeholder: string;
  sendingLabel?: string;
  sendLabel?: string;
  hint?: React.ReactNode;
  enableMentions?: boolean;
  onSend: (body: string) => Promise<string | null>;
}) {
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const mention = useMemo(() => {
    if (!enableMentions) return null;
    return activeMentionQuery(body, caret);
  }, [enableMentions, body, caret]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    return matchPeople(mention.query, people);
  }, [mention, people]);

  const open = suggestions.length > 0 && mention !== null;

  function insertMention(person: Person) {
    if (!mention) return;
    const before = body.slice(0, mention.start);
    const after = body.slice(caret);
    // Trailing space so the next word is not swallowed into the mention.
    const inserted = `${MENTION_PREFIX}${person.name} `;
    const next = `${before}${inserted}${after}`;
    const nextCaret = before.length + inserted.length;

    setBody(next);
    setHighlighted(0);
    // Restore focus and caret after React has applied the new value.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    const failure = await onSend(trimmed);
    if (failure) setError(failure);
    else setBody("");
    setSending(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      // While the menu is open these keys drive it rather than the textarea.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlighted((h) => (h + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlighted(
          (h) => (h - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertMention(suggestions[highlighted]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Collapse the menu by moving the caret out of the mention token.
        setCaret(body.length);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-3"
    >
      <div className="relative">
        {open ? (
          <ul
            role="listbox"
            aria-label="Mention someone"
            className="absolute bottom-full left-0 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line bg-paper shadow-lg"
          >
            {suggestions.map((person, index) => (
              <li key={person.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  // Mouse down fires before the textarea loses focus.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(person);
                  }}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${
                    index === highlighted ? "bg-surface font-bold" : ""
                  }`}
                >
                  <Avatar person={person} size="sm" />
                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                  {person.territory ? (
                    <span className="text-xs text-muted">
                      {person.territory}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <label className="block">
          <span className="sr-only">{placeholder}</span>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setCaret(event.target.selectionStart ?? 0);
            }}
            onKeyUp={(event) =>
              setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onClick={(event) =>
              setCaret(event.currentTarget.selectionStart ?? 0)
            }
            onKeyDown={handleKeyDown}
            rows={2}
            maxLength={4000}
            placeholder={placeholder}
            className="w-full resize-y rounded-lg border border-line-strong bg-paper px-3 py-2.5 text-sm placeholder:text-muted/70"
          />
        </label>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-bold text-status-lost">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={sending || body.trim().length === 0}>
          {sending ? sendingLabel : sendLabel}
        </Button>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
    </form>
  );
}
