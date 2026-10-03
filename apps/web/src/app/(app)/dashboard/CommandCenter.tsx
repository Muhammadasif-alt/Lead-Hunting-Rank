"use client";

import Link from "next/link";
import { ArrowRight, Check, RefreshCw, Sparkles } from "lucide-react";
import { HealthList } from "@/components/app/HealthList";
import { PageHeader } from "@/components/app/PageHeader";
import { ROADMAP, CURRENT_PHASE } from "@/lib/roadmap";
import { findScreen, SCREENS } from "@/lib/screens";
import { useSystemHealth } from "@/lib/use-system-health";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Until the subsystems it aggregates exist (Phase 19), the Command Center shows only real things:
 * live system health, build progress and what unlocks next. No placeholder metrics.
 */
export function CommandCenter() {
  const { rows, allUp, loading, refresh } = useSystemHealth();
  const done = ROADMAP.filter((p) => p.done).length;
  const pct = Math.round((done / ROADMAP.length) * 100);
  const next = ROADMAP.filter((p) => !p.done).slice(0, 4);
  const upcomingScreens = SCREENS.filter((s) => s.phase !== null && s.phase > CURRENT_PHASE)
    .sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
    .slice(0, 4);

  return (
    <div className="space-y-8">
      <PageHeader screen={findScreen("/dashboard")} />

      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-accent/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 size-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm text-muted">{greeting()}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">The foundation is in place.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Phases 0–{CURRENT_PHASE} are complete. Next up is the database foundation, then authentication — after that
              the Company 360 and Lead Hunter screens start showing real data.
            </p>
          </div>
          <Link href="/lead-hunter" className="btn btn-primary btn-lg shrink-0">
            <Sparkles className="size-4" /> Preview Lead Hunter
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Build progress */}
        <section className="card p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold">Build progress</h3>
              <p className="mt-1 text-xs text-muted">Dependency-ordered roadmap · docs/PROGRESS.md</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-semibold tabular-nums tracking-tight">{pct}%</div>
              <div className="text-xs text-faint">
                {done} of {ROADMAP.length} phases
              </div>
            </div>
          </div>
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-gradient-to-r from-brand to-accent" style={{ width: `${pct}%` }} />
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-faint">Completed</div>
              <ul className="mt-3 space-y-2.5">
                {ROADMAP.filter((p) => p.done).map((p) => (
                  <li key={p.phase} className="flex items-center gap-2.5 text-sm">
                    <span className="grid size-5 place-items-center rounded-full bg-brand-soft">
                      <Check className="size-3 text-brand" />
                    </span>
                    <span className="text-faint tabular-nums">{p.phase}</span>
                    {p.name}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-faint">Up next</div>
              <ul className="mt-3 space-y-2.5">
                {next.map((p, i) => (
                  <li key={p.phase} className="flex items-center gap-2.5 text-sm text-muted">
                    <span
                      className={`size-5 rounded-full border ${i === 0 ? "border-accent bg-accent-soft" : "border-line-strong"}`}
                    />
                    <span className="text-faint tabular-nums">{p.phase}</span>
                    <span className={i === 0 ? "text-fg" : ""}>{p.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* System health */}
        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">System health</h3>
            <button type="button" onClick={() => void refresh()} className="btn btn-ghost h-7 px-2" aria-label="Re-check">
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div
            className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
              loading ? "bg-raised text-muted" : allUp ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"
            }`}
          >
            {loading ? "Checking…" : allUp ? "All systems operational" : "Some services are down"}
          </div>
          <div className="mt-2">
            <HealthList rows={rows} loading={loading} compact />
          </div>
          <Link href="/diagnostics" className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            Details <ArrowRight className="size-3" />
          </Link>
        </section>
      </div>

      {/* Screens unlocking next */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-sm font-semibold">Screens unlocking next</h3>
            <p className="mt-1 text-xs text-muted">Each screen goes live when its engine is built.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {upcomingScreens.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.href} href={s.href} className="card group p-5 transition-colors hover:border-line-strong">
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-muted group-hover:text-brand" />
                  <span className="badge">Phase {s.phase}</span>
                </div>
                <div className="mt-4 text-sm font-medium">{s.title}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{s.summary}</p>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
