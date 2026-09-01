import "server-only";

import { fileStore } from "./file-store";
import type { DataStore } from "./store";

export type {
  DataStore,
  HubSpotResult,
  LeadFilter,
  LeadPatch,
  NewLead,
} from "./store";

/**
 * Selects the active data store.
 *
 * Phase 1 ships only the development file store; Phase 2 adds the Supabase
 * implementation and selects it whenever the Supabase environment variables are
 * present, leaving the file store as the no-credentials local fallback.
 *
 * Importing this module from a client component is a build error, by way of
 * `server-only` above. That is deliberate: the store holds prospect contact
 * details and, once Supabase lands, runs under the service-role key.
 */

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

export type StoreKind = "dev" | "unconfigured";

export function storeKind(): StoreKind {
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
  if (storeKind() === "unconfigured") throw new StoreNotConfiguredError();
  return fileStore;
}

/** True when running on the local file store rather than a real database. */
export function isUsingDevStore(): boolean {
  return storeKind() === "dev";
}
