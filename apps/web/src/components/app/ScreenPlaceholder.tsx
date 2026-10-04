import Link from "next/link";
import { ArrowRight, Check, CircleDashed } from "lucide-react";
import { CURRENT_PHASE, findScreen } from "@/lib/screens";
import { PageHeader } from "./PageHeader";

/**
 * Honest empty state for a screen whose backend isn't built yet (docs/17 §2: no fake dashboards).
 * Explains what the screen will do and when it arrives.
 */
export function ScreenPlaceholder({ href }: { href: string }) {
  const screen = findScreen(href);
  const Icon = screen.icon;
  const phasesAway = screen.phase === null ? 0 : screen.phase - CURRENT_PHASE;

  return (
    <div data-tone={screen.tone} className="space-y-8">
      <PageHeader screen={screen} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="card relative overflow-hidden p-8">
          <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-tone/10 blur-3xl" />
          <div className="relative">
            <div className="grid size-12 place-items-center rounded-2xl border border-tone/20 bg-tone-soft">
              <Icon className="size-6 text-tone" />
            </div>
            <h2 className="mt-6 text-lg font-semibold tracking-tight">Nothing here yet — by design</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
              This screen will show real data once its engine is built in <span className="text-fg">Phase {screen.phase}</span>
              {phasesAway > 0 && <> ({phasesAway} phase{phasesAway === 1 ? "" : "s"} away)</>}. We don&apos;t show placeholder
              numbers — every metric here will come from actual activity.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/diagnostics" className="btn btn-secondary">
                Check system health
              </Link>
              <Link href="/dashboard" className="btn btn-ghost">
                Build progress <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h3 className="text-sm font-semibold">What this screen will do</h3>
          <ul className="mt-4 space-y-3">
            {screen.capabilities.map((c) => (
              <li key={c} className="flex gap-3 text-sm text-muted">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-tone-soft">
                  <Check className="size-3 text-tone" />
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
          {screen.spec && (
            <div className="mt-6 flex items-center gap-2 border-t border-line pt-4 text-xs text-faint">
              <CircleDashed className="size-3.5" />
              Behaviour spec: <code className="font-mono text-muted">docs/screens/{screen.spec}</code>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
