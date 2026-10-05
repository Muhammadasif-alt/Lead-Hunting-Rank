"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CircleAlert,
  Copy,
  Globe,
  Loader,
  Pause,
  Phone,
  Play,
  Plug,
  Radar,
  Search,
  Square,
  TriangleAlert,
} from "lucide-react";
import { ApiError, api, errorMessage, post } from "@/lib/api";
import { formatAgo, formatDate, formatPhone } from "@/lib/crm";
import {
  COVERAGE_CLASS,
  COVERAGE_HINT,
  COVERAGE_LABEL,
  MISSION_STATUS_LABEL,
  MODE_LABEL,
  QUERY_TYPE_LABEL,
  isActive,
  isTerminal,
  missionStatusClass,
  percent,
  stopReasonLabel,
  type MissionAction,
  type MissionCompaniesResponse,
  type MissionCompany,
  type MissionDetail,
  type QueryRow,
  type QueryStatus,
} from "@/lib/discovery";

type WebsiteOpt = "any" | "with" | "without";
type PhoneOpt = "any" | "with";
type OutcomeOpt = "" | "CREATED" | "MATCHED_EXISTING";

const PAGE = 25;

/**
 * A live hunt (screen #3 mission view, Phase 7). Polls while the engine works; every number is a real count from the
 * mission's queries and observations, and coverage is shown as a confidence with its reasons — never a percentage.
 */
export function Mission({ id, initialWebsite }: { id: string; initialWebsite: WebsiteOpt }) {
  const [data, setData] = useState<MissionDetail | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<MissionDetail>(`/discovery-missions/${id}`));
      setError(null);
    } catch (err) {
      setError({ message: errorMessage(err), status: err instanceof ApiError ? err.status : undefined });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll every 2s while the engine works; slower while paused/blocked (someone may resume); stop when finished.
  useEffect(() => {
    if (!data || isTerminal(data.status)) return;
    const t = setTimeout(() => void load(), isActive(data.status) ? 2000 : 10000);
    return () => clearTimeout(t);
  }, [data, load]);

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error ? (
          <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <CircleAlert className="size-4 shrink-0" />
            {error.status === 404
              ? "This hunt doesn't exist in your workspace."
              : error.status === 403
                ? "You don't have permission to view hunts."
                : error.message}
          </div>
        ) : (
          <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading hunt…
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink />
      <Header data={data} onChange={load} />
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error.message}
        </div>
      )}
      <Counters data={data} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Saturation data={data} />
        <Activity queries={data.queries} active={isActive(data.status)} />
      </div>
      <Results data={data} initialWebsite={initialWebsite} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/lead-hunter" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" /> Lead Hunter
    </Link>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────────────────────────

const ACTIONS: Record<MissionAction, { label: string; icon: typeof Pause; className: string }> = {
  pause: { label: "Pause", icon: Pause, className: "btn btn-secondary" },
  resume: { label: "Resume", icon: Play, className: "btn btn-primary" },
  stop: { label: "Stop", icon: Square, className: "btn btn-ghost" },
};

