import { redirect } from "next/navigation";

import { EmptyState, PageHeader } from "@/components/ui";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

/*
 * /chat has no content of its own: it sends you to the first channel. Keeping
 * the redirect server-side means no flash of an empty shell.
 */
export default async function ChatIndexPage() {
  const channels = await getStore().listChannels();

  if (channels.length > 0) {
    redirect(`/chat/${channels[0].slug}`);
  }

  return (
    <>
      <PageHeader title="Chat" lede="Channels for sales and consultants." />
      <EmptyState
        title="No channels yet"
        hint="Channels are seeded with the database. If you are seeing this, the seed migration has not run."
      />
    </>
  );
}
