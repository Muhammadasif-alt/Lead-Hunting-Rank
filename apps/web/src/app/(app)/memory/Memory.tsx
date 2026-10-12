"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, CircleAlert, Loader, Search } from "lucide-react";
import type { PermissionKey } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage } from "@/lib/api";
import type { Candidate, CommitmentRow, MemoryConflictRow, MemoryOverview, MemoryRow, RelationshipRow } from "@/lib/memory";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { CandidatesPanel, CommitmentsPanel, ConflictsPanel, Empty, MemoryDrawer, MemoryList, RelationshipsPanel } from "./parts";

const ORIGINS: [string, string][] = [
  ["", "Any source"],
  ["DIRECT_STATEMENT", "They said it"],
  ["MEETING_NOTE", "Meeting notes"],
  ["HUMAN_NOTE", "Team notes"],
  ["HUMAN_CORRECTION", "Corrections"],
  ["AI_INFERENCE", "AI guesses"],
];
const STATUSES: [string, string][] = [
  ["", "Active"],
  ["STALE", "Stale"],
  ["CONFLICTED", "Conflicting"],
  ["SUPERSEDED", "Replaced"],
  ["INVALIDATED", "Removed"],
];

/**
 * AI Memory (screen #12): what the AI remembers about each company and person — with evidence, freshness and who said
 * it — plus promises both ways. A person confirms the sensitive ones, settles conflicts and corrects anything wrong.
 */
