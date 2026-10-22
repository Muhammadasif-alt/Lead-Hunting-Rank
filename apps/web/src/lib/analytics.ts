import { METRICS, RANGES, type AnalyticsFilters, type KpiValue, type MetricDefinition, type MetricUnit, type RangeKey } from "@revenue-os/shared";

/** Analytics tabs (screen #10). `costs` is only shown with analytics.costs. */
export const ANALYTICS_TABS = ["overview", "attribution", "pipeline", "outreach", "markets", "costs", "ai", "ask"] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
export const ANALYTICS_TAB_LABEL: Record<AnalyticsTab, string> = {
  overview: "Overview",
  attribution: "Attribution",
  pipeline: "Pipeline",
  outreach: "Outreach",
  markets: "Markets & sources",
  costs: "Costs",
  ai: "AI vs human",
  ask: "Ask",
};

export const isTab = (t: string | undefined): t is AnalyticsTab => !!t && (ANALYTICS_TABS as readonly string[]).includes(t);

const FILTER_KEYS = ["from", "to", "marketId", "industry", "campaignId", "ownerId"] as const;

/** URL search params → filters (unknown range falls back to 30 days). */
export function filtersFromParams(p: Record<string, string | undefined>): AnalyticsFilters {
  const range = (RANGES as readonly string[]).includes(p.range ?? "") ? (p.range as RangeKey) : "30d";
  const f: AnalyticsFilters = { range };
  for (const k of FILTER_KEYS) {
    const v = p[k]?.trim();
    if (!v) continue;
    if ((k === "from" || k === "to") && range !== "custom") continue;
    f[k] = v;
  }
  return f;
}

/** Filters → query string (no leading "?"). Default range is omitted only when `omitDefault`. */
export function filterQuery(f: AnalyticsFilters, extra: Record<string, string | undefined> = {}, omitDefault = false): string {
  const q = new URLSearchParams();
  if (!(omitDefault && f.range === "30d")) q.set("range", f.range);
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (!v) continue;
    if ((k === "from" || k === "to") && f.range !== "custom") continue;
    q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
  return q.toString();
}

/** `/analytics/<path>?<filters>` for API calls. */
export function withFilters(path: string, f: AnalyticsFilters, extra: Record<string, string | undefined> = {}): string {
  const qs = filterQuery(f, extra);
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

/** Minor units → money. Null / undefined is unknown → "—" (never 0). */
export function money(minor: number | null | undefined, currency = "USD", compact = false): string {
  if (minor == null || Number.isNaN(minor)) return "—";
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: compact && Math.abs(major) >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: compact ? (Math.abs(major) >= 10_000 ? 1 : 0) : minor % 100 ? 2 : 0,
    }).format(major);
  } catch {
    return `${major.toLocaleString()} ${currency}`;
  }
}

export const num = (n: number | null | undefined): string => (n == null ? "—" : n.toLocaleString());

/** Percent values are 0–100 (same scale as funnel conversion and deltaPct). */
export const pct = (n: number | null | undefined, digits = 1): string => (n == null ? "—" : `${Number(n.toFixed(digits))}%`);

export function formatUnit(value: number | null, unit: MetricUnit, currency: string): string {
  if (value == null) return "—";
  switch (unit) {
    case "MONEY":
      return money(value, currency, true);
    case "PERCENT":
      return pct(value);
    case "DAYS":
      return `${Number(value.toFixed(1))} d`;
    case "HOURS":
      return `${Number(value.toFixed(1))} h`;
    default:
      return value.toLocaleString();
  }
}

export function metricDef(key: string): MetricDefinition | null {
  return (METRICS as Record<string, MetricDefinition>)[key] ?? null;
}

/** Delta colour follows the metric's direction (better / worse), never the sign. */
export const DIRECTION_STYLE: Record<NonNullable<KpiValue["direction"]>, string> = {
  BETTER: "text-brand",
  WORSE: "text-danger",
  FLAT: "text-muted",
};

export function deltaText(k: KpiValue, unit: MetricUnit, currency: string): string | null {
  if (k.delta == null) return null;
  const sign = k.delta > 0 ? "+" : k.delta < 0 ? "−" : "±";
  if (k.deltaPct != null) return `${sign}${Math.abs(k.deltaPct)}%`;
  const abs = Math.abs(k.delta);
  return `${sign}${unit === "MONEY" ? money(abs, currency, true) : unit === "PERCENT" ? `${Number(abs.toFixed(1))} pts` : abs.toLocaleString()}`;
}

export const shortDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)} sec ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** Major-unit text ("1,250.50") → minor units, or null when not a positive amount. */
export function toMinor(text: string): number | null {
  const n = Number(text.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
