import type { Metadata } from "next";
import { Meetings } from "./Meetings";

export const metadata: Metadata = { title: "Meetings" };

export default function Page() {
  return <Meetings />;
}
