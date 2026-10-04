import type { Metadata } from "next";
import { Duplicates } from "./Duplicates";

export const metadata: Metadata = { title: "Duplicate review" };

export default function Page() {
  return <Duplicates />;
}
