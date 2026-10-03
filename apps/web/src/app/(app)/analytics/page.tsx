import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Analytics" };

export default function Page() {
  return <ScreenPlaceholder href="/analytics" />;
}
