import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Knowledge Base" };

export default function Page() {
  return <ScreenPlaceholder href="/knowledge" />;
}
