"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Info, Loader, Minus, X } from "lucide-react";
import { METRIC_LEVEL_LABEL, type AnalyticsFilters, type DrillResult, type KpiValue, type RecordRef } from "@revenue-os/shared";
import { api, errorMessage } from "@/lib/api";
import { DIRECTION_STYLE, deltaText, formatUnit, metricDef, num, shortDate, withFilters } from "@/lib/analytics";

// ── context ─────────────────────────────────────────────────────────────────────────────────────

export interface DrillTarget {
  metric: string;
  filters?: Record<string, string>;
}

interface Ctx {
  filters: AnalyticsFilters;
  /** Bumped by "Refresh" so every tab refetches. */
  version: number;
  drill: (t: DrillTarget) => void;
  /** Workspace reporting currency — learned from the first response that carries it (overview / deals), else USD. */
  currency: string;
  setCurrency: (c: string) => void;
}

export const AnalyticsCtx = createContext<Ctx | null>(null);
export function useAnalytics(): Ctx {
  const c = useContext(AnalyticsCtx);
  if (!c) throw new Error("useAnalytics() outside the analytics screen");
  return c;
}

// ── loading / states ────────────────────────────────────────────────────────────────────────────

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
      <Loader className="size-4 animate-spin" /> {text}
    </div>
  );
}

