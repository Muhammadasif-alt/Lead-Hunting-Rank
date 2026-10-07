import type { Metadata } from "next";
import { Campaigns } from "./Campaigns";

export const metadata: Metadata = { title: "Campaigns" };

export default function Page() {
  return <Campaigns />;
}
