"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, CircleAlert, Eye, Lightbulb, Loader, Plug, Radar, Search, Sparkles, X } from "lucide-react";
import {
  RELATIONSHIP_INFO,
  SIGNAL_CATEGORIES,
  SIGNAL_CATEGORY_INFO,
  SIGNAL_STATUS_INFO,
  SIGNAL_STATUSES,
  SIGNAL_TYPE_KEYS,
  SIGNAL_TYPES,
  type Level,
  type MarketMonitorRow,
  type PermissionKey,
  type Relationship,
  type SignalAnalytics,
  type SignalCategory,
  type SignalFunnel,
  type SignalListQuery,
  type SignalOverview,
  type SignalRow,
  type SignalSearchResult,
  type SignalSourceStatus,
  type SignalStrengthKey,
} from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import type { MarketRow } from "@/lib/discovery";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { listQueryString, timeAgo, type MarketRef } from "@/lib/signals";
import { RulesTab, WatchlistsTab } from "./manage";
import { Empty, ErrorBox, Loaded, Loading, SignalList } from "./parts";



/**
 * Buying signals + intent (screen #9, Phase 16): evidence of CHANGE, not proof of intent. Facts and interpretation stay
 * apart; a signal never sends anything — outreach still goes through campaigns and policy.
 */