export function Empty({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="card px-4 py-8 text-center text-sm text-muted">
      <p>{text}</p>
      {children}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{text}</p>;
}

/** Fetch `path` (already including filters) and render it; refetches when the path or the refresh version changes. */
export function Loaded<T>({ path, children }: { path: string; children: (data: T, reload: () => void) => ReactNode }) {
  const { version } = useAnalytics();
  const [state, setState] = useState<{ key: string; data?: T; error?: string } | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${path}#${version}#${tick}`;
  useEffect(() => {
    let alive = true;
    api<T>(path)
      .then((data) => alive && setState({ key, data }))
      .catch((err) => alive && setState({ key, error: errorMessage(err) }));
    return () => {
      alive = false;
    };
  }, [path, key]);
  if (!state || state.key !== key) return state?.data !== undefined ? <>{children(state.data, () => setTick((t) => t + 1))}</> : <Loading />;
  if (state.error) return <ErrorBox text={state.error} />;
  return <>{children(state.data as T, () => setTick((t) => t + 1))}</>;
}

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{children}</h2>
        {hint && <p className="text-xs text-faint">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

// ── metric definition popover (screen #10 §52) ─────────────────────────────────────────────────

export function MetricLabel({ metric, label, className = "" }: { metric: string; label?: string; className?: string }) {
  const def = metricDef(metric);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const text = label ?? def?.label ?? metric;
  if (!def) return <span className={className}>{text}</span>;
  return (
    <span ref={ref} className={`relative inline-flex min-w-0 ${className}`}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex min-w-0 items-center gap-1 text-left hover:text-fg" title="What does this mean?">
        <span className="truncate">{text}</span>
        <Info className="size-3 shrink-0 text-faint" aria-hidden />
      </button>
      {open && (
        <span role="dialog" aria-label={`${def.label} definition`} className="card absolute top-full left-0 z-30 mt-1 block w-72 max-w-[calc(100vw-3rem)] space-y-2 p-3 text-left text-xs font-normal text-fg normal-case">
          <span className="block text-[11px] font-semibold tracking-wide text-tone uppercase">{def.label}</span>
          <span className="block">
            <span className="block text-[10px] font-semibold tracking-wide text-faint uppercase">Definition</span>
            {def.definition}
          </span>
          <span className="block">
            <span className="block text-[10px] font-semibold tracking-wide text-faint uppercase">How it is counted</span>
            {def.counted}
          </span>
          <span className="block text-faint">
            {METRIC_LEVEL_LABEL[def.level]} · v{def.version} · changed {shortDate(def.changedAt)} · {def.higherIsBetter ? "higher is better" : "lower is better"}
          </span>
        </span>
      )}
    </span>
  );
}

// ── KPI card ────────────────────────────────────────────────────────────────────────────────────

export function Delta({ k, currency }: { k: KpiValue; currency: string }) {
  const def = metricDef(k.key);
  const text = deltaText(k, def?.unit ?? "COUNT", currency);
  if (!text || !k.direction) return <span className="text-xs text-faint">No comparison</span>;
  const Icon = k.delta! > 0 ? ArrowUp : k.delta! < 0 ? ArrowDown : Minus;
  const word = k.direction === "BETTER" ? "better" : k.direction === "WORSE" ? "worse" : "about flat";
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${DIRECTION_STYLE[k.direction]}`} title={`${word} than the previous period`}>
      <Icon className="size-3" aria-hidden />
      {text}
      <span className="sr-only"> ({word})</span>
    </span>
  );
}

export function KpiCard({ k, currency, hint, big }: { k: KpiValue; currency: string; hint?: ReactNode; big?: boolean }) {
  const { drill } = useAnalytics();
  const def = metricDef(k.key);
  return (
    <div className="card flex min-w-0 flex-col p-3.5">
      <MetricLabel metric={k.key} className="text-xs text-muted" />
      <button type="button" onClick={() => drill({ metric: k.key })} className="group mt-1 flex min-w-0 flex-1 flex-col items-start text-left" aria-label={`${def?.label ?? k.key}: open the records behind this number`}>
        <span className={`font-semibold ${big ? "text-2xl" : "text-xl"} group-hover:text-tone`}>{formatUnit(k.value, def?.unit ?? "COUNT", currency)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Delta k={k} currency={currency} />
          {k.previous != null && <span className="text-[11px] text-faint">prev {formatUnit(k.previous, def?.unit ?? "COUNT", currency)}</span>}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {k.lowSample && k.value != null && <span className="badge h-4 px-1.5 text-[9px]">Low sample</span>}
          {k.partial && <span className="badge h-4 border-amber/30 bg-amber-soft px-1.5 text-[9px] text-amber">Partial — some inputs unknown</span>}
        </span>
        {hint && <span className="mt-1 text-[11px] text-faint">{hint}</span>}
      </button>
    </div>
  );
}

export function KpiRow({ title, rows, currency, hints = {} }: { title: string; rows: KpiValue[]; currency: string; hints?: Record<string, ReactNode> }) {
  if (!rows.length) return null;
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {rows.map((k) => (
          <KpiCard key={k.key} k={k} currency={currency} hint={hints[k.key]} />
        ))}
      </div>
    </section>
  );
}

/** A plain number that still opens its records (no dead-end numbers, §50). */
export function DrillNumber({ metric, filters, children }: { metric: string; filters?: Record<string, string>; children: ReactNode }) {
  const { drill } = useAnalytics();
  return (
    <button type="button" onClick={() => drill({ metric, filters })} className="tabular-nums hover:text-tone hover:underline">
      {children}
    </button>
  );
}

// ── records ─────────────────────────────────────────────────────────────────────────────────────

const RECORD_TYPE_LABEL: Record<RecordRef["type"], string> = {
  COMPANY: "Company",
  OPPORTUNITY: "Deal",
  CONVERSATION: "Conversation",
  CAMPAIGN: "Campaign",
  MEETING: "Meeting",
  MARKET: "Market",
  SIGNAL: "Signal",
};

export function RecordList({ records, limit }: { records: RecordRef[]; limit?: number }) {
  const shown = limit ? records.slice(0, limit) : records;
  if (!records.length) return <p className="text-xs text-muted">No records.</p>;
  return (
    <ul className="divide-y divide-line">
      {shown.map((r) => (
        <li key={`${r.type}-${r.id}`}>
          <Link href={r.href} className="flex items-start gap-2 py-2 text-sm hover:text-tone">
            <span className="badge h-5 shrink-0 text-[10px]">{RECORD_TYPE_LABEL[r.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium break-words">{r.label}</span>
              {r.detail && <span className="block text-xs text-faint break-words">{r.detail}</span>}
            </span>
            <ArrowRight className="mt-1 size-3.5 shrink-0 text-faint" aria-hidden />
          </Link>
        </li>
      ))}
      {limit && records.length > limit && <li className="py-2 text-xs text-faint">+{records.length - limit} more</li>}
    </ul>
  );
}

/** Drill drawer: the records behind a number (screen #10 §50). */
export function DrillDrawer({ target, filters, onClose }: { target: DrillTarget; filters: AnalyticsFilters; onClose: () => void }) {
  const [data, setData] = useState<DrillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const def = metricDef(target.metric);
  useEffect(() => {
    let alive = true;
    api<DrillResult>(withFilters("/analytics/drill", filters, { metric: target.metric, ...target.filters }))
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [target, filters]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" data-tone="insight">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-fg/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Records behind this number" className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <div className="eyebrow text-[11px]">Drill-down</div>
            <h2 className="text-base font-semibold break-words">{data?.label ?? def?.label ?? target.metric}</h2>
            {data && (
              <p className="text-xs text-muted">
                {data.period.label} · {num(data.total)} record{data.total === 1 ? "" : "s"}
                {data.total > data.records.length ? ` · showing ${data.records.length}` : ""}
              </p>
            )}
          </div>
          <button type="button" className="btn btn-ghost h-8 px-2" onClick={onClose} aria-label="Close drill-down">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {def && <p className="mb-3 rounded-lg border border-line bg-raised px-3 py-2 text-xs text-muted">{def.counted}</p>}
          {error ? <ErrorBox text={error} /> : !data ? <Loading /> : data.records.length === 0 ? <p className="text-sm text-muted">No records behind this number in the selected period.</p> : <RecordList records={data.records} />}
        </div>
      </aside>
    </div>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────────────────────────

/** Horizontal scroll stays inside the card — the page never scrolls sideways. */
export function TableCard({ children, caption }: { children: ReactNode; caption?: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return <th className={`border-b border-line bg-raised px-3 py-2 text-[11px] font-semibold tracking-wide whitespace-nowrap text-faint uppercase ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

export function Td({ children, right, className = "" }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <td className={`border-b border-line px-3 py-2 align-top ${right ? "text-right tabular-nums whitespace-nowrap" : ""} ${className}`}>{children}</td>;
}

// ── charts (CSS / HTML; design tokens; table view always available) ─────────────────────────────

/** Horizontal bars for a ranked list (lost reasons, intents, steps…). Single series → no legend. */
export function HBars({ rows, label }: { rows: { key: string; label: string; value: number; display?: string; sub?: string }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-xs text-muted">No data in this period.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
          <span className="truncate text-muted" title={r.label}>
            {r.label}
          </span>
          <span className="h-3 rounded-r-[4px] bg-raised">
            <span className="block h-3 rounded-r-[4px] bg-tone" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} />
          </span>
          <span className="text-right font-medium tabular-nums">
            {r.display ?? r.value.toLocaleString()}
            {r.sub && <span className="ml-1 font-normal text-faint">{r.sub}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface ColumnSeries {
  key: string;
  label: string;
  /** CSS colour (a design token var). */
  color: string;
}

/**
 * Columns over time. One series → plain columns; several → stacked with a 2px surface gap and a legend.
 * Hover / focus shows the exact values in a readout row; a table view sits under the chart.
 */
export function Columns({
  data,
  series,
  format,
  label,
  height = 140,
}: {
  data: { x: string; xLabel: string; values: Record<string, number> }[];
  series: ColumnSeries[];
  format: (n: number) => string;
  label: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0));
  const max = Math.max(0, ...totals);
  const active = hover ?? data.length - 1;
  const cur = data[active];
  if (!data.length) return <p className="text-xs text-muted">No data in this period.</p>;
  return (
    <figure className="min-w-0" aria-label={label}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {series.length > 1 &&
          series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-muted">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        {cur && (
          <span className="ml-auto text-muted" aria-live="polite">
            <span className="text-faint">{cur.xLabel}: </span>
            {series.map((s, i) => (
              <span key={s.key}>
                {i > 0 && " · "}
                {series.length > 1 && `${s.label} `}
                <span className="font-medium text-fg tabular-nums">{format(cur.values[s.key] ?? 0)}</span>
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 top-0 border-t border-line" aria-hidden />
        <span className="absolute top-0.5 left-0 text-[10px] text-faint tabular-nums" aria-hidden>
          {max > 0 ? format(max) : ""}
        </span>
        <div className="absolute inset-0 flex items-end gap-0.5 border-b border-line-strong pt-4" onMouseLeave={() => setHover(null)}>
          {data.map((d, i) => {
            const total = totals[i] ?? 0;
            return (
              <button
                key={d.x}
                type="button"
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-offset-0"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-label={`${d.xLabel}: ${series.map((s) => `${series.length > 1 ? `${s.label} ` : ""}${format(d.values[s.key] ?? 0)}`).join(", ")}`}
              >
                <span className={`flex w-full max-w-6 flex-col-reverse gap-0.5 ${i === active ? "" : "opacity-80"}`} style={{ height: max > 0 ? `${(total / max) * 100}%` : 0 }}>
                  {series.map((s, si) => {
                    const v = d.values[s.key] ?? 0;
                    if (v <= 0) return null;
                    const top = series.slice(si + 1).every((t) => (d.values[t.key] ?? 0) <= 0);
                    return <span key={s.key} className={`block w-full min-h-[2px] ${top ? "rounded-t-[4px]" : ""}`} style={{ flexGrow: v, flexBasis: 0, background: s.color }} />;
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint" aria-hidden>
        <span>{data[0]?.xLabel}</span>
        {data.length > 1 && <span>{data[data.length - 1]?.xLabel}</span>}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-fg">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <Th>Period</Th>
                {series.map((s) => (
                  <Th key={s.key} right>
                    {s.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.x}>
                  <Td>{d.xLabel}</Td>
                  {series.map((s) => (
                    <Td key={s.key} right>
                      {format(d.values[s.key] ?? 0)}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
