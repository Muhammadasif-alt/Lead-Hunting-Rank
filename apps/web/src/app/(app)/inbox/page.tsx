import type { Metadata } from "next";
import { Inbox } from "./Inbox";

export const metadata: Metadata = { title: "AI Inbox" };

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const { c } = await searchParams;
  const id = typeof c === "string" && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  return <Inbox initialId={id} />;
}
