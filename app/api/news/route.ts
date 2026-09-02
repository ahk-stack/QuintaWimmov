import { getStore } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { fieldErrors, newsSchema, slugify } from "@/lib/validation";

/**
 * Publishes a news post.
 *
 * Restricted to people whose roster role is `admin`. That is a guard rail, NOT
 * authorisation: identity here is a name picked from a dropdown, so anyone
 * could select an admin and post. It exists so the whole team does not publish
 * company announcements by accident, and it is the strongest thing available
 * while the app has no sign-in. Do not mistake it for access control.
 */

/** Distinct slugs to try before giving up, when the derived one is taken. */
const MAX_SLUG_ATTEMPTS = 20;

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "news:create", 10, 60_000);
  if (limited) return limited;

  const payload = await request.json().catch(() => null);
  const parsed = newsSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Some fields need fixing", fields: fieldErrors(parsed.error) },
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
  if (author.role !== "admin") {
    return Response.json(
      { error: "Only admins can publish news" },
      { status: 403 },
    );
  }

  /*
   * Slug is derived server-side, never accepted from the client, so it cannot
   * smuggle path segments or be aimed at an existing post. On a collision, try
   * a numbered suffix rather than failing the write.
   */
  const base = slugify(parsed.data.title);

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (await store.getNewsBySlug(slug)) continue;

    try {
      const item = await store.createNews({ ...parsed.data, slug });
      return Response.json({ slug: item.slug }, { status: 201 });
    } catch (error) {
      // Lost a race between the check and the insert: try the next suffix.
      if (error instanceof Error && error.name === "SlugTakenError") continue;
      return Response.json(
        { error: "Could not publish the post" },
        { status: 500 },
      );
    }
  }

  return Response.json(
    { error: "Could not find a free URL for that title. Try a different one." },
    { status: 409 },
  );
}
