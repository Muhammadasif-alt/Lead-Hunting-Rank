import type { Metadata } from "next";
import { Companies } from "./Companies";

export const metadata: Metadata = { title: "Companies" };

export default function Page() {
  return <Companies />;
}
