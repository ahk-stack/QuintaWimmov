import "server-only";

import type { HubSpotErrorCode } from "../types";
import { hubspotApiBase, hubspotToken } from "./config";

/**
 * A minimal HubSpot REST client: fetch, a timeout, bounded retries, and errors
 * that carry only a fixed code.
 *
 * HubSpot error bodies quote the request — contact emails, phones — so they are
 * never read into an Error message, logged, or stored. Callers see a
 * `HubSpotError` with a code, the HTTP status, and whether a retry is safe.
 */

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;

export class HubSpotError extends Error {
  constructor(
    public readonly code: HubSpotErrorCode,
    public readonly status: number | null,
    /** Worth trying again later. */
    public readonly retryable: boolean,
    /**
     * The request may have taken effect even though we got no answer (timeout,
     * network drop, 5xx). For a create, that means "search before retrying".
     */
    public readonly ambiguous: boolean,
  ) {
    super(`HubSpot request failed: ${code}`);
    this.name = "HubSpotError";
  }
}

function classify(status: number): HubSpotError {
  if (status === 401) return new HubSpotError("hubspot:auth", status, false, false);
  if (status === 403) return new HubSpotError("hubspot:scope", status, false, false);
  if (status === 404) return new HubSpotError("hubspot:not_found", status, false, false);
  if (status === 429) return new HubSpotError("hubspot:rate_limited", status, true, false);
  if (status >= 500) return new HubSpotError("hubspot:server", status, true, true);
  return new HubSpotError("hubspot:validation", status, false, false);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RequestOptions {
  /**
   * Safe to repeat automatically: reads, searches, PATCHes that set absolute
   * values, and association PUTs (which converge on the same link). Creates are NOT — a retried create can duplicate, so the
   * caller searches first instead.
   */
  idempotent: boolean;
}

/** Returns the parsed JSON body (or null for 204). Throws HubSpotError. */
export async function hubspotRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
  options: RequestOptions,
): Promise<T> {
  const token = hubspotToken();
  if (!token) throw new HubSpotError("not_configured", null, false, false);

  const attempts = options.idempotent ? 3 : 1;
  let last: HubSpotError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${hubspotApiBase()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      last = new HubSpotError(timedOut ? "hubspot:timeout" : "hubspot:network", null, true, true);
      if (attempt < attempts) await sleep(500 * attempt);
      continue;
    }

    if (response.ok) {
      if (response.status === 204) return null as T;
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) {
        throw new HubSpotError("hubspot:unexpected", response.status, false, false);
      }
      try {
        return (text ? JSON.parse(text) : null) as T;
      } catch {
        throw new HubSpotError("hubspot:unexpected", response.status, false, false);
      }
    }

    // Drain without reading it into anything that could be logged.
    await response.body?.cancel().catch(() => {});
    last = classify(response.status);
    if (!last.retryable || attempt === attempts) break;

    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * attempt;
    await sleep(wait);
  }

  throw last ?? new HubSpotError("hubspot:unexpected", null, false, false);
}
