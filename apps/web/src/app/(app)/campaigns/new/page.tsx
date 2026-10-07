import type { Metadata } from "next";
import { PageHeader } from "@/components/app/PageHeader";
import { findScreen } from "@/lib/screens";
import { CampaignEditor } from "../CampaignEditor";

export const metadata: Metadata = { title: "New campaign" };

export default function Page() {
  return (
    <div className="space-y-6">
      <PageHeader screen={findScreen("/campaigns")} />
      <CampaignEditor />
    </div>
  );
}
