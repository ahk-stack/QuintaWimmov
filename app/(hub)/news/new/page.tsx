import { NewsForm } from "@/components/news-form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Write a post" };

export default function NewNewsPage() {
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
