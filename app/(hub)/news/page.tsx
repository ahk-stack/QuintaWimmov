import Link from "next/link";

import { NewsActions } from "@/components/news-actions";
import { Avatar, Card, EmptyState, PageHeader, Tag } from "@/components/ui";
import { getStore } from "@/lib/db";
import { formatDate, markdownLede } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Quinta news" };

export default async function NewsPage() {
  const store = getStore();
  const [items, people] = await Promise.all([
    store.listNews(),
    store.listPeople(),
  ]);

  const peopleById = new Map(people.map((p) => [p.id, p]));

  return (
    <>
      <PageHeader
        eyebrow="News"
        title="Quinta news"
        lede="Announcements, wins, and the occasional reminder."
        action={<NewsActions />}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing posted yet"
          hint="Admins can publish the first post. Anything the whole team needs to read belongs here rather than in chat, where it scrolls away."
        />
      ) : (
        <div className="space-y-5">
          {items.map((item) => {
            const author = item.authorId
              ? (peopleById.get(item.authorId) ?? null)
              : null;
            return (
              <Card key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  {item.category ? <Tag>{item.category}</Tag> : null}
                  {item.pinned ? <Tag>Pinned</Tag> : null}
                </div>

                <h2 className="mt-3 text-2xl leading-tight">
                  <Link href={`/news/${item.slug}`} className="hover:underline">
                    {item.title}
                  </Link>
                </h2>

                <p className="mt-2 max-w-2xl text-base text-muted">
                  {item.excerpt ?? markdownLede(item.body)}
                </p>

                <div className="mt-4 flex items-center gap-2 text-xs text-muted">
                  <Avatar person={author} size="sm" />
                  <span>
                    {author?.name ?? "Quinta"} · {formatDate(item.publishedAt)}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
