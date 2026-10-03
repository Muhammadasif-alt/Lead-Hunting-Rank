import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Experiments" };

export default function Page() {
  return <ScreenPlaceholder href="/experiments" />;
}
