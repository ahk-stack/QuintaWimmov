import "server-only";

import { storeKind } from "../db";
import { isSameOriginRequest } from "./csrf";
import { isRecentlyReauthenticated, sessionForRequest, type CurrentSession } from "./session";

/**
 * The one gate every route handler goes through.
 *
 * Order matters: the origin check runs before anything touches the database,
 * and the session is the only source of "who is asking". Request bodies no
 * longer carry an actor id at all.
 *
 *   const auth = await authorize(request, { admin: true, reauth: true });
 *   if (!auth.ok) return auth.response;
 *   auth.session.person.id // the caller, proven
 */

export type Authorized =
  | { ok: true; session: CurrentSession }
  | { ok: false; response: Response };

/*
 * Never cached: an authenticated answer must not be replayed to whoever uses
 * the browser or a shared proxy next.
 */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

function deny(status: number, error: string, extra: Record<string, unknown> = {}): Authorized {
  return {
    ok: false,
    response: Response.json({ error, ...extra }, { status, headers: PRIVATE_HEADERS }),
  };
}

export async function authorize(
  request: Request,
  options: {
    /** Only admins. */
    admin?: boolean;
    /** Admin must have re-entered their password within the last few minutes. */
    reauth?: boolean;
    /** False for background polling, so an idle tab still times out. */
    touch?: boolean;
  } = {},
): Promise<Authorized> {
  if (!isSameOriginRequest(request)) {
    return deny(403, "This request was refused.");
  }
  if (storeKind() === "unconfigured") {
    return deny(503, "The app is not configured yet.");
  }

  const session = await sessionForRequest({ touch: options.touch });
  if (!session) return deny(401, "Your session has ended. Sign in again.");

  if (options.admin && session.person.role !== "admin") {
    return deny(403, "Only admins can do that.");
  }
  if (options.reauth && !isRecentlyReauthenticated(session)) {
    // The client shows a password prompt on this flag, then retries.
    return deny(403, "Confirm your password to continue.", { reauth: true });
  }

  return { ok: true, session };
}
