import type { Metadata } from "next";
import { CampaignView } from "./CampaignView";

export const metadata: Metadata = { title: "Campaign" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignView id={id} />;
}
