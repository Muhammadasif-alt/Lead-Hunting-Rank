import type { Metadata } from "next";
import { Knowledge } from "./Knowledge";

export const metadata: Metadata = { title: "Knowledge Base" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <Knowledge tab={tab ?? "overview"} />;
}
