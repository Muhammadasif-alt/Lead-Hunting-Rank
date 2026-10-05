import type { Metadata } from "next";
import { Mission } from "./Mission";

export const metadata: Metadata = { title: "Hunt" };

const WEBSITE = new Set(["any", "with", "without"]);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { website } = await searchParams;
  const initialWebsite = typeof website === "string" && WEBSITE.has(website) ? website : "any";
  return <Mission id={id} initialWebsite={initialWebsite as "any" | "with" | "without"} />;
}
