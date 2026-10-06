import type { Metadata } from "next";
import { AiControl } from "./AiControl";

export const metadata: Metadata = { title: "AI Control Center" };

export default function Page() {
  return <AiControl />;
}
