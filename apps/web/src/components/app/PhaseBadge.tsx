import { CURRENT_PHASE } from "@/lib/screens";

/** Uses the surrounding area tone (data-tone). Shows whether a screen is live or which roadmap phase will make it real. */
export function PhaseBadge({ phase }: { phase: number | null }) {
  if (phase === null || phase <= CURRENT_PHASE) {
    return (
      <span className="badge border-tone/25 bg-tone-soft text-tone">
        <span className="size-1.5 rounded-full bg-brand" />
        Live
      </span>
    );
  }
  return <span className="badge border-tone/20 text-tone">Phase {phase}</span>;
}
