import type { Metadata } from "next";
import { Unsubscribe } from "./Unsubscribe";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

/** Public page (no session): where a browser lands from an email's unsubscribe link. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-16">
      <Unsubscribe token={token} />
    </main>
  );
}
