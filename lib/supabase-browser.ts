import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, holding the anon key.
 *
 * This is the ONLY Supabase client that reaches the browser, and it exists for
 * one job: subscribing to Realtime inserts on `messages` so chat updates
 * without a reload.
 *
 * The anon key is public by design — it ships in the bundle and anyone can read
 * it. What makes that safe is RLS, not secrecy: the database grants anon
 * `SELECT` on `channels` and `messages` and nothing else, so this key cannot
 * read a single lead, comment or roster row, and cannot write anywhere.
 * `npm run verify:rls` asserts exactly that against the live project.
 *
 * Sending a message still POSTs to /api/messages. Never add a write here.
 */

let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Absent when running on the local file store; chat then falls back to
  // showing whatever the server rendered, without live updates.
  if (!url || !anonKey) return null;

  cached = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      // A single channel per room; no need for a high event rate.
      params: { eventsPerSecond: 5 },
    },
  });
  return cached;
}
