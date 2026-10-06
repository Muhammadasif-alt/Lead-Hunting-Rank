import type { Metadata } from "next";
import { CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { findScreen } from "@/lib/screens";
import { Suppressions } from "./Suppressions";

export const metadata: Metadata = { title: "Settings" };

const LATER = [
  "Workspace profile, time zone and sending identity",
  "Queues, backups, imports and exports",
  "Feature flags and developer settings",
];

/** Settings (screen #18). The do-not-contact list is live from Phase 10; the rest arrives with Phase 22. */
export default function Page() {
  const screen = findScreen("/settings");
  return (
    <div className="space-y-8">
      <PageHeader screen={screen} />
      <Suppressions />
      <section className="card p-5 text-sm">
        <h3 className="flex items-center gap-2 font-semibold">
          <CircleDashed className="size-4 text-tone" /> More settings — Phase {screen.phase}
        </h3>
        <ul className="mt-2 list-inside list-disc space-y-1 text-muted">
          {LATER.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-faint">
          Sending hours, daily limits and autonomy live in the AI Control Center.
        </p>
      </section>
    </div>
  );
}
