import type { Metadata } from "next";
import { filtersFromParams, isTab } from "@/lib/analytics";
import { Analytics } from "./Analytics";

export const metadata: Metadata = { title: "Analytics" };

type Params = { tab?: string; range?: string; from?: string; to?: string; marketId?: string; industry?: string; campaignId?: string; ownerId?: string };

export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  return <Analytics tab={isTab(p.tab) ? p.tab : "overview"} filters={filtersFromParams(p)} />;
}
