import { authorize, PRIVATE_HEADERS } from "@/lib/auth/guard";
import { checkOwnPassword } from "@/lib/auth/login";
import { getAuthStore } from "@/lib/db";
import { reauthSchema } from "@/lib/validation";

/**
 * Confirms the signed-in person's password again.
 *
 * Account changes need a recent confirmation, so a session left open on an
 * unattended laptop cannot be used to reset someone's password or hand out
 * admin rights.
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const parsed = reauthSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "That password didn't match." }, { status: 401, headers: PRIVATE_HEADERS });
  }

  try {
    const ok = await checkOwnPassword(request, auth.session.person.id, parsed.data.password);
    if (!ok) {
      return Response.json(
        { error: "That password didn't match. After several attempts, wait 15 minutes." },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }
    await getAuthStore().markReauthenticated(auth.session.sessionId);
    return Response.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch {
    return Response.json({ error: "Could not confirm right now." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
