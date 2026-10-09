import type { Metadata } from "next";
import { OpportunityView } from "./OpportunityView";

export const metadata: Metadata = { title: "Opportunity" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityView id={id} />;
}
