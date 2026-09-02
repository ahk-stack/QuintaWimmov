"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ROLE_LABEL } from "@/lib/status";
import type { Person } from "@/lib/types";

import { useIdentity } from "./identity";
import { Avatar } from "./ui";

/**
 * Starts a new direct-message thread.
 *
 * Filters yourself out of the list, since the database rejects a conversation
 * with yourself and offering it would be a dead end.
 */
export function NewDirectMessage({ people }: { people: Person[] }) {
  const router = useRouter();
  const { current, ready } = useIdentity();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return people
      .filter((p) => p.active && p.id !== current?.id)
      .filter((p) => needle.length === 0 || p.name.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [people, current?.id, query]);

  if (!ready || !current) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs font-bold text-muted hover:bg-surface hover:text-ink"
      >
        New message
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line p-2">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the roster"
          className="min-w-0 flex-1 rounded border border-line-strong px-2 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
          className="shrink-0 text-xs font-bold text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <ul className="max-h-64 overflow-y-auto">
        {candidates.length === 0 ? (
          <li className="px-2 py-2 text-xs text-muted">Nobody matches.</li>
        ) : (
          candidates.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  router.push(`/chat/direct/${person.id}`);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface"
              >
                <Avatar person={person} size="sm" />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
                <span className="shrink-0 text-[10px] text-muted">
                  {ROLE_LABEL[person.role]}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
