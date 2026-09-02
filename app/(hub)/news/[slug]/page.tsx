import Link from "next/link";
import { notFound } from "next/navigation";

import { Markdown } from "@/components/markdown";
import { Avatar, Tag } from "@/components/ui";
import { getStore, storeKind } from "@/lib/db";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Metadata runs outside the route-group layout, so it needs its own guard.
  if (storeKind() === "unconfigured") return { title: "News" };

  const { slug } = await params;
  const item = await getStore().getNewsBySlug(slug);
  if (!item) return { title: "Post not found" };
  return {
    title: item.title,
    description: item.excerpt ?? undefined,
  };
}

export default async function NewsArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const store = getStore();

  const item = await store.getNewsBySlug(slug);
  if (!item) notFound();

  const author = item.authorId ? await store.getPerson(item.authorId) : null;

  return (
    <article className="mx-auto max-w-2xl">
      <nav className="mb-8">
        <Link
          href="/news"
          className="text-sm font-bold underline decoration-1 underline-offset-4 hover:no-underline"
        >
          Back to news
        </Link>
      </nav>

      <header className="mb-10 border-b border-line pb-8">
        <div className="flex flex-wrap items-center gap-2">
          {item.category ? <Tag>{item.category}</Tag> : null}
          {item.pinned ? <Tag>Pinned</Tag> : null}
        </div>

        <h1 className="mt-4 text-4xl leading-[1.1]">{item.title}</h1>

        {item.excerpt ? (
          <p className="mt-4 text-lg text-muted">{item.excerpt}</p>
        ) : null}

        <div className="mt-6 flex items-center gap-3 text-sm text-muted">
          <Avatar person={author} size="sm" />
          <span>
            {author?.name ?? "Quinta"} · {formatDate(item.publishedAt)}
          </span>
        </div>
      </header>

      <Markdown>{item.body}</Markdown>
    </article>
  );
}
