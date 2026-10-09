import type { Metadata } from "next";
import { MeetingView } from "./MeetingView";

export const metadata: Metadata = { title: "Meeting" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingView id={id} />;
}
