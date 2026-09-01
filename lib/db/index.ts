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
 * Returns the active data store.
 *
 * Phase 1 ships only the development file store. Phase 2 adds the Supabase
 * implementation alongside the migrations and selects it whenever the Supabase
 * environment variables are present; the file store then remains as the
 * no-credentials local fallback.
 *
 * Importing this module from a client component is a build error, by way of
 * `server-only` above. That is deliberate: the store holds prospect contact
 * details and, once Supabase lands, runs under the service-role key.
 */
export function getStore(): DataStore {
  return fileStore;
}

/** True when the app is running on the local file store rather than Supabase. */
export function isUsingDevStore(): boolean {
  return true;
}
