import { LeadForm } from "@/components/lead-form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "Post a lead" };

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow="Leads"
        title="Post a lead"
        lede="Hand an opportunity to sales, or ask a consultant for help on an account."
      />
      <LeadForm />
    </div>
  );
}
