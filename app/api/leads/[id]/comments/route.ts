import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fieldErrors, leadCommentSchema } from "@/lib/validation";

/** Adds a comment to a lead's discussion thread. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = enforceRateLimit(request, "leads:comment", 40, 60_000);
  if (limited) return limited;

  const { id } = await params;

  const payload = await request.json().catch(() => null);
  const parsed = leadCommentSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "That comment is not valid", fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const store = getStore();

  const author = await store.getPerson(parsed.data.authorId);
  if (!author) {
    return Response.json(
      { error: "That name is not on the roster" },
      { status: 400 },
    );
  }

  const lead = await store.getLead(id);
  if (!lead) {
    return Response.json({ error: "Lead not found" }, { status: 404 });
  }

  try {
    const comment = await store.createLeadComment({
      leadId: id,
      authorId: parsed.data.authorId,
      body: parsed.data.body,
    });
    return Response.json({ id: comment.id }, { status: 201 });
  } catch {
    return Response.json(
      { error: "Could not save the comment" },
      { status: 500 },
    );
  }
}
