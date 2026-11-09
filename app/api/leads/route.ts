import { authorize } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { wakeHubSpot } from "@/lib/hubspot/worker";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { fieldErrors, newLeadSchema } from "@/lib/validation";

/**
 * Creates a lead.
 *
 * Client components never write to the store directly, so this is the only path
 * that creates a lead. The creator is the signed-in person; the body cannot say
 * otherwise.
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const actorId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "leads:create", 20, 60_000);
  if (limited) return limited;

  const payload = await request.json().catch(() => null);
  const parsed = newLeadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Some fields need fixing", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const store = getStore();

  /*
   * Reject an unknown or removed assignee rather than storing a dangling
   * reference. The dropdown only offers active people, so this fires on a
   * hand-made request.
   */
  if (parsed.data.assignedTo) {
    const assignee = await store.getPerson(parsed.data.assignedTo);
    if (!assignee || !assignee.active) {
      return Response.json(
        { error: "That person is not on the roster", fields: { assignedTo: "Pick someone else" } },
        { status: 400 },
      );
    }
  }

  try {
    const lead = await store.createLead({ ...parsed.data, createdBy: actorId });

    /*
     * Tell the assignee. Not when they assigned it to themselves: being
     * notified of your own action is noise, and it would leave a badge the
     * person cannot explain.
     */
    if (lead.assignedTo && lead.assignedTo !== actorId) {
      await store.createNotifications([
        {
          personId: lead.assignedTo,
          kind: "lead_assigned",
          actorId,
          sourceId: lead.id,
          href: `/leads/${lead.id}`,
          // The hotel name, not the context: contact details stay off the bell.
          preview: lead.hotelName,
        },
      ]);
    }

    // The database queued it for HubSpot with the insert; this just starts the
    // worker once the response is out.
    wakeHubSpot();

    return Response.json({ id: lead.id }, { status: 201 });
  } catch {
    /*
     * The thrown error can quote the row, which holds prospect contact details,
     * so it is neither logged nor returned. The caller gets a generic failure.
     */
    return Response.json({ error: "Could not save the lead" }, { status: 500 });
  }
}
