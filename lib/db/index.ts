import "server-only";

import type { AuthStore } from "./auth-store";
import { fileAuth } from "./file-auth";
import { fileStore } from "./file-store";
import type { DataStore } from "./store";
import { supabaseAuth } from "./supabase-auth";
import { supabaseStore, supabaseUrl } from "./supabase-store";

export type {
  DataStore,
  HubSpotClaim,
  HubSpotIds,
  LeadFilter,
  LeadPatch,
  NewLead,
} from "./store";

/**
 * Selects the active data store.
 *
 * Supabase whenever its variables are present. Otherwise the local file store,
 * which exists so the UI can be developed without credentials and refuses to
 * run in production unless explicitly allowed.
 *
 * Importing this module from a client component is a build error, by way of
 * `server-only` above. That is deliberate: the store holds prospect contact
 * details and runs under the service-role key.
 */

/*
 * The publishable (anon) key is no longer required: since sign-in, the browser
 * talks only to this app, never to Supabase. Only the URL and the server key.
 */
function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Escape hatch for a throwaway deployment with no database.
 *
 * The file store keeps state on local disk, so on a serverless platform every
 * instance gets its own copy and a redeploy wipes it. That is fine for a demo
 * and unacceptable for real leads, which is why it is opt-in and never the
 * default.
 */
function devStoreAllowedInProduction(): boolean {
  return process.env.ALLOW_DEV_STORE === "true";
}

export type StoreKind = "supabase" | "dev" | "unconfigured";

export function storeKind(): StoreKind {
  if (supabaseConfigured()) return "supabase";
  if (process.env.NODE_ENV !== "production") return "dev";
  return devStoreAllowedInProduction() ? "dev" : "unconfigured";
}

export class StoreNotConfiguredError extends Error {
  constructor() {
    super(
      "No data store is configured. Set the Supabase environment variables, " +
        "or set ALLOW_DEV_STORE=true to run on ephemeral local disk.",
    );
    this.name = "StoreNotConfiguredError";
  }
}

/**
 * Callers that render UI should check `storeKind()` first and show the setup
 * screen, rather than letting this throw and turning every page into a 500.
 */
export function getStore(): DataStore {
  const kind = storeKind();
  if (kind === "unconfigured") throw new StoreNotConfiguredError();
  return kind === "supabase" ? supabaseStore : fileStore;
}

/** The sign-in store matching `getStore()`. Same configuration rules. */
export function getAuthStore(): AuthStore {
  const kind = storeKind();
  if (kind === "unconfigured") throw new StoreNotConfiguredError();
  return kind === "supabase" ? supabaseAuth : fileAuth;
}

/** True when running on the local file store rather than a real database. */
export function isUsingDevStore(): boolean {
  return storeKind() === "dev";
}
