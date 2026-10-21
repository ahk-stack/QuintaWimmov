import { accountErrorResponse } from "@/lib/auth/admin-responses";
import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { getAuthStore } from "@/lib/db";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { fieldErrors, initialsFor, profileSchema } from "@/lib/validation";

/** Edits someone's name, email, role or territory. Admins only. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request, { admin: true, reauth: true });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "admin:users", 60, 60_000);
  if (limited) return limited;

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Some fields need fixing", fields: fieldErrors(parsed.error) },
      { status: 400, headers: PRIVATE_HEADERS },
    );
  }

  const { id } = await params;
  try {
    await getAuthStore().updateUser(auth.session.person.id, id, {
      ...parsed.data,
      initials: initialsFor(parsed.data.name),
    });
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return accountErrorResponse(error, "Could not save those changes.");
  }
}

/**
 * Deletes a user: their sign-in and sessions go, and they disappear from every
 * list. The person record stays, hidden, so leads and messages they wrote keep
 * an author.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request, { admin: true, reauth: true });
  if (!auth.ok) return auth.response;

  const limited = enforcePersonRateLimit(auth.session.person.id, "admin:users", 60, 60_000);
  if (limited) return limited;

  const { id } = await params;
  try {
    await getAuthStore().deleteUser(auth.session.person.id, id);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return accountErrorResponse(error, "Could not delete that user.");
  }
}