export function Memory({ tab, status }: { tab: string; status?: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canManage = can("memory.manage");
  const router = useRouter();
  const [o, setO] = useState<MemoryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const go = (t: string) => router.push(t === "overview" ? "/memory" : `/memory?tab=${t}`, { scroll: false });

  const load = useCallback(async () => {
    try {
      setO(await api<MemoryOverview>("/memory"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const h = o?.health;
  const tabs: [string, string][] = [
    ["overview", "Overview"],
    ["review", `Review${h?.review ? ` · ${h.review}` : ""}`],
    ["commitments", `Commitments${o?.commitmentsDue ? ` · ${o.commitmentsDue}` : ""}`],
    ["conflicts", `Conflicts${h?.conflicting ? ` · ${h.conflicting}` : ""}`],
    ["relationships", "Relationships"],
    ["search", "Search"],
  ];

  return (
    <div className="space-y-5" data-tone="ai">
      <PageHeader screen={findScreen("/memory")} />

      <div role="tablist" aria-label="Memory sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
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

      {tab === "review" ? (
        <Loaded<Candidate[]> path="/memory/candidates">{(rows, reload) => <CandidatesPanel rows={rows} canManage={canManage} onChange={() => (reload(), void load())} />}</Loaded>
      ) : tab === "commitments" ? (
        <Commitments canManage={canManage} onChange={load} />
      ) : tab === "conflicts" ? (
        <Loaded<MemoryConflictRow[]> path="/memory/conflicts">{(rows, reload) => <ConflictsPanel rows={rows} canManage={canManage} onChange={() => (reload(), void load())} />}</Loaded>
      ) : tab === "relationships" ? (
        <Loaded<RelationshipRow[]> path="/memory/relationships">{(rows, reload) => <RelationshipsPanel rows={rows} canManage={canManage} onChange={reload} />}</Loaded>
      ) : tab === "search" ? (
        <SearchTab initialStatus={status} onOpen={setOpen} />
      ) : !o ? (
        <Loading />
      ) : (
        <OverviewTab o={o} onOpen={setOpen} go={go} />
      )}

      {open && <MemoryDrawer id={open} canManage={canManage} onClose={() => setOpen(null)} onChange={() => void load()} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
      <Loader className="size-4 animate-spin" /> Loading…
    </div>
  );
}

function Loaded<T>({ path, children }: { path: string; children: (data: T, reload: () => void) => ReactNode }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [path]);
  useEffect(() => void load(), [load]);
  if (error) return <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>;
  if (!data) return <Loading />;
  return <>{children(data, () => void load())}</>;
}

function OverviewTab({ o, onOpen, go }: { o: MemoryOverview; onOpen: (id: string) => void; go: (t: string) => void }) {
  const h = o.health;
  if (h.total === 0)
    return (
      <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
        <Brain className="size-9 text-tone" />
        <p className="text-base font-semibold">Nothing remembered yet</p>
        <p className="max-w-md text-sm text-muted">
          When prospects reply or meetings are recorded, the AI keeps what they said — with the exact quote — so nobody asks twice. Budget and authority wait for a person to confirm.
        </p>
      </div>
    );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active memories" value={h.active} hint={`${h.highConfidence} high confidence`} />
          <Stat label="Fresh" value={`${h.freshPercent}%`} hint={`${h.stale} stale`} onClick={() => go("search")} warn={h.stalePercent > 25} />
          <Stat label="Conflicting" value={h.conflicting} hint="AI uses neither side" onClick={() => go("conflicts")} warn={h.conflicting > 0} />
          <Stat label="Waiting for review" value={h.review} hint="Budget, authority, unsure" onClick={() => go("review")} warn={h.review > 0} />
        </div>
        <section>
          <h2 className="mb-2 text-sm font-semibold">Recently learned</h2>
          {o.recent.length === 0 ? <Empty text="Nothing new this week." /> : <MemoryList rows={o.recent} onOpen={onOpen} />}
        </section>
      </div>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          {o.attention.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {o.attention.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-start gap-2 hover:text-tone">
                    <CircleAlert className={`mt-0.5 size-4 shrink-0 ${a.kind === "CONFLICT" ? "text-danger" : "text-amber"}`} />
                    <span>
                      {a.company ? <span className="font-medium">{a.company}: </span> : null}
                      {a.text}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-4 text-xs text-muted">
          <div className="eyebrow mb-1.5 text-[11px]">What memory never holds</div>
          <p>Opt-outs and suppression live in the suppression list, not memory — they always win. No passwords, payment details or sensitive personal data.</p>
          <p className="mt-1.5">AI guesses are marked and are never quoted back to a prospect as fact.</p>
        </section>
      </aside>
    </div>
  );
}

function Stat({ label, value, hint, onClick, warn }: { label: string; value: number | string; hint: string; onClick?: () => void; warn?: boolean }) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${warn ? "text-amber" : ""}`}>{value}</div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-4 text-left hover:border-line-strong">
      {body}
    </button>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

function Commitments({ canManage, onChange }: { canManage: boolean; onChange: () => void }) {
  const [filter, setFilter] = useState<"open" | "ours" | "theirs" | "all">("open");
  const params = new URLSearchParams();
  if (filter === "all") params.set("status", "ALL");
  if (filter === "ours") params.set("direction", "WE_PROMISED");
  if (filter === "theirs") params.set("direction", "PROSPECT_PROMISED");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["open", "Open"],
            ["ours", "We promised"],
            ["theirs", "They promised"],
            ["all", "All, incl. done"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-md border px-2.5 py-1 text-xs ${filter === k ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}>
            {l}
          </button>
        ))}
      </div>
      <Loaded<CommitmentRow[]> key={filter} path={`/memory/commitments${params.size ? `?${params}` : ""}`}>
        {(rows, reload) => <CommitmentsPanel rows={rows} canManage={canManage} onChange={() => (reload(), onChange())} />}
      </Loaded>
    </div>
  );
}

function SearchTab({ initialStatus, onOpen }: { initialStatus?: string; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState(initialStatus ?? "");
  const [rows, setRows] = useState<MemoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (origin) p.set("origin", origin);
    if (status) p.set("status", status);
    const t = window.setTimeout(() => {
      api<MemoryRow[]>(`/memory/search${p.size ? `?${p}` : ""}`)
        .then((r) => (setRows(r), setError(null)))
        .catch((err) => setError(errorMessage(err)));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, origin, status]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
          <input className="input w-full pl-8" placeholder="Search what was said (e.g. budget, HubSpot, timeline)" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Source">
          {ORIGINS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty text="No memories match." />
      ) : (
        <MemoryList rows={rows} onOpen={onOpen} />
      )}
    </div>
  );
}
