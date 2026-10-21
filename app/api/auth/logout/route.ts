import { isSameOriginRequest } from "@/lib/auth/csrf";
import { PRIVATE_HEADERS } from "@/lib/auth/guard";
import { endSession } from "@/lib/auth/session";
import { storeKind } from "@/lib/db";

/**
 * Signs out: deletes the session server-side, so the cookie is worthless even
 * if it was copied, then clears it.
 *
 * Origin-checked like any other mutation, so another site cannot sign people
 * out. Works without a valid session, so a stale cookie can always be cleared.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "This request was refused." }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (storeKind() !== "unconfigured") {
    try {
      await endSession();
    } catch {
      return Response.json({ error: "Could not sign out." }, { status: 500, headers: PRIVATE_HEADERS });
    }
  }
  return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
}
