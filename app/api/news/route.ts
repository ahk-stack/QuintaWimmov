import { randomUUID } from "node:crypto";

import { getStore } from "@/lib/db";
import { SlugTakenError } from "@/lib/db/store";
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

/**
 * Numbered suffixes to try before falling back to a random one.
 *
 * Starts at 2, so the first duplicate of "spring-update" is
 * "spring-update-2" — the usual convention, and "-1" reads as though there
 * were a zeroth post.
 */
const MAX_NUMBERED_SLUGS = 20;

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
   * smuggle path segments or be aimed at an existing post.
   *
   * Candidates: the clean slug, then numbered suffixes, then a random one. The
   * random tail means a publish can never be rejected for want of a free URL,
   * which is better than returning an error while the post is written and the
   * author is waiting.
   */
  const base = slugify(parsed.data.title);

  function* candidates(): Generator<string> {
    yield base;
    for (let n = 2; n <= MAX_NUMBERED_SLUGS; n++) yield `${base}-${n}`;
    yield `${base}-${randomUUID().slice(0, 8)}`;
  }

  for (const slug of candidates()) {
    // Cheap pre-check; the store's unique constraint is the real arbiter.
    if (await store.getNewsBySlug(slug)) continue;

    try {
      const item = await store.createNews({ ...parsed.data, slug });
      return Response.json({ slug: item.slug }, { status: 201 });
    } catch (error) {
      // Lost a race between the check and the insert: try the next candidate.
      if (error instanceof SlugTakenError) continue;
      return Response.json(
        { error: "Could not publish the post" },
        { status: 500 },
      );
    }
  }

  // Only reachable if even the random slug collided, i.e. essentially never.
  return Response.json(
    { error: "Could not publish the post" },
    { status: 500 },
  );
}
