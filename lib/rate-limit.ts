import "server-only";

/**
 * Fixed-window rate limiting for the write endpoints.
 *
 * There is no sign-in, so anyone who learns the URL can POST. This is the only
 * thing standing between a bored visitor and a few thousand junk leads, or a
 * flood of HubSpot writes.
 *
 * Known limitation: the counters live in this process's memory. On Vercel each
 * serverless instance keeps its own, so the effective limit is per-instance
 * rather than global, and a cold start resets it. That is a meaningful weakening
 * under load, not a rounding error. A shared store (Upstash Redis, or Postgres)
 * is the correct fix when this moves beyond internal traffic; it is deliberately
 * deferred rather than overlooked.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bound the map so a spray of distinct keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client key.
 *
 * `x-forwarded-for` is set by the platform proxy in front of the app. It is
 * spoofable when the app is reached directly, so this identifies a caller well
 * enough to throttle honest mistakes and casual abuse, and no more.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `${scope}:${ip}`;
}

/**
 * Applies a limit and returns a 429 response when exceeded, or null to continue.
 */
export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
): Response | null {
  const { ok, retryAfterSeconds } = rateLimit(
    clientKey(request, scope),
    limit,
    windowMs,
  );
  if (ok) return null;
  return Response.json(
    { error: "Too many requests. Wait a moment and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}
