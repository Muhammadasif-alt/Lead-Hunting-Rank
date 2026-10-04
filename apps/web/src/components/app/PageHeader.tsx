import type { ReactNode } from "react";
import { TONES, type Screen } from "@/lib/screens";
import { PhaseBadge } from "./PhaseBadge";

export function PageHeader({ screen, actions }: { screen: Screen; actions?: ReactNode }) {
  const Icon = screen.icon;
  return (
    <div
      data-tone={screen.tone}
      className="relative flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between"
    >
      {/* tone segment on the header rule */}
      <span aria-hidden="true" className="absolute -bottom-px left-0 h-0.5 w-16 rounded-full bg-tone" />
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-tone/20 bg-tone-soft">
          <Icon className="size-5 text-tone" />
        </div>
        <div>
          <div className="eyebrow mb-1 text-[11px]">
            {TONES[screen.tone].label} · {screen.group}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{screen.title}</h1>
            <PhaseBadge phase={screen.phase} />
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{screen.summary}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
