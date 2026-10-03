import type { Metadata } from "next";
import { ScreenPlaceholder } from "@/components/app/ScreenPlaceholder";

export const metadata: Metadata = { title: "Team & Roles" };

export default function Page() {
  return <ScreenPlaceholder href="/team" />;
}
