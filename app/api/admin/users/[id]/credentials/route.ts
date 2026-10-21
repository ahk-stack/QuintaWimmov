import { accountErrorResponse } from "@/lib/auth/admin-responses";
import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { endSession } from "@/lib/auth/session";
import { getAuthStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { credentialsSchema, fieldErrors } from "@/lib/validation";

/**
 * Sets or changes someone's username and/or password. Admins only — people do
 * not change their own credentials in this app.
 *
 * Every existing session of that person ends, so an old password stops working
 * everywhere at once — including the session making the request. An admin who
 * changes their OWN sign-in is therefore signed out and must sign in with the
 * new credentials. Re-issuing a session here instead would let a stolen,
 * recently confirmed session reset the password and stay signed in.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request, { admin: true, reauth: true });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "admin:users", 60, 60_000);
  if (limited) return limited;

  const parsed = credentialsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Some fields need fixing", fields: fieldErrors(parsed.error) },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await params;
  const { username, password } = parsed.data;
  const store = getAuthStore();

  if (password !== undefined) {
    // Checked against the username they will have afterwards, new or existing.
    const effectiveUsername = username ?? (await store.getUsername(id));
    const problem = passwordProblem(password, effectiveUsername);
    if (problem) {
      return Response.json(
        { error: problem, fields: { password: problem } },
        { status: 400, headers: PRIVATE_HEADERS },
      );
    }
  }

  const self = id === auth.session.person.id;
  try {
    await store.setCredentials(auth.session.person.id, id, {
      username: username ?? null,
      passwordHash: password !== undefined ? await hashPassword(password) : null,
    });
    if (self) {
      // The session row is already gone; this clears the cookie too.
      await endSession();
      return Response.json({ ok: true, signedOut: true }, { headers: PRIVATE_HEADERS });
    }
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return accountErrorResponse(error, "Could not update that sign-in.");
  }
}
