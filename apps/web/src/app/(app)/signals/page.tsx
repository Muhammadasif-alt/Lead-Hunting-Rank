import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Signals" };

export default function Page() {
  return <ScreenPlaceholder href="/signals" />;
}
