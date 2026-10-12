import type { Metadata } from "next";
import { Memory } from "./Memory";

export const metadata: Metadata = { title: "AI Memory" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const { tab, status } = await searchParams;
  return <Memory tab={tab ?? "overview"} status={status} />;
}
