import { isSameOriginRequest } from "@/lib/auth/csrf";
import { PRIVATE_HEADERS } from "@/lib/auth/guard";
import { burnLoginAttempt, checkLogin, LOGIN_FAILED } from "@/lib/auth/login";
import { startSession } from "@/lib/auth/session";
import { storeKind } from "@/lib/db";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";

/**
 * Signs in with a username and password.
 *
 * Every credential failure, whatever the cause, is the same 401 with the same
 * body — including the in-memory limit, a cheap first gate per instance in front
 * of the shared throttle inside `checkLogin`. Throttled requests skip the KDF on
 * purpose (it would only burn CPU for an attacker); they are throttled by
 * address, so that reveals nothing about any account.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "This request was refused." }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (storeKind() === "unconfigured") {
    return Response.json({ error: "The app is not configured yet." }, { status: 503, headers: PRIVATE_HEADERS });
  }

  const failed = () =>
    Response.json({ error: LOGIN_FAILED }, { status: 401, headers: PRIVATE_HEADERS });

  if (!rateLimit(clientKey(request, "auth:login"), 30, 60_000).ok) return failed();

  const body: unknown = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    // Same cost as a real attempt, so a malformed request is not a faster probe.
    await burnLoginAttempt((body as { password?: unknown } | null)?.password);
    return failed();
  }

  try {
    const personId = await checkLogin(request, parsed.data.username, parsed.data.password);
    if (!personId) return failed();
    await startSession(personId);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch {
    // Never echo the cause: it could carry the username or a database detail.
    return Response.json({ error: "Sign-in is unavailable right now." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
