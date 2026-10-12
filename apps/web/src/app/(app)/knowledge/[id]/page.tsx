import type { Metadata } from "next";
import { ItemView } from "./ItemView";

export const metadata: Metadata = { title: "Knowledge item" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemView id={id} />;
}