export function Signals({ tab, marketId }: { tab: string; marketId?: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canManage = can("signal.manage");
  const canConfigure = can("signal.configure");
  const router = useRouter();
  const [o, setO] = useState<SignalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<MarketRef[]>([]);
  const go = (t: string, extra = "") => router.push(t === "today" ? "/signals" : `/signals?tab=${t}${extra}`, { scroll: false });

  const load = useCallback(async () => {
    try {
      setO(await api<SignalOverview>("/signals"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    api<{ items: MarketRow[] }>("/markets")
      .then((r) => setMarkets(r.items.map((m) => ({ id: m.id, name: m.name }))))
      .catch(() => setMarkets([]));
  }, []);

  const tabs: [string, string][] = [
    ["today", `Today${o?.funnel.needHuman ? ` · ${o.funnel.needHuman}` : ""}`],
    ["all", `All signals${o?.counts.open ? ` · ${o.counts.open}` : ""}`],
    ["markets", "Markets"],
    ["watchlists", "Watchlists"],
    ["rules", "Rules"],
    ["analytics", "Analytics"],
  ];

  if (!can("signal.read"))
    return (
      <div className="space-y-5" data-tone="leads">
        <PageHeader screen={findScreen("/signals")} />
        <Empty text="You don’t have permission to view signals." />
      </div>
    );

  return (
    <div className="space-y-5" data-tone="leads">
      <PageHeader screen={findScreen("/signals")} />

      <div role="tablist" aria-label="Signal sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => go(key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${tab === key ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {tab === "all" ? (
        <AllTab key={marketId ?? ""} markets={markets} initialMarketId={marketId} />
      ) : tab === "markets" ? (
        !o ? <Loading /> : <MarketsTab rows={o.markets} canManage={canManage} onChange={load} go={go} />
      ) : tab === "watchlists" ? (
        <WatchlistsTab canManage={canManage} markets={markets} />
      ) : tab === "rules" ? (
        <RulesTab canConfigure={canConfigure} markets={markets} />
      ) : tab === "analytics" ? (
        <AnalyticsTab />
      ) : !o ? (
        <Loading />
      ) : (
        <TodayTab o={o} go={go} />
      )}
    </div>
  );
}

// ── Today ───────────────────────────────────────────────────────────────────────────────────────

const FUNNEL_STEPS: [keyof SignalFunnel, string][] = [
  ["observations", "Raw observations"],
  ["meaningful", "Meaningful changes"],
  ["signals", "Signals"],
  ["relevant", "Relevant"],
  ["highPriority", "High priority"],
  ["needHuman", "Need you"],
];

export function Funnel({ f }: { f: SignalFunnel }) {
  return (
    <ol className="flex flex-wrap items-stretch gap-2">
      {FUNNEL_STEPS.map(([k, label], i) => (
        <li key={k} className="flex min-w-0 flex-1 basis-28 items-center gap-2">
          <div className={`card min-w-0 flex-1 p-3 ${k === "needHuman" && f[k] > 0 ? "border-tone/40" : ""}`}>
            <div className={`text-xl font-semibold tabular-nums ${k === "needHuman" && f[k] > 0 ? "text-tone" : ""}`}>{f[k].toLocaleString()}</div>
            <div className="truncate text-xs text-muted">{label}</div>
          </div>
          {i < FUNNEL_STEPS.length - 1 && <ChevronRight className="hidden size-4 shrink-0 text-faint lg:block" />}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, hint, warn, onClick }: { label: string; value: number; hint?: string; warn?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${warn && value > 0 ? "text-amber" : ""}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-faint">{hint}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-3.5 text-left hover:border-line-strong">
      {body}
    </button>
  ) : (
    <div className="card p-3.5">{body}</div>
  );
}

const HIRING_FALLBACK: SignalSourceStatus = { kind: "HIRING", label: "Hiring", connected: false, detail: "No hiring source connected yet — hiring signals cannot be detected.", signals30d: 0 };

function TodayTab({ o, go }: { o: SignalOverview; go: (t: string) => void }) {
  const c = o.counts;
  const sources = o.sources.some((s) => s.kind === "HIRING") ? o.sources : [...o.sources, HIRING_FALLBACK];
  const nothing = o.funnel.observations === 0 && c.open === 0 && o.today.length === 0;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <section>
          <h2 className="mb-2 text-sm font-semibold">From observation to “need you” · last 30 days</h2>
          <Funnel f={o.funnel} />
        </section>

        {nothing ? (
          <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
            <Radar className="size-9 text-tone" />
            <p className="text-base font-semibold">No signals yet</p>
            <p className="max-w-md text-sm text-muted">
              Signals appear when a watched company’s website changes, a follow-up date they asked for arrives, a lost deal reaches its revisit date, or a prospect asks for pricing or a meeting. Add companies or a
              saved market to a watchlist to start monitoring.
            </p>
            <button type="button" className="btn btn-secondary mt-2" onClick={() => go("watchlists")}>
              <Eye className="size-4" /> Watchlists
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Open signals" value={c.open} hint={`${c.actionable} actionable`} onClick={() => go("all")} />
              <Stat label="Needs verification" value={c.needsVerification} hint="Untrusted source — recheck" warn />
              <Stat label="Active windows" value={c.windowsActive} hint={`${c.windowsMissed} missed`} warn={false} />
              <Stat label="Monitoring" value={c.monitor} hint={`${c.expired30d} expired · ${c.dismissed30d} dismissed (30d)`} />
            </div>

            <section>
              <h2 className="mb-2 text-sm font-semibold">High-priority queue</h2>
              {o.priority.length === 0 ? <Empty text="Nothing high-priority right now." /> : <SignalList rows={o.priority} ranked />}
            </section>

            <section>
              <h2 className="mb-2 text-sm font-semibold">Detected today</h2>
              {o.today.length === 0 ? <Empty text="No new signals today." /> : <SignalList rows={o.today} />}
            </section>
          </>
        )}
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Plug className="size-4 text-tone" /> Sources
          </h2>
          <ul className="space-y-2.5 text-sm">
            {sources.map((s) => (
              <li key={s.kind}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{s.label}</span>
                  {s.connected ? (
                    <span className="badge shrink-0 border-tone/30 bg-tone-soft text-[10px] text-tone">Connected</span>
                  ) : (
                    <span className="badge shrink-0 text-[10px] text-faint">Not connected</span>
                  )}
                </div>
                <p className="text-xs text-faint">
                  {s.detail}
                  {s.connected ? ` · ${s.signals30d} signal${s.signals30d === 1 ? "" : "s"} in 30 days` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-4 text-sm">
          <h2 className="mb-2 flex items-center gap-1.5 font-semibold">
            <Eye className="size-4 text-tone" /> Watched
          </h2>
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-xs text-faint">Companies</dt>
              <dd className="font-semibold tabular-nums">{o.watched.companies}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Watchlists</dt>
              <dd className="font-semibold tabular-nums">{o.watched.watchlists}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Due for a check</dt>
              <dd className="font-semibold tabular-nums">{o.watched.dueForCheck}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Last sweep</dt>
              <dd className="text-xs">{o.watched.lastSweepAt ? timeAgo(o.watched.lastSweepAt) : "Not yet"}</dd>
            </div>
          </dl>
          <button type="button" className="mt-3 text-xs text-tone hover:underline" onClick={() => go("watchlists")}>
            Manage watchlists
          </button>
        </section>

        {o.byType.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-2 text-sm font-semibold">By type</h2>
            <ul className="space-y-1 text-sm">
              {o.byType.map((t) => (
                <li key={t.type} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{t.label}</span>
                  <span className="shrink-0 text-xs text-faint tabular-nums">
                    {t.open} open · {t.total30d} in 30d
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card p-4 text-xs text-muted">
          <div className="eyebrow mb-1.5 text-[11px]">A signal is not intent</div>
          <p>It is evidence that something changed. Nothing is sent because of a signal: outreach still goes Verify → Relevance → Why now → Relationship check → Campaign → Policy.</p>
        </section>
      </aside>
    </div>
  );
}

// ── All signals ─────────────────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: [string, string][] = [["OPEN", "Open"], ["ALL", "Any status"], ...SIGNAL_STATUSES.map((s): [string, string] => [s, SIGNAL_STATUS_INFO[s].label])];
const DAY_OPTIONS: [string, string][] = [
  ["", "Any date"],
  ["1", "Today"],
  ["7", "7 days"],
  ["30", "30 days"],
];

function AllTab({ markets, initialMarketId }: { markets: MarketRef[]; initialMarketId?: string }) {
  const [f, setF] = useState<SignalListQuery>({ status: "OPEN", marketId: initialMarketId });
  const [data, setData] = useState<{ items: SignalRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<SignalSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    api<{ items: SignalRow[]; total: number }>(`/signals/list${listQueryString(f)}`)
      .then((r) => live && (setData(r), setError(null)))
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [f]);

  const set = (patch: Partial<SignalListQuery>) => setF((prev) => ({ ...prev, ...patch }));
  const typeValue = f.type ? `type:${f.type}` : f.category ? `cat:${f.category}` : "";

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setSearch(await post<SignalSearchResult>("/signals/search", { q: q.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void runSearch(e)} className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 basis-64">
          <Sparkles className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <input className="input w-full pl-8" placeholder="Ask: Austin landscapers that added a new service recently" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} aria-label="Search signals in plain language" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={searching || !q.trim()}>
          {searching ? <Loader className="size-4 animate-spin" /> : <Search className="size-4" />} Search
        </button>
      </form>

      {search ? (
        <section className="space-y-3">
          <div className="card space-y-2 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">“{search.query}”</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-secondary h-8 text-xs"
                  onClick={() => {
                    setF({ status: "OPEN", ...search.filters });
                    setSearch(null);
                  }}
                >
                  Use as filters
                </button>
                <button type="button" className="btn btn-ghost h-8 px-2 text-xs" onClick={() => setSearch(null)} aria-label="Clear search">
                  <X className="size-4" />
                </button>
              </div>
            </div>
            <div className="text-xs text-faint">Understood as:</div>
            {search.explanation.length ? (
              <ul className="list-inside list-disc text-xs text-muted">
                {search.explanation.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No specific filters recognised — showing open signals.</p>
            )}
            <FilterChips f={search.filters} markets={markets} />
          </div>
          {search.items.length === 0 ? <Empty text="No signals match that question." /> : <SignalList rows={search.items} />}
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <select
              className="input col-span-2 sm:col-span-1"
              aria-label="Type"
              value={typeValue}
              onChange={(e) => {
                const v = e.target.value;
                set({ type: v.startsWith("type:") ? v.slice(5) : undefined, category: v.startsWith("cat:") ? (v.slice(4) as SignalCategory) : undefined });
              }}
            >
              <option value="">Any type</option>
              {SIGNAL_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={SIGNAL_CATEGORY_INFO[cat].label}>
                  <option value={`cat:${cat}`}>All {SIGNAL_CATEGORY_INFO[cat].label.toLowerCase()}</option>
                  {SIGNAL_TYPE_KEYS.filter((k) => SIGNAL_TYPES[k].category === cat).map((k) => (
                    <option key={k} value={`type:${k}`}>
                      {SIGNAL_TYPES[k].label}
                      {SIGNAL_TYPES[k].source === "NONE" ? " (no source yet)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select className="input" aria-label="Strength" value={f.strength ?? ""} onChange={(e) => set({ strength: (e.target.value || undefined) as SignalStrengthKey | undefined })}>
              <option value="">Any strength</option>
              <option value="STRONG">Strong</option>
              <option value="MEDIUM">Medium</option>
              <option value="WEAK">Weak</option>
            </select>
            <select className="input" aria-label="Date" value={f.days ? String(f.days) : ""} onChange={(e) => set({ days: e.target.value ? Number(e.target.value) : undefined })}>
              {DAY_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Market" value={f.marketId ?? ""} onChange={(e) => set({ marketId: e.target.value || undefined })}>
              <option value="">Any market</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <select className="input" aria-label="ICP fit" value={f.icp ?? ""} onChange={(e) => set({ icp: (e.target.value || undefined) as Level | undefined })}>
              <option value="">Any ICP fit</option>
              <option value="HIGH">ICP high</option>
              <option value="MEDIUM">ICP medium</option>
              <option value="LOW">ICP low</option>
            </select>
            <select className="input" aria-label="Relationship" value={f.relationship ?? ""} onChange={(e) => set({ relationship: (e.target.value || undefined) as Relationship | undefined })}>
              <option value="">Any relationship</option>
              {(Object.keys(RELATIONSHIP_INFO) as Relationship[]).map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_INFO[r].label}
                </option>
              ))}
            </select>
            <select className="input" aria-label="Status" value={f.status ?? "OPEN"} onChange={(e) => set({ status: e.target.value as SignalListQuery["status"] })}>
              {STATUS_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={!!f.priority} onChange={(e) => set({ priority: e.target.checked || undefined })} /> Priority only
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={!!f.campaignCandidate} onChange={(e) => set({ campaignCandidate: e.target.checked || undefined })} /> Campaign candidates
            </label>
            <button type="button" className="btn btn-ghost h-10 text-xs" onClick={() => setF({ status: "OPEN" })}>
              Reset filters
            </button>
          </div>

          {error ? (
            <ErrorBox text={error} />
          ) : !data ? (
            <Loading />
          ) : data.items.length === 0 ? (
            <Empty text="No signals match these filters." />
          ) : (
            <>
              <p className="text-xs text-faint">
                {data.total} signal{data.total === 1 ? "" : "s"}
                {data.total > data.items.length ? ` · showing ${data.items.length}` : ""}
              </p>
              <SignalList rows={data.items} />
            </>
          )}
        </>
      )}
      {search && error && <ErrorBox text={error} />}
    </div>
  );
}

function FilterChips({ f, markets }: { f: SignalListQuery; markets: MarketRef[] }) {
  const chips: string[] = [];
  if (f.type) chips.push(`Type: ${SIGNAL_TYPES[f.type as keyof typeof SIGNAL_TYPES]?.label ?? f.type}`);
  if (f.category) chips.push(`Category: ${SIGNAL_CATEGORY_INFO[f.category].label}`);
  if (f.strength) chips.push(`Strength: ${f.strength.toLowerCase()}`);
  if (f.days) chips.push(`Last ${f.days} day${f.days === 1 ? "" : "s"}`);
  if (f.marketId) chips.push(`Market: ${markets.find((m) => m.id === f.marketId)?.name ?? "saved market"}`);
  if (f.icp) chips.push(`ICP ${f.icp.toLowerCase()}`);
  if (f.relationship) chips.push(RELATIONSHIP_INFO[f.relationship].label);
  if (f.status && f.status !== "OPEN") chips.push(f.status === "ALL" ? "Any status" : SIGNAL_STATUS_INFO[f.status].label);
  if (f.priority) chips.push("Priority only");
  if (f.campaignCandidate) chips.push("Campaign candidates");
  if (f.q) chips.push(`Text: ${f.q}`);
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span key={c} className="badge text-[11px]">
          {c}
        </span>
      ))}
    </div>
  );
}

// ── Markets ─────────────────────────────────────────────────────────────────────────────────────

function MarketsTab({ rows, canManage, onChange, go }: { rows: MarketMonitorRow[]; canManage: boolean; onChange: () => Promise<void>; go: (t: string, extra?: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function watch(m: MarketMonitorRow) {
    setBusy(m.marketId);
    setError(null);
    try {
      await post("/signals/watchlists", { name: m.name, kind: "MARKET", priority: "NORMAL", marketId: m.marketId });
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  if (!rows.length)
    return (
      <Empty text="No saved markets yet. Save a market in Lead Hunter — then it becomes a living market here: new businesses, launched websites, changes and follow-ups due.">
        <Link href="/lead-hunter" className="btn btn-secondary mt-3">
          Open Lead Hunter
        </Link>
      </Empty>
    );
  return (
    <div className="space-y-3">
      {error && <ErrorBox text={error} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((m) => {
          const stats: [string, number][] = [
            ["New to our dataset", m.newToDataset30d],
            ["Websites launched", m.websiteLaunched30d],
            ["Website changes", m.websiteChanges30d],
            ["New services", m.newServices30d],
            ["Follow-ups due", m.followUpsDue30d],
            ["Strong signals", m.strong],
          ];
          return (
            <section key={m.marketId} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold break-words">{m.name}</h3>
                  <p className="text-xs text-muted">
                    <span className="font-semibold text-fg tabular-nums">{m.tracked.toLocaleString()}</span> tracked businesses
                  </p>
                </div>
                {m.watched ? (
                  <span className="badge border-tone/30 bg-tone-soft text-[10px] text-tone">
                    <Eye className="size-3" /> Watched
                  </span>
                ) : (
                  <span className="badge text-[10px] text-faint">Not watched</span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {stats.map(([label, v]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="min-w-0 truncate text-xs text-muted">{label}</dt>
                    <dd className={`shrink-0 font-semibold tabular-nums ${v > 0 ? "" : "text-faint"}`}>{v > 0 && label !== "Strong signals" ? `+${v}` : v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[11px] text-faint">Last 30 days. “New to our dataset” means a rescan found it — not that it newly opened. No hiring source is connected yet.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary h-8 text-xs" onClick={() => go("all", `&marketId=${m.marketId}`)}>
                  See signals
                </button>
                {!m.watched && canManage && (
                  <button type="button" className="btn btn-primary h-8 text-xs" disabled={busy !== null} onClick={() => void watch(m)}>
                    {busy === m.marketId ? <Loader className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} Watch market
                  </button>
                )}
                {m.watched && (
                  <button type="button" className="btn btn-ghost h-8 text-xs" onClick={() => go("watchlists")}>
                    Watchlist
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Analytics ───────────────────────────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [days, setDays] = useState(90);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {[30, 90, 180].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-md border px-2.5 py-1 text-xs ${days === d ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}>
            Last {d} days
          </button>
        ))}
      </div>
      <Loaded<SignalAnalytics> key={days} path={`/signals/analytics?days=${days}`}>
        {(a) => <AnalyticsBody a={a} />}
      </Loaded>
    </div>
  );
}

function AnalyticsBody({ a }: { a: SignalAnalytics }) {
  if (a.outcomes.detected === 0 && a.funnel.observations === 0)
    return (
      <Empty text={`No signals in the last ${a.days} days, so there are no outcomes to measure yet. Usefulness is judged only from real results — conversations, meetings, deals won — never estimated.`} />
    );
  const out: [string, number][] = [
    ["Detected", a.outcomes.detected],
    ["Relevant", a.outcomes.relevant],
    ["Acted on", a.outcomes.actedOn],
    ["Conversations", a.outcomes.conversations],
    ["Meetings", a.outcomes.meetings],
    ["Opportunities", a.outcomes.opportunities],
    ["Won", a.outcomes.won],
  ];
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Filtering · last {a.days} days</h2>
        <Funnel f={a.funnel} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Outcomes</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {out.map(([l, v]) => (
            <div key={l} className="card p-3">
              <div className="text-lg font-semibold tabular-nums">{v.toLocaleString()}</div>
              <div className="text-xs text-muted">{l}</div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">By signal type</h2>
        {a.byType.length === 0 ? (
          <Empty text="No signal types to compare yet." />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Type</th>
                  {["Signals", "Acted on", "Dismissed", "Conversations", "Meetings", "Opportunities", "Won"].map((h) => (
                    <th key={h} className="px-3 py-2 text-right font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.byType.map((t) => (
                  <tr key={t.type} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">{t.label}</td>
                    {[t.signals, t.actedOn, t.dismissed, t.conversations, t.meetings, t.opportunities, t.won].map((v, i) => (
                      <td key={i} className={`px-3 py-2 text-right tabular-nums ${v ? "" : "text-faint"}`}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">“Not relevant” feedback</h2>
          {a.feedback.every((f) => f.count === 0) ? (
            <p className="text-sm text-muted">No signals dismissed in this period.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {a.feedback.map((f) => (
                <li key={f.feedback} className="flex justify-between gap-2">
                  <span>{f.label}</span>
                  <span className="text-muted tabular-nums">{f.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Lightbulb className="size-4 text-amber" /> Suggestions
          </h2>
          {a.suggestions.length === 0 ? (
            <p className="text-sm text-muted">No suggestions yet — they come from real outcomes once there is enough history.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {a.suggestions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-faint">A person decides — suggested rule changes are never applied automatically.</p>
        </section>
      </div>
    </div>
  );
}
