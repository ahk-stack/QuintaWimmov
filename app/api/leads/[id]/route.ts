import { authorize } from "@/lib/auth/guard";
import { getStore } from "@/lib/db";
import { wakeHubSpot } from "@/lib/hubspot/worker";
import { enforcePersonRateLimit } from "@/lib/rate-limit";
import { fieldErrors, leadPatchSchema } from "@/lib/validation";

/**
 * Updates a lead's status, owner or priority, recording audit events.
 *
 * Any signed-in person may change any lead — the board is shared by design.
 * The timeline records who did it, from the session.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const actorId = auth.session.person.id;

  const limited = enforcePersonRateLimit(auth.session.person.id, "leads:update", 60, 60_000);
  if (limited) return limited;

  const { id } = await params;

  const payload = await request.json().catch(() => null);
  const parsed = leadPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "That change is not valid", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const store = getStore();
  const patch = parsed.data;

  // Reject an unknown or removed assignee rather than storing a dangling reference.
  if (patch.assignedTo) {
    const assignee = await store.getPerson(patch.assignedTo);
    if (!assignee || !assignee.active) {
      return Response.json(
        { error: "That person is not on the roster" },
        { status: 400 },
      );
    }
  }

  const existing = await store.getLead(id);
  if (!existing) {
    return Response.json({ error: "Lead not found" }, { status: 404 });
  }

  try {
    const lead = await store.updateLead(id, patch, actorId);

    /*
     * Notify a newly assigned owner, on the same terms as assignment at
     * creation: only on an actual change, and never when someone claims a lead
     * for themselves.
     */
    if (
      lead.assignedTo &&
      lead.assignedTo !== existing.assignedTo &&
      lead.assignedTo !== actorId
    ) {
      await store.createNotifications([
        {
          personId: lead.assignedTo,
          kind: "lead_assigned",
          actorId,
          sourceId: lead.id,
          href: `/leads/${lead.id}`,
          preview: lead.hotelName,
        },
      ]);
    }

    // Owner or status changes were queued for HubSpot by the database.
    wakeHubSpot();

    return Response.json({
      status: lead.status,
      assignedTo: lead.assignedTo,
      priority: lead.priority,
    });
  } catch {
    // Errors can quote the row, which holds contact details. Stay generic.
    return Response.json(
      { error: "Could not update the lead" },
      { status: 500 },
    );
  }
}
