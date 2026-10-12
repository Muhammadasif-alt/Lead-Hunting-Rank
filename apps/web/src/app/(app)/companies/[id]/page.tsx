import type { Metadata } from "next";
import { Company360 } from "./Company360";

export const metadata: Metadata = { title: "Company 360°" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  return <Company360 id={id} initialTab={tab} />;
}
