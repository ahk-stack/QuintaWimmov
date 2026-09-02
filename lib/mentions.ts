import type { Person } from "./types";

/**
 * @mention parsing.
 *
 * Mentions are resolved by matching roster names in the text rather than by
 * tracking what the composer inserted, because the author can edit or delete
 * text after picking someone. Matching the final body is the only thing that
 * stays true.
 *
 * Shared by the client (composer, highlighting) and the server (recording ids),
 * so both agree on what counts as a mention. It must therefore stay free of
 * server-only imports.
 */

/** The trigger character, kept in one place so the composer and parser agree. */
export const MENTION_PREFIX = "@";

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds one alternation of every roster name.
 *
 * Sorted longest-first so "Maria Mina" wins over a hypothetical "Maria", which
 * would otherwise match first and leave " Mina" as stray text.
 */
function buildPattern(people: Person[]): RegExp | null {
  const names = people
    .map((p) => p.name)
    .filter((n) => n.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex);
  if (names.length === 0) return null;
  return new RegExp(`${escapeForRegex(MENTION_PREFIX)}(${names.join("|")})`, "gi");
}

/** Ids of everyone mentioned in `body`, de-duplicated. */
export function findMentions(body: string, people: Person[]): string[] {
  const pattern = buildPattern(people);
  if (!pattern) return [];

  const byLowerName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
  const found = new Set<string>();

  for (const match of body.matchAll(pattern)) {
    const id = byLowerName.get(match[1].toLowerCase());
    if (id) found.add(id);
  }
  return [...found];
}

export interface Segment {
  text: string;
  /** Set when this segment is a mention of a known person. */
  personId?: string;
}

/**
 * Splits a body into plain and mention segments for rendering.
 *
 * Returning segments rather than HTML keeps this safe by construction: the
 * caller renders text nodes, so a message body can never inject markup.
 */
export function splitMentions(body: string, people: Person[]): Segment[] {
  const pattern = buildPattern(people);
  if (!pattern) return [{ text: body }];

  const byLowerName = new Map(people.map((p) => [p.name.toLowerCase(), p.id]));
  const segments: Segment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(pattern)) {
    const start = match.index ?? 0;
    const id = byLowerName.get(match[1].toLowerCase());

    // An unknown name is left as ordinary text rather than a dead highlight.
    if (!id) continue;

    if (start > cursor) segments.push({ text: body.slice(cursor, start) });
    segments.push({ text: match[0], personId: id });
    cursor = start + match[0].length;
  }

  if (cursor < body.length) segments.push({ text: body.slice(cursor) });
  return segments.length > 0 ? segments : [{ text: body }];
}

/**
 * Reads a partial mention immediately before the caret.
 *
 * Returns null unless the caret sits in an active `@…` token, so the
 * autocomplete only opens while someone is actually typing a mention. The query
 * allows one space, so "@Maria M" still matches a two-word name.
 */
export function activeMentionQuery(
  value: string,
  caret: number,
): { query: string; start: number } | null {
  const upToCaret = value.slice(0, caret);
  const at = upToCaret.lastIndexOf(MENTION_PREFIX);
  if (at === -1) return null;

  // Must be at the start or preceded by whitespace, so emails do not trigger it.
  const before = at === 0 ? "" : upToCaret[at - 1];
  if (before && !/\s/.test(before)) return null;

  const query = upToCaret.slice(at + MENTION_PREFIX.length);
  // Bail out once the token grows beyond a plausible name fragment.
  if (query.includes("\n") || query.length > 40) return null;
  if ((query.match(/\s/g) ?? []).length > 1) return null;

  return { query, start: at };
}

/** Roster matches for a partial mention query, best-first. */
export function matchPeople(
  query: string,
  people: Person[],
  limit = 6,
): Person[] {
  const needle = query.trim().toLowerCase();
  const active = people.filter((p) => p.active);
  if (needle.length === 0) return active.slice(0, limit);

  const startsWith: Person[] = [];
  const contains: Person[] = [];
  for (const person of active) {
    const name = person.name.toLowerCase();
    if (name.startsWith(needle)) startsWith.push(person);
    else if (name.includes(needle)) contains.push(person);
  }
  return [...startsWith, ...contains].slice(0, limit);
}
