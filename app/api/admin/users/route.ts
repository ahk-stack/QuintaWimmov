import { accountErrorResponse } from "@/lib/auth/admin-responses";
import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { getAuthStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { fieldErrors, initialsFor, newUserSchema } from "@/lib/validation";

/**
 * Creates a person and their sign-in in one step. Admins only, with a recent
 * password confirmation. The database function re-checks the admin inside its
 * transaction; the check here is the fast answer.
 */
export async function POST(request: Request) {
  const auth = await authorize(request, { admin: true, reauth: true });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "admin:users", 60, 60_000);
  if (limited) return limited;

  const parsed = newUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Some fields need fixing", fields: fieldErrors(parsed.error) },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const { name, email, role, territory, username, password } = parsed.data;
  const problem = passwordProblem(password, username);
  if (problem) {
    return Response.json(
      { error: problem, fields: { password: problem } },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  try {
    const id = await getAuthStore().createUser(
      auth.session.person.id,
      { name, email, role, territory, initials: initialsFor(name) },
      { username, passwordHash: await hashPassword(password) },
    );
    return Response.json({ id }, { status: 201, headers: PRIVATE_HEADERS });
  } catch (error) {
    return accountErrorResponse(error, "Could not create that user.");
  }
}
