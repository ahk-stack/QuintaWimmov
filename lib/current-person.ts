import "server-only";

import { cookies } from "next/headers";

import { getStore } from "./db";
import type { Person } from "./types";

/**
 * Who the request claims to be, for server-side personalisation.
 *
 * ATTRIBUTION ONLY. The cookie is written by the browser and anyone can edit
 * it, exactly as anyone can pick any name from the roster. Nothing may be
 * authorised from this: use it to decide what to *show*, never what to *allow*.
 *
 * It exists so a page can render "my direct messages" without exposing an
 * endpoint that would let anyone enumerate another person's conversations.
 */
const COOKIE_KEY = "leadhub_identity";

export async function getClaimedPersonId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(COOKIE_KEY)?.value;
  return value && value.length > 0 ? value : null;
}

/** Resolves the claimed id against the roster, or null if it matches nobody. */
export async function getClaimedPerson(): Promise<Person | null> {
  const id = await getClaimedPersonId();
  if (!id) return null;
  // A malformed id resolves to null rather than throwing, per the store.
  return getStore().getPerson(id);
}
