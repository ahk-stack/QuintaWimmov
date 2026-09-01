import Link from "next/link";

import { LeadRow } from "@/components/lead-list";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  Stat,
  Tag,
} from "@/components/ui";
import { getStore } from "@/lib/db";
import { formatDate, isWithinDays, markdownLede } from "@/lib/format";
import { DIRECTION_META, isOpen } from "@/lib/status";

export const dynamic = "force-dynamic";

const WON_WINDOW_DAYS = 30;
const RECENT_LEADS = 6;

export default async function DashboardPage() {
  const store = getStore();
  const [people, leads, news, channels] = await Promise.all([
    store.listPeople(),
    store.listLeads(),
    store.listNews(3),
    store.listChannels(),
  ]);

  const peopleById = new Map(people.map((p) => [p.id, p]));

  const open = leads.filter((l) => isOpen(l.status));
  const unclaimed = leads.filter((l) => l.status === "new");
  const wonRecently = leads.filter(
    (l) => l.status === "won" && isWithinDays(l.createdAt, WON_WINDOW_DAYS),
  );
  const forSales = open.filter((l) => l.direction === "for_sales");
  const forConsultants = open.filter((l) => l.direction === "for_consultant");

  return (
    <>
      <PageHeader
        eyebrow="Quinta · Internal"
        title="Lead Hub"
        lede="Sales and consultants pass leads to each other here. Post one, claim one, and close it out so the person who found it hears how it went."
        action={<ButtonLink href="/leads/new">Post a lead</ButtonLink>}
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Open"
          value={open.length}
          hint="Not yet won or lost"
        />
        <Stat
          label="Unclaimed"
          value={unclaimed.length}
          hint="Nobody has picked these up"
        />
        <Stat
          label="For sales"
          value={forSales.length}
          hint="Raised by consultants"
        />
        <Stat
          label="For consultants"
          value={forConsultants.length}
          hint="Raised by sales"
        />
      </section>

      <div className="mt-14 grid gap-12 lg:grid-cols-[1.6fr_1fr]">
        <section>
          <SectionHeading
            action={
              <Link
                href="/leads"
                className="text-sm font-bold underline decoration-1 underline-offset-4 hover:no-underline"
              >
                All leads
              </Link>
            }
          >
            Recent leads
          </SectionHeading>

          {leads.length === 0 ? (
            <EmptyState
              title="No leads yet"
              hint="The first one sets the tone. Post a hotel you have spoken to and let the other side pick it up."
              action={<ButtonLink href="/leads/new">Post a lead</ButtonLink>}
            />
          ) : (
            <div>
              {leads.slice(0, RECENT_LEADS).map((lead) => (
                <LeadRow key={lead.id} lead={lead} peopleById={peopleById} />
              ))}
            </div>
          )}
        </section>

        <div className="space-y-12">
          <section>
            <SectionHeading
              action={
                <Link
                  href="/news"
                  className="text-sm font-bold underline decoration-1 underline-offset-4 hover:no-underline"
                >
                  All news
                </Link>
              }
            >
              Quinta news
            </SectionHeading>

            {news.length === 0 ? (
              <EmptyState title="Nothing posted yet" />
            ) : (
              <div className="space-y-4">
                {news.map((item) => (
                  <Card key={item.id} className="p-5">
                    <div className="flex items-center gap-2">
                      {item.category ? <Tag>{item.category}</Tag> : null}
                      {item.pinned ? <Tag>Pinned</Tag> : null}
                    </div>
                    <h3 className="mt-3 text-base leading-snug">
                      <Link
                        href={`/news/${item.slug}`}
                        className="hover:underline"
                      >
                        {item.title}
                      </Link>
                    </h3>
                    <p className="mt-2 text-sm text-muted">
                      {item.excerpt ?? markdownLede(item.body, 120)}
                    </p>
                    <p className="mt-3 text-xs text-muted">
                      {formatDate(item.publishedAt)}
                    </p>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading>Channels</SectionHeading>
            <div className="space-y-2">
              {channels.map((channel) => (
                <Link
                  key={channel.id}
                  href={`/chat/${channel.slug}`}
                  className="block rounded-xl border border-line px-5 py-4 hover:bg-surface"
                >
                  <p className="font-heading text-sm font-bold">
                    {channel.name}
                  </p>
                  {channel.description ? (
                    <p className="mt-1 text-xs text-muted">
                      {channel.description}
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading>Won recently</SectionHeading>
            <Card className="p-5">
              <p className="font-heading text-3xl font-bold tabular-nums">
                {wonRecently.length}
              </p>
              <p className="mt-1 text-xs text-muted">
                Leads marked won in the last {WON_WINDOW_DAYS} days. Closing
                them out is what makes {DIRECTION_META.for_sales.label.toLowerCase()} leads
                worth raising.
              </p>
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
