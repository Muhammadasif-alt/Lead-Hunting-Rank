import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Opportunities" };

export default function Page() {
  return <ScreenPlaceholder href="/opportunities" />;
}
