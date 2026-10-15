import type { Metadata } from "next";
import { SignalView } from "./SignalView";

export const metadata: Metadata = { title: "Signal" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SignalView id={id} />;
}
