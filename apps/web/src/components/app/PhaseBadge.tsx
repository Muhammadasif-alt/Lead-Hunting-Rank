import { CURRENT_PHASE } from "@/lib/screens";

/** Shows whether a screen is live or which roadmap phase will make it real. */
export function PhaseBadge({ phase }: { phase: number | null }) {
  if (phase === null || phase <= CURRENT_PHASE) {
    return (
      <span className="badge border-brand/30 bg-brand-soft text-brand">
        <span className="size-1.5 rounded-full bg-brand" />
        Live
      </span>
    );
  }
  return <span className="badge">Phase {phase}</span>;
}
