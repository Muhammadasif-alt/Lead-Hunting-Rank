import type { Metadata } from "next";
import { Integrations } from "./Integrations";

export const metadata: Metadata = { title: "Integrations" };

export default function Page() {
  return <Integrations />;
}
