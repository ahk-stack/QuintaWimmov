import { NewsForm } from "@/components/news-form";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "Write a post" };

export default async function NewNewsPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="News"
        title="Write a post"
        lede="Goes to everyone. Use it for things that would otherwise scroll away in chat."
      />
      <NewsForm />
    </div>
  );
}