function Header({ data, onChange }: { data: MissionDetail; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<MissionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = isActive(data.status) && data.status !== "WAITING";

  async function act(action: MissionAction) {
    if (
      action === "stop" &&
      !window.confirm("Stop this hunt? Businesses found so far stay in Companies; coverage is measured on what ran.")
    )
      return;
    setBusy(action);
    setError(null);
    try {
      await post(`/discovery-missions/${data.id}/${action}`, { version: data.version });
      await onChange();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("The hunt changed while you were looking — reloaded the latest state. Try again if still needed.");
        await onChange();
      } else setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const location = [data.market.city, data.market.region, data.market.country].filter(Boolean).join(", ");

  return (
    <div className="space-y-3 border-b border-line pb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-xl border border-tone/20 bg-tone-soft">
            <Radar className="size-5 text-tone" />
          </div>
          <div className="min-w-0">
            <div className="eyebrow mb-1 text-[11px]">Hunt · {MODE_LABEL[data.mode] ?? data.mode}</div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{data.market.name}</h1>
              <span className={`badge ${missionStatusClass(data.status)}`}>
                {running && <Loader className="size-3 animate-spin" />}
                {MISSION_STATUS_LABEL[data.status] ?? data.status}
              </span>
            </div>
            <div className="mt-1 text-sm text-muted">
              {location}
              {data.startedAt && ` · started ${formatAgo(data.startedAt)}`}
              {data.createdBy && ` by ${data.createdBy.name}`}
              {data.completedAt && ` · finished ${formatDate(data.completedAt)}`}
            </div>
            {data.request && <div className="mt-1 text-xs break-words text-faint">“{data.request}”</div>}
          </div>
        </div>
        {data.allowedActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(["resume", "pause", "stop"] as const)
              .filter((a) => data.allowedActions.includes(a))
              .map((a) => {
                const A = ACTIONS[a];
                return (
                  <button
                    key={a}
                    type="button"
                    className={A.className}
                    disabled={busy !== null}
                    onClick={() => void act(a)}
                  >
                    {busy === a ? <Loader className="size-4 animate-spin" /> : <A.icon className="size-4" />} {A.label}
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <StatusNote data={data} />
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function StatusNote({ data }: { data: MissionDetail }) {
  const s = data.status;
  if (s === "WAITING") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber/30 bg-amber-soft/50 px-4 py-3 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
        <span>
          {data.statusReason ?? "A source asked us to slow down."}
          {data.retryAt && (
            <span className="text-muted">
              {" "}
              — retries automatically at {new Date(data.retryAt).toLocaleTimeString()}.
            </span>
          )}
        </span>
      </div>
    );
  }
  if (s === "BLOCKED") {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2 text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {data.statusReason ?? "The hunt can't continue."}
        </span>
        <Link href="/integrations" className="btn btn-secondary h-8 self-start sm:self-auto">
          <Plug className="size-4" /> Integrations
        </Link>
      </div>
    );
  }
  if (s === "FAILED") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {data.statusReason ?? "The hunt failed unexpectedly."}
      </div>
    );
  }
  if (s === "PAUSED") {
    return (
      <p className="text-sm text-muted">
        Paused{data.statusReason ? ` — ${data.statusReason}` : ""}. Nothing is searched until it is resumed.
      </p>
    );
  }
  if (s === "COMPLETED" && data.stopReason) {
    return <p className="text-sm text-muted">Finished: {stopReasonLabel(data.stopReason)}.</p>;
  }
  if (isActive(s)) {
    return (
      <p className="text-sm text-muted">
        Round {Math.max(1, data.currentRound)} of up to {data.maxRounds}. This page updates by itself.
      </p>
    );
  }
  return null;
}

// ── Counters ────────────────────────────────────────────────────────────────────────────────────

function Counters({ data }: { data: MissionDetail }) {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Sources searched"
          value={data.sourcesUsed.length}
          hint={data.sources.map((s) => s.name).join(", ") || undefined}
        />
        <Stat
          label="Queries"
          value={
            <>
              {data.queriesExecuted}
              <span className="text-sm font-normal text-faint"> / {data.maxQueries}</span>
            </>
          }
          hint={data.failedQueries ? `${data.failedQueries} failed` : `${data.providerCalls} provider calls`}
          warn={data.failedQueries > 0}
        />
        <Stat
          label="Raw listings"
          value={data.observationsCount}
          hint={
            data.rejectedObservations ? `${data.rejectedObservations} rejected (no name / outside area)` : undefined
          }
        />
        <Stat label="Unique businesses" value={data.uniqueCompanies} strong />
        <Stat label="New to CRM" value={data.newCompanies} />
        <Stat label="Already in CRM" value={data.matchedExisting} />
        <Stat label="Duplicate listings merged" value={data.duplicateObservations} />
        <Stat
          label="Sent to review"
          value={data.reviewCandidates}
          hint={data.reviewCandidates ? "Possible duplicates" : undefined}
          href={data.reviewCandidates ? "/companies/duplicates" : undefined}
          warn={data.reviewCandidates > 0}
        />
        <Stat label="With website" value={data.withWebsite} />
        <Stat label="Without website" value={data.withoutWebsite} hint="An opportunity signal" />
        <Stat label="With phone" value={data.withPhone} />
        <Stat
          label="Round"
          value={
            <>
              {data.currentRound}
              <span className="text-sm font-normal text-faint"> / {data.maxRounds}</span>
            </>
          }
        />
      </div>
      <p className="text-xs text-faint">
        Business counts refresh when each round is measured; the activity feed shows each query as it runs.
      </p>
      {data.sources.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-raised text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-2 py-2 text-right font-medium">Queries</th>
                <th className="px-2 py-2 text-right font-medium">Listings</th>
                <th className="px-4 py-2 text-right font-medium">Businesses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.sources.map((s) => (
                <tr key={s.provider}>
                  <td className="max-w-0 truncate px-4 py-2">{s.name}</td>
                  <td className="px-2 py-2 text-right text-muted tabular-nums">{s.queries}</td>
                  <td className="px-2 py-2 text-right text-muted tabular-nums">{s.observations}</td>
                  <td className="px-4 py-2 text-right text-muted tabular-nums">{s.uniqueCompanies}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  strong,
  warn,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
  strong?: boolean;
  warn?: boolean;
}) {
  const body = (
    <>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${strong ? "text-tone" : ""}`}>{value}</div>
      {hint && <div className={`mt-0.5 truncate text-[11px] ${warn ? "text-amber" : "text-faint"}`}>{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-3.5 transition-colors hover:border-tone/30">
      {body}
    </Link>
  ) : (
    <div className="card min-w-0 p-3.5">{body}</div>
  );
}

// ── Saturation + coverage ───────────────────────────────────────────────────────────────────────

function Saturation({ data }: { data: MissionDetail }) {
  const rounds = data.rounds;
  const latest = rounds.at(-1) ?? null;
  const confidence = data.coverageConfidence ?? latest?.confidence ?? null;
  const max = Math.max(1, ...rounds.map((r) => r.newUnique));

  return (
    <section className="card space-y-5 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold">Saturation</h2>
        <p className="mt-0.5 text-xs text-muted">New unique businesses each round added. Shrinking bars = drying up.</p>
      </div>

      {rounds.length === 0 ? (
        <p className="text-sm text-muted">
          {isTerminal(data.status) ? "No round was measured." : "The first round is measured once its queries finish."}
        </p>
      ) : (
        <ol className="space-y-2.5">
          {rounds.map((r) => (
            <li key={r.round} className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 text-xs">
              <span className="text-muted">Round {r.round}</span>
              <div className="min-w-0">
                <div className="h-2.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-tone"
                    style={{ width: `${Math.max(r.newUnique ? 3 : 0, (r.newUnique / max) * 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-muted">
                  <span>
                    <span className="font-medium text-fg tabular-nums">+{r.newUnique}</span> new
                  </span>
                  <span>{percent(r.marginalYield)} of total</span>
                  <span>{r.cumulativeUnique} found so far</span>
                  <span className="text-faint">{percent(r.duplicateRate)} repeat listings</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className={`rounded-xl border p-4 ${confidence ? COVERAGE_CLASS[confidence] : "border-line"}`}>
        <div className="text-xs font-medium opacity-80">Coverage confidence</div>
        <div className="mt-0.5 text-lg font-semibold">
          {confidence ? COVERAGE_LABEL[confidence].toUpperCase() : "Not measured yet"}
        </div>
        {confidence && <p className="mt-1 text-xs text-muted">{COVERAGE_HINT[confidence]}</p>}
        {data.stopReason && (
          <p className="mt-2 text-xs text-fg">
            <span className="text-muted">Why it stopped:</span> {stopReasonLabel(data.stopReason)}
          </p>
        )}
        {latest && latest.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">
            {latest.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs leading-relaxed text-faint">
        Coverage is an estimate — it means new results dried up, not that every business was found.
      </p>
    </section>
  );
}

// ── Activity feed ───────────────────────────────────────────────────────────────────────────────

const QUERY_STATUS: Record<QueryStatus, { label: string; className: string }> = {
  PLANNED: { label: "Planned", className: "" },
  RUNNING: { label: "Running", className: "border-accent/30 bg-accent-soft text-accent" },
  COMPLETED: { label: "Done", className: "border-brand/25 bg-brand-soft text-brand" },
  FAILED: { label: "Failed", className: "border-danger/30 bg-danger-soft text-danger" },
  SKIPPED: { label: "Skipped", className: "" },
};

function Activity({ queries, active }: { queries: QueryRow[]; active: boolean }) {
  const [all, setAll] = useState(false);
  const shown = all ? queries : queries.slice(0, 12);

  return (
    <section className="card flex flex-col p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Activity</h2>
        {active && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="size-1.5 animate-pulse rounded-full bg-tone" /> live
          </span>
        )}
      </div>
      {queries.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No queries yet — the first round is being planned.</p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line">
            {shown.map((q) => {
              const st = QUERY_STATUS[q.status] ?? { label: q.status, className: "" };
              return (
                <li key={q.id} className="py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm break-words">{q.queryText}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        R{q.round} · {q.providerName} · {QUERY_TYPE_LABEL[q.queryType] ?? q.queryType}
                      </div>
                    </div>
                    <span className={`badge shrink-0 ${st.className}`}>
                      {q.status === "RUNNING" && <Loader className="size-3 animate-spin" />}
                      {st.label}
                    </span>
                  </div>
                  {(q.status !== "PLANNED" || q.resultCount > 0) && (
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>
                        <span className="text-fg tabular-nums">{q.resultCount}</span> results
                      </span>
                      <span>
                        <span className="text-fg tabular-nums">{q.newUniqueCount}</span> new unique
                      </span>
                      <span>
                        {q.pagesFetched} {q.pagesFetched === 1 ? "page" : "pages"}
                        {q.exhausted && " · source exhausted"}
                      </span>
                    </div>
                  )}
                  {q.error && <div className="mt-1 text-xs break-words text-danger">{q.error}</div>}
                </li>
              );
            })}
          </ul>
          {queries.length > 12 && (
            <button type="button" className="btn btn-ghost mt-2 h-8 self-center" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${queries.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ── Results ─────────────────────────────────────────────────────────────────────────────────────

function Results({ data, initialWebsite }: { data: MissionDetail; initialWebsite: WebsiteOpt }) {
  const [website, setWebsite] = useState<WebsiteOpt>(initialWebsite);
  const [phone, setPhone] = useState<PhoneOpt>("any");
  const [outcome, setOutcome] = useState<OutcomeOpt>("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<MissionCompaniesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stale, setStale] = useState(false);
  const loaded = useRef(0);

  const load = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(PAGE), website, phone });
      if (outcome) params.set("outcome", outcome);
      if (q.trim()) params.set("q", q.trim());
      if (cursor) params.set("cursor", cursor);
      try {
        const r = await api<MissionCompaniesResponse>(`/discovery-missions/${data.id}/companies?${params}`);
        setRes((prev) => {
          const next = cursor && prev ? { ...r, items: [...prev.items, ...r.items] } : r;
          loaded.current = next.items.length;
          return next;
        });
        setError(null);
        if (!cursor) setStale(false);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [data.id, website, phone, outcome, q],
  );

  // Filters (search debounced).
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // New businesses arrive as rounds are resolved: refresh silently on the first page, otherwise offer a refresh.
  const changeKey = `${data.uniqueCompanies}|${data.observationsCount}|${data.status}`;
  const lastKey = useRef(changeKey);
  useEffect(() => {
    if (lastKey.current === changeKey) return;
    lastKey.current = changeKey;
    if (loaded.current <= PAGE) void load();
    else setStale(true);
  }, [changeKey, load]);

  const filtered = website !== "any" || phone !== "any" || !!outcome || !!q.trim();

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Businesses found</h2>
          <p className="text-xs text-muted">
            {res
              ? `${res.total} ${filtered ? "matching" : "unique"} ${res.total === 1 ? "business" : "businesses"}`
              : " "}
            {" · "}each opens its Company 360° record with every source.
          </p>
        </div>
        {stale && (
          <button type="button" className="btn btn-secondary h-8" onClick={() => void load()}>
            New results — refresh
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,11rem)]">
        <label className="relative sm:col-span-2 lg:col-span-1">
          <span className="sr-only">Search businesses</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search name, website or phone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Website</span>
          <select className="input" value={website} onChange={(e) => setWebsite(e.target.value as WebsiteOpt)}>
            <option value="any">Website: any</option>
            <option value="with">With website</option>
            <option value="without">Without website</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Phone</span>
          <select className="input" value={phone} onChange={(e) => setPhone(e.target.value as PhoneOpt)}>
            <option value="any">Phone: any</option>
            <option value="with">With phone</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Outcome</span>
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value as OutcomeOpt)}>
            <option value="">All outcomes</option>
            <option value="CREATED">New to CRM</option>
            <option value="MATCHED_EXISTING">Already in CRM</option>
          </select>
        </label>
      </div>

      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}

      {res === null ? (
        !error && (
          <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading…
          </div>
        )
      ) : res.items.length === 0 ? (
        <div className="card px-5 py-8 text-center text-sm text-muted">
          {filtered
            ? "No businesses match these filters."
            : isTerminal(data.status)
              ? "This hunt didn't find any businesses."
              : "No businesses resolved yet — they appear here after the first round's listings are de-duplicated."}
        </div>
      ) : (
        <>
          <ResultTable rows={res.items} />
          {res.nextCursor && (
            <div className="flex justify-center">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loadingMore}
                onClick={async () => {
                  setLoadingMore(true);
                  await load(res.nextCursor ?? undefined);
                  setLoadingMore(false);
                }}
              >
                {loadingMore && <Loader className="size-4 animate-spin" />} Load more
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ResultTable({ rows }: { rows: MissionCompany[] }) {
  return (
    <div className="card overflow-hidden">
      {/* Desktop: table */}
      <table className="hidden w-full text-sm md:table">
        <thead className="border-b border-line bg-raised text-left text-xs text-muted">
          <tr>
            <th className="px-5 py-2.5 font-medium">Business</th>
            <th className="px-3 py-2.5 font-medium">Website</th>
            <th className="px-3 py-2.5 font-medium">Phone</th>
            <th className="px-3 py-2.5 font-medium">Sources</th>
            <th className="px-3 py-2.5 text-right font-medium">Listings</th>
            <th className="px-5 py-2.5 text-right font-medium">Round</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c) => (
            <tr key={c.companyId} className="relative hover:bg-hover/60">
              <td className="px-5 py-3">
                <Link href={`/companies/${c.companyId}`} className="font-medium after:absolute after:inset-0">
                  {c.displayName}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  {[c.city, c.region].filter(Boolean).join(", ")}
                  <OutcomeBadge outcome={c.outcome} />
                  {c.flaggedForReview && <ReviewBadge />}
                </div>
              </td>
              <td className="px-3 py-3 text-muted">{c.websiteDomain ?? <NoWebsite />}</td>
              <td className="px-3 py-3 whitespace-nowrap text-muted">
                {formatPhone(c.phone) ?? <span className="text-faint">—</span>}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {c.sources.map((s) => (
                    <span key={s} className="badge">
                      {s}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-3 text-right text-muted tabular-nums">{c.listings}</td>
              <td className="px-5 py-3 text-right text-muted tabular-nums">{c.firstRound}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: list */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((c) => (
          <li key={c.companyId}>
            <Link href={`/companies/${c.companyId}`} className="block px-4 py-3.5 hover:bg-hover/60">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.displayName}</div>
                  <div className="truncate text-xs text-muted">
                    {[c.city, c.region].filter(Boolean).join(", ") || "Location not listed"}
                  </div>
                </div>
                <OutcomeBadge outcome={c.outcome} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
                {c.websiteDomain ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Globe className="size-3.5 shrink-0" /> <span className="truncate">{c.websiteDomain}</span>
                  </span>
                ) : (
                  <NoWebsite />
                )}
                {c.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-3.5" /> {formatPhone(c.phone)}
                  </span>
                )}
                <span>
                  {c.listings} {c.listings === 1 ? "listing" : "listings"} · round {c.firstRound}
                </span>
                {c.flaggedForReview && <ReviewBadge />}
              </div>
              {c.sources.length > 0 && (
                <div className="mt-1.5 truncate text-xs text-faint">{c.sources.join(" · ")}</div>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoWebsite() {
  return (
    <span className="badge border-amber/30 bg-amber-soft text-amber" title="No website listed — an opportunity signal">
      No website
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: MissionCompany["outcome"] }) {
  return outcome === "CREATED" ? (
    <span className="badge shrink-0 border-brand/25 bg-brand-soft text-brand">New</span>
  ) : (
    <span className="badge shrink-0">Already in CRM</span>
  );
}

function ReviewBadge() {
  return (
    <span className="badge border-amber/30 bg-amber-soft text-amber" title="Possible duplicate sent to review">
      <Copy className="size-3" /> In review
    </span>
  );
}
