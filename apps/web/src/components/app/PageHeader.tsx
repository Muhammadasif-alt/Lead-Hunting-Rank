import type { ReactNode } from "react";
import type { Screen } from "@/lib/screens";
import { PhaseBadge } from "./PhaseBadge";

export function PageHeader({ screen, actions }: { screen: Screen; actions?: ReactNode }) {
  const Icon = screen.icon;
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-raised">
          <Icon className="size-5 text-brand" />
        </div>
        <div>
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
