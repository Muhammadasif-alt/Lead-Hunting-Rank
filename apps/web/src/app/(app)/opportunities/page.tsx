import type { Metadata } from "next";
import { Opportunities } from "./Opportunities";

export const metadata: Metadata = { title: "Opportunities" };

export default function Page() {
  return <Opportunities />;
}
