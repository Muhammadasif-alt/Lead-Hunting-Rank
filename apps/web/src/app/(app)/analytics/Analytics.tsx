"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, CircleAlert, CircleCheck, Loader, RefreshCw, TriangleAlert, X } from "lucide-react";
import { RANGE_LABEL, RANGES, type AnalyticsFilters, type AnalyticsViewRow, type FreshnessRow, type PermissionKey, type RangeKey } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import { ANALYTICS_TAB_LABEL, ANALYTICS_TABS, ago, filterQuery, filtersFromParams, isTab, type AnalyticsTab } from "@/lib/analytics";
import type { CampaignRow } from "@/lib/campaigns";
import type { MarketRow } from "@/lib/discovery";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { AskTab } from "./ask";
import { AttributionTab } from "./attribution";
import { AiTab, CostsTab, MarketsTab, OutreachTab } from "./more";
import { OverviewTab, PipelineTab } from "./overview";
import { AnalyticsCtx, DrillDrawer, Empty, type DrillTarget } from "./parts";

/**
 * Analytics + revenue intelligence (screen #10, Phase 17): business outcomes first, every number drillable to records,
 * stale data labelled stale, unknown cost stays unknown. Filters live in the URL so a view can be shared or saved.
 */
export function Analytics({ tab, filters: initial }: { tab: AnalyticsTab; filters: AnalyticsFilters }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canCosts = can("analytics.costs");
  const router = useRouter();
  const fq = filterQuery(initial);
  const filters = useMemo(() => filtersFromParams(Object.fromEntries(new URLSearchParams(fq))), [fq]);
  const [version, setVersion] = useState(0);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current: AnalyticsTab = tab === "costs" && !canCosts ? "overview" : tab;

  const go = useCallback(
    (t: AnalyticsTab, f: AnalyticsFilters = filters) => {
      const qs = filterQuery(f, { tab: t === "overview" ? undefined : t }, true);
      router.push(qs ? `/analytics?${qs}` : "/analytics", { scroll: false });
    },
    [filters, router],
  );

  const [currency, setCurrency] = useState("USD");
  const ctx = useMemo(() => ({ filters, version, drill: (t: DrillTarget) => setDrill(t), currency, setCurrency }), [filters, version, currency]);
  const closeDrill = useCallback(() => setDrill(null), []);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      await post("/analytics/refresh");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
      setVersion((v) => v + 1);
    }
  }

  const screen = findScreen("/analytics");
  if (!can("analytics.read"))
    return (
      <div className="space-y-5" data-tone="insight">
        <PageHeader screen={screen} />
        <Empty text="You don’t have permission to view analytics." />
      </div>
    );

  const tabs = ANALYTICS_TABS.filter((t) => t !== "costs" || canCosts);

  return (
    <AnalyticsCtx.Provider value={ctx}>
      <div className="space-y-5" data-tone="insight">
        <PageHeader
          screen={screen}
          actions={
            <div className="flex flex-wrap gap-2">
              <SavedViews tab={current} filters={filters} onApply={(v) => go(isTab(v.tab) ? v.tab : "overview", filtersFromParams(v.filters as unknown as Record<string, string>))} />
              <button type="button" className="btn btn-secondary" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
          }
        />

        <FilterBar filters={filters} onChange={(f) => go(current, f)} />
        <DataStatus version={version} />

        <div role="tablist" aria-label="Analytics sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={current === t}
              onClick={() => go(t)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${current === t ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
            >
              {ANALYTICS_TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {error && (
          <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        <div className="min-w-0">
          {current === "attribution" ? (
            <AttributionTab />
          ) : current === "pipeline" ? (
            <PipelineTab />
          ) : current === "outreach" ? (
            <OutreachTab />
          ) : current === "markets" ? (
            <MarketsTab canCosts={canCosts} />
          ) : current === "costs" ? (
            <CostsTab />
          ) : current === "ai" ? (
            <AiTab />
          ) : current === "ask" ? (
            <AskTab />
          ) : (
            <OverviewTab canCosts={canCosts} />
          )}
        </div>
      </div>
      {drill && <DrillDrawer target={drill} filters={filters} onClose={closeDrill} />}
    </AnalyticsCtx.Provider>
  );
}

// ── global filters ──────────────────────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }: { filters: AnalyticsFilters; onChange: (f: AnalyticsFilters) => void }) {
  const [markets, setMarkets] = useState<{ id: string; name: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([]);
  const [industry, setIndustry] = useState(filters.industry ?? "");
  useEffect(() => setIndustry(filters.industry ?? ""), [filters.industry]);
  useEffect(() => {
    api<{ items: MarketRow[] }>("/markets")
      .then((r) => setMarkets(r.items.map((m) => ({ id: m.id, name: m.name }))))
      .catch(() => setMarkets([]));
    api<CampaignRow[]>("/campaigns")
      .then((r) => setCampaigns(r.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCampaigns([]));
  }, []);
  const set = (patch: Partial<AnalyticsFilters>) => onChange({ ...filters, ...patch });
  const any = filters.range !== "30d" || filters.marketId || filters.industry || filters.campaignId || filters.ownerId;
  const commitIndustry = (e?: FormEvent) => {
    e?.preventDefault();
    if ((filters.industry ?? "") !== industry.trim()) set({ industry: industry.trim() || undefined });
  };

  return (
    <div className="card flex flex-wrap items-end gap-2 p-3">
      <label className="min-w-0 flex-1 basis-36">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">Period</span>
        <select className="input" value={filters.range} onChange={(e) => set({ range: e.target.value as RangeKey, from: undefined, to: undefined })}>
          {RANGES.map((r) => (
            <option key={r} value={r}>
              {RANGE_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      {filters.range === "custom" && (
        <>
          <label className="min-w-0 flex-1 basis-32">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">From</span>
            <input type="date" className="input" value={filters.from ?? ""} max={filters.to} onChange={(e) => set({ from: e.target.value || undefined })} />
          </label>
          <label className="min-w-0 flex-1 basis-32">
            <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">To</span>
            <input type="date" className="input" value={filters.to ?? ""} min={filters.from} onChange={(e) => set({ to: e.target.value || undefined })} />
          </label>
        </>
      )}
      <label className="min-w-0 flex-1 basis-36">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">Market</span>
        <select className="input" value={filters.marketId ?? ""} onChange={(e) => set({ marketId: e.target.value || undefined })}>
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <form className="min-w-0 flex-1 basis-36" onSubmit={commitIndustry}>
        <label>
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">Industry</span>
          <input className="input" value={industry} placeholder="All industries" onChange={(e) => setIndustry(e.target.value)} onBlur={() => commitIndustry()} />
        </label>
      </form>
      <label className="min-w-0 flex-1 basis-36">
        <span className="mb-1 block text-[11px] font-semibold tracking-wide text-faint uppercase">Campaign</span>
        <select className="input" value={filters.campaignId ?? ""} onChange={(e) => set({ campaignId: e.target.value || undefined })}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex w-full flex-wrap items-center justify-between gap-2 pt-1 text-xs text-faint sm:w-auto sm:flex-1 sm:basis-full">
        <span>Compared with the previous period of the same length.{filters.ownerId ? " · Filtered to one owner." : ""}</span>
        {any && (
          <button type="button" className="btn btn-ghost h-7 px-2 text-xs" onClick={() => onChange({ range: "30d" })}>
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

// ── data status (screen #10 §51) ────────────────────────────────────────────────────────────────

const FRESH_STYLE: Record<FreshnessRow["state"], string> = {
  CURRENT: "border-brand/30 bg-brand-soft text-brand",
  DELAYED: "border-amber/30 bg-amber-soft text-amber",
  STALE: "border-danger/30 bg-danger-soft text-danger",
  NOT_CONNECTED: "text-faint",
};
const FRESH_WORD: Record<FreshnessRow["state"], string> = { CURRENT: "Current", DELAYED: "Delayed", STALE: "Stale", NOT_CONNECTED: "Not connected" };

function DataStatus({ version }: { version: number }) {
  const [rows, setRows] = useState<FreshnessRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<FreshnessRow[]>("/analytics/freshness")
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [version]);
  if (error) return <p className="text-xs text-danger">Data status unavailable: {error}</p>;
  if (!rows) return null;
  const late = rows.filter((r) => r.state === "DELAYED" || r.state === "STALE");
  return (
    <section aria-label="Data status" className="space-y-2">
      {late.map((r) => (
        <div key={r.source} className={`card flex items-start gap-2 px-3 py-2 text-sm ${r.state === "STALE" ? "border-danger/30 bg-danger-soft text-danger" : "border-amber/30 bg-amber-soft text-amber"}`}>
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold">
              {r.label} {r.state === "STALE" ? "data is stale" : "sync delayed"}
            </span>
            <span className="text-fg/80"> — last update {ago(r.lastAt)}. {r.detail} Numbers that depend on it may be behind.</span>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold tracking-wide text-faint uppercase">Data status</span>
        {rows.map((r) => (
          <span key={r.source} className={`badge ${FRESH_STYLE[r.state]}`} title={`${r.detail} · last ${ago(r.lastAt)}`}>
            {r.state === "CURRENT" ? <CircleCheck className="size-3" aria-hidden /> : r.state === "NOT_CONNECTED" ? null : <TriangleAlert className="size-3" aria-hidden />}
            {r.label}: {r.state === "CURRENT" ? ago(r.lastAt) : FRESH_WORD[r.state]}
          </span>
        ))}
      </div>
    </section>
  );
}

// ── saved views (screen #10 §53) ────────────────────────────────────────────────────────────────

function SavedViews({ tab, filters, onApply }: { tab: AnalyticsTab; filters: AnalyticsFilters; onApply: (v: AnalyticsViewRow) => void }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<AnalyticsViewRow[] | null>(null);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setViews(await api<AnalyticsViewRow[]>("/analytics/views"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    if (open && !views) void load();
  }, [open, views, load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await act(() => post("/analytics/views", { name: name.trim(), tab, filters, shared }))) {
      setName("");
      setShared(false);
    }
  }

  return (
    <div className="relative">
      <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Bookmark className="size-4" /> Saved views
      </button>
      {open && (
        <div className="card absolute top-full left-0 z-30 sm:right-0 sm:left-auto mt-2 w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3 text-sm" role="dialog" aria-label="Saved views">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Saved views</span>
            <button type="button" className="btn btn-ghost h-7 px-2" onClick={() => setOpen(false)} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          {!views ? (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader className="size-3.5 animate-spin" /> Loading…
            </p>
          ) : views.length === 0 ? (
            <p className="text-xs text-muted">No saved views yet.</p>
          ) : (
            <ul className="max-h-60 divide-y divide-line overflow-y-auto">
              {views.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-1.5">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left hover:text-tone"
                    onClick={() => {
                      setOpen(false);
                      onApply(v);
                    }}
                  >
                    <span className="block truncate font-medium">{v.name}</span>
                    <span className="block truncate text-xs text-faint">
                      {isTab(v.tab) ? ANALYTICS_TAB_LABEL[v.tab] : v.tab} · {RANGE_LABEL[v.filters.range] ?? v.filters.range}
                      {v.shared ? " · shared" : ""}
                      {v.mine ? "" : " · by a teammate"}
                    </span>
                  </button>
                  {v.mine && (
                    <button type="button" className="btn btn-ghost h-7 px-2" disabled={busy} aria-label={`Delete view ${v.name}`} onClick={() => void act(() => post(`/analytics/views/${v.id}/delete`))}>
                      <X className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => void save(e)} className="space-y-2 border-t border-line pt-3">
            <label className="block text-xs text-muted">
              Save this tab and filters as
              <input className="input mt-1" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Austin — last 90 days" />
            </label>
            <div className="flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with workspace
              </label>
              <button type="submit" className="btn btn-primary h-8 px-3" disabled={busy || !name.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
