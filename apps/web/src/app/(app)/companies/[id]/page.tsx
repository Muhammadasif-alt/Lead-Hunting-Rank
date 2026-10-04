import type { Metadata } from "next";
import { Company360 } from "./Company360";

export const metadata: Metadata = { title: "Company 360°" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Company360 id={id} />;
}
