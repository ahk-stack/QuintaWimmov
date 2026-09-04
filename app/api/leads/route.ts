import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fieldErrors, newLeadSchema } from "@/lib/validation";

/**
 * Creates a lead.
 *
 * Client components never write to the store directly, so this is the only path
 * that creates a lead. The body is untrusted: there is no sign-in, so anyone who
 * has the URL can call this.
 */
export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "leads:create", 20, 60_000);
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

  // `createdBy` is attribution, not authentication. Checking it against the
  // roster keeps the audit trail meaningful; it proves nothing about the caller.
  const author = await store.getPerson(parsed.data.createdBy);
  if (!author) {
    return Response.json(
      { error: "That name is not on the roster", fields: { createdBy: "Pick your name again" } },
      { status: 400 },
    );
  }

  /*
   * Reject an unknown assignee rather than storing a dangling reference. The
   * dropdown is built from the roster, so this only fires on a hand-made
   * request — which, on an open URL, is exactly what has to be handled.
   */
  if (parsed.data.assignedTo) {
    const assignee = await store.getPerson(parsed.data.assignedTo);
    if (!assignee) {
      return Response.json(
        { error: "That person is not on the roster", fields: { assignedTo: "Pick someone else" } },
        { status: 400 },
      );
    }
  }

  try {
    const lead = await store.createLead(parsed.data);

    /*
     * Tell the assignee. Not when they assigned it to themselves: being
     * notified of your own action is noise, and it would leave a badge the
     * person cannot explain.
     */
    if (lead.assignedTo && lead.assignedTo !== parsed.data.createdBy) {
      await store.createNotifications([
        {
          personId: lead.assignedTo,
          kind: "lead_assigned",
          actorId: parsed.data.createdBy,
          sourceId: lead.id,
          href: `/leads/${lead.id}`,
          // The hotel name, not the context: contact details stay off the bell.
          preview: lead.hotelName,
        },
      ]);
    }

    return Response.json({ id: lead.id }, { status: 201 });
  } catch {
    /*
     * The thrown error can quote the row, which holds prospect contact details,
     * so it is neither logged nor returned. The caller gets a generic failure.
     */
    return Response.json({ error: "Could not save the lead" }, { status: 500 });
  }
}
