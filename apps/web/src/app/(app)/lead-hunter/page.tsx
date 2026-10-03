import type { Metadata } from "next";
import { LeadHunter } from "./LeadHunter";

export const metadata: Metadata = { title: "Lead Hunter" };

export default function Page() {
  return <LeadHunter />;
}
