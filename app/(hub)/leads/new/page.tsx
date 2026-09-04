import { LeadForm } from "@/components/lead-form";
import { PageHeader } from "@/components/ui";
import { getStore } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = { title: "Post a lead" };

export default async function NewLeadPage() {
  const people = await getStore().listPeople();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Leads"
        title="Post a lead"
        lede="Hand an opportunity to sales, or ask a consultant for help on an account."
      />
      <LeadForm people={people} />
    </div>
  );
}
