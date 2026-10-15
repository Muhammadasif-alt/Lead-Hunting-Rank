import type { Metadata } from "next";
import { Signals } from "./Signals";

export const metadata: Metadata = { title: "Signals" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; marketId?: string }> }) {
  const { tab, marketId } = await searchParams;
  return <Signals tab={tab ?? "today"} marketId={marketId} />;
}
