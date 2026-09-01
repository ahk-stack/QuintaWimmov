import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fieldErrors, leadPatchSchema } from "@/lib/validation";

/**
 * Updates a lead's status, owner or priority, recording audit events.
 *
 * `actorId` labels who made the change. It is verified against the roster so the
 * timeline stays meaningful, but it authorises nothing: with no sign-in, anyone
 * with the URL can claim to be anyone, and the audit trail is honest about that.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "leads:update", 60, 60_000);
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
  const { actorId, ...patch } = parsed.data;

  const actor = await store.getPerson(actorId);
  if (!actor) {
    return Response.json(
      { error: "That name is not on the roster" },
      { status: 400 },
    );
  }

  // Reject an unknown assignee rather than storing a dangling reference.
  if (patch.assignedTo) {
    const assignee = await store.getPerson(patch.assignedTo);
    if (!assignee) {
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
