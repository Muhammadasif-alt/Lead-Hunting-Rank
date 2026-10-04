"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Inbox, Loader, Play, RefreshCw, RotateCcw, Workflow, X } from "lucide-react";
import { useMe } from "@/lib/session-context";

// ── API shapes (GET/POST /api/v1/system/…) ──────────────────────────────────────────────

interface Overview {
  outbox: Record<string, number> & { oldestPendingAgeMs: number | null };
  externalActions: Record<string, number>;
  openDeadLetters: number;
  workers: { workerId: string; queues: string[]; lastHeartbeatAt: string }[] | null;
  queues: { name: string; waiting?: number; active?: number; delayed?: number; failed?: number; error?: string }[];
}

interface ActionDetail {
  action: { id: string; status: string; attemptCount: number; statusReason: string | null; lastError: string | null; responseRef: string | null; createdAt: string };
  events: { id: string; eventType: string; occurredAt: string }[];
  providerCalls: number | null;
}

interface DeadLetter {
  id: string;
  queue: string;
  jobName: string;
  entityType: string | null;
  entityId: string | null;
  correlationId: string | null;
  failureCategory: string;
  lastError: string;
  attempts: number;
  retryCount: number;
  lastFailedAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body?.data as T;
}

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "BLOCKED", "CANCELLED", "WAITING"]);
type Simulate = "" | "rate-limit" | "lost-response";

/**
 * System Health → Event pipeline (Phase 4). Shows the real outbox/queue/worker state, runs the end-to-end
 * self-test, and lists failed jobs (DLQ). Read needs system.read; test/retry/dismiss need system.manage.
 */
export function EventPipeline() {
  const me = useMe();
  const canRead = me.permissions.includes("system.read");
  const canManage = me.permissions.includes("system.manage");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, d] = await Promise.all([api<Overview>("/system/pipeline"), api<DeadLetter[]>("/system/dead-letters")]);
      setOverview(o);
      setDeadLetters(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!canRead) return;
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [canRead, load]);

  if (!canRead) return null;

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Workflow className="size-4 text-tone" /> Event pipeline
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Every change is saved together with an event. The outbox hands events to queues, workers run them, and every
            external action (email, booking…) runs exactly once — even if a job is retried or a worker crashes.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn btn-ghost h-8 px-2" aria-label="Refresh">
          <RefreshCw className="size-4" />
        </button>
      </div>

      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4" /> {error}
        </div>
      )}

      <Stats overview={overview} />
      {canManage && <PipelineTest onDone={load} />}
      <div className="grid gap-6 lg:grid-cols-2">
        <Queues overview={overview} />
        <Workers overview={overview} />
      </div>
      <DeadLetters rows={deadLetters} canManage={canManage} onChange={load} />
    </section>
  );
}

function Stats({ overview }: { overview: Overview | null }) {
  const n = (v: number | undefined) => (overview ? (v ?? 0).toLocaleString() : "—");
  const oldest = overview?.outbox.oldestPendingAgeMs;
  const tiles = [
    { label: "Waiting in outbox", value: n(overview?.outbox.PENDING), hint: oldest ? `oldest ${formatAge(oldest)}` : "nothing waiting" },
    { label: "Events delivered", value: n(overview?.outbox.PUBLISHED), hint: "to their queues" },
    { label: "Actions succeeded", value: n(overview?.externalActions.SUCCEEDED), hint: "confirmed by provider" },
    {
      label: "Failed jobs",
      value: n(overview?.openDeadLetters),
      hint: overview?.openDeadLetters ? "need a look below" : "none open",
      alert: (overview?.openDeadLetters ?? 0) > 0,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`card p-4 ${t.alert ? "border-danger/30" : ""}`}>
          <div className="text-xs text-muted">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${t.alert ? "text-danger" : ""}`}>{t.value}</div>
          <div className="mt-0.5 text-xs text-faint">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}

const STEPS = [
  { key: "command", label: "Command accepted", detail: "API checked your permission" },
  { key: "saved", label: "Saved with its event", detail: "One database transaction: action + event + outbox" },
  { key: "queued", label: "Handed to the queue", detail: "Dispatcher moved the event into BullMQ" },
  { key: "worker", label: "Worker picked it up", detail: "Claimed atomically — no other worker can run it" },
  { key: "provider", label: "Provider confirmed", detail: "Fake provider (real ones arrive in Phase 5)" },
  { key: "result", label: "Result recorded", detail: "Success event written — the flow is traceable end to end" },
] as const;

function stepsDone(d: ActionDetail | null): number {
  if (!d) return 1;
  const types = new Set(d.events.map((e) => e.eventType));
  if (d.action.status === "SUCCEEDED" && types.has("ExternalActionSucceeded")) return 6;
  if (d.action.attemptCount > 0) return 4;
  if (types.has("ExternalActionQueued") && d.action.status !== "QUEUED") return 3;
  return types.has("ExternalActionPrepared") ? 2 : 1;
}

function PipelineTest({ onDone }: { onDone: () => Promise<void> }) {
  const [simulate, setSimulate] = useState<Simulate>("");
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // Reset on (re)mount — React StrictMode runs mount → cleanup → mount in development.
  useEffect(() => {
    cancelled.current = false;
    return () => void (cancelled.current = true);
  }, []);

  async function run() {
    setRunning(true);
    setError(null);
    setDetail(null);
    setElapsed(null);
    const t0 = Date.now();
    setStarted(t0);
    try {
      const { externalActionId } = await api<{ externalActionId: string }>("/system/pipeline/test", {
        method: "POST",
        body: JSON.stringify(simulate ? { simulate } : {}),
      });
      const deadline = Date.now() + 60_000;
      while (!cancelled.current) {
        const d = await api<ActionDetail>(`/system/external-actions/${externalActionId}`);
        setDetail(d);
        if (TERMINAL.has(d.action.status)) break;
        if (Date.now() > deadline) throw new Error("No result after 60 s — is the worker running? (pnpm dev:worker)");
        await new Promise((r) => setTimeout(r, 400));
      }
      setElapsed(Date.now() - t0);
      void onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const done = stepsDone(detail);
  const status = detail?.action.status;
  const failed = status !== undefined && TERMINAL.has(status) && status !== "SUCCEEDED";

  return (
    <div className="card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">End-to-end test</h3>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
            Sends one harmless test action through the real pipeline and shows each step. Choose a failure to see the
            system recover without sending twice.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            value={simulate}
            onChange={(e) => setSimulate(e.target.value as Simulate)}
            disabled={running}
            className="h-9 rounded-full border border-line-strong bg-surface px-3 text-sm"
            aria-label="Simulate a failure"
          >
            <option value="">Normal run</option>
            <option value="rate-limit">Provider says “slow down” (429)</option>
            <option value="lost-response">Provider sends, reply is lost</option>
          </select>
          <button type="button" onClick={() => void run()} disabled={running} className="btn btn-primary">
            {running ? <Loader className="size-4 animate-spin" /> : <Play className="size-4" />}
            {running ? "Running…" : "Run test"}
          </button>
        </div>
      </div>

      {started !== null && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <ol className="space-y-3">
            {STEPS.map((step, i) => {
              const state = i < done ? "done" : i === done && running ? "active" : failed && i === done ? "failed" : "todo";
              return (
                <li key={step.key} className="flex gap-3">
                  <span
                    className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                      state === "done" ? "bg-brand-soft text-brand" : state === "failed" ? "bg-danger-soft text-danger" : "border border-line-strong text-faint"
                    }`}
                  >
                    {state === "done" ? <Check className="size-3" /> : state === "active" ? <Loader className="size-3 animate-spin" /> : state === "failed" ? <X className="size-3" /> : null}
                  </span>
                  <div>
                    <div className={`text-sm ${state === "todo" ? "text-muted" : ""}`}>{step.label}</div>
                    <div className="text-xs text-faint">{step.detail}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="space-y-3">
            {detail && (
              <div className="rounded-xl bg-raised p-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Status: <b className={status === "SUCCEEDED" ? "text-brand" : failed ? "text-danger" : ""}>{status}</b>
                  </span>
                  <span className="text-muted">Attempts: {detail.action.attemptCount}</span>
                  {detail.providerCalls !== null && (
                    <span className={detail.providerCalls === 1 ? "text-brand" : "text-muted"}>
                      Provider calls: {detail.providerCalls}
                      {detail.providerCalls === 1 && status === "SUCCEEDED" ? " — exactly once ✓" : ""}
                    </span>
                  )}
                  {elapsed !== null && <span className="text-muted">Took {(elapsed / 1000).toFixed(1)} s</span>}
                </div>
                {detail.action.statusReason && <p className="mt-2 text-xs text-muted">{detail.action.statusReason}</p>}
                {detail.action.lastError && status !== "SUCCEEDED" && <p className="mt-1 text-xs text-amber">Last error: {detail.action.lastError}</p>}
              </div>
            )}
            {detail && detail.events.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-faint">Event trail (one correlation ID)</div>
                <ul className="mt-2 space-y-1.5 font-mono text-xs">
                  {detail.events.map((e) => (
                    <li key={e.id} className="flex justify-between gap-3">
                      <span>{e.eventType}</span>
                      <span className="text-faint">+{new Date(e.occurredAt).getTime() - new Date(detail.events[0]!.occurredAt).getTime()} ms</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Queues({ overview }: { overview: Overview | null }) {
  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold">Queues</h3>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1.5 font-medium">Queue</th>
            <th className="py-1.5 text-right font-medium">Waiting</th>
            <th className="py-1.5 text-right font-medium">Running</th>
            <th className="py-1.5 text-right font-medium">Scheduled</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(overview?.queues ?? []).map((q) => (
            <tr key={q.name}>
              <td className="py-2 capitalize">{q.name}</td>
              {q.error ? (
                <td colSpan={3} className="py-2 text-right text-xs text-danger">
                  {q.error}
                </td>
              ) : (
                <>
                  <td className="py-2 text-right tabular-nums">{q.waiting}</td>
                  <td className="py-2 text-right tabular-nums">{q.active}</td>
                  <td className="py-2 text-right tabular-nums">{q.delayed}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-faint">More queues (research, discovery, AI…) appear as their phases are built.</p>
    </div>
  );
}

function Workers({ overview }: { overview: Overview | null }) {
  const workers = overview?.workers;
  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold">Workers</h3>
      {workers === null ? (
        <p className="mt-3 text-sm text-danger">Can’t read worker heartbeats — is Redis up?</p>
      ) : workers && workers.length === 0 ? (
        <p className="mt-3 text-sm text-danger">No worker is running. Start it with <code className="font-mono">pnpm dev:worker</code>.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {(workers ?? []).map((w) => (
            <li key={w.workerId} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="size-2 rounded-full bg-brand" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{w.workerId}</span>
              <span className="text-xs text-muted">{w.queues.join(", ")}</span>
              <span className="text-xs text-faint">{formatAge(Date.now() - new Date(w.lastHeartbeatAt).getTime())} ago</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CATEGORY_HELP: Record<string, string> = {
  TRANSIENT: "Temporary problem — kept retrying until the limit",
  RATE_LIMIT: "Provider kept asking us to slow down",
  AUTH: "Integration needs reconnecting",
  VALIDATION: "The data was invalid — retrying won’t fix it",
  NOT_FOUND: "The record it was about no longer exists",
  PERMANENT: "Can never succeed as configured",
  UNKNOWN: "Unexpected error",
};

function DeadLetters({ rows, canManage, onChange }: { rows: DeadLetter[]; canManage: boolean; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "retry" | "ignore") {
    setBusy(id);
    setError(null);
    try {
      await api(`/system/dead-letters/${id}/${action}`, { method: "POST", body: "{}" });
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold">Failed jobs</h3>
      <p className="mt-1 text-xs text-muted">Jobs that ran out of retries or can never succeed. Retrying re-checks everything first — it can’t do anything the current state doesn’t allow.</p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      {rows.length === 0 ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-raised px-4 py-5 text-sm text-muted">
          <Inbox className="size-4" /> No failed jobs.
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{d.jobName}</span>
                  <span className="badge" title={CATEGORY_HELP[d.failureCategory]}>
                    {d.failureCategory.replace("_", " ").toLowerCase()}
                  </span>
                  <span className="text-xs text-faint">
                    {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                    {d.retryCount ? ` · retried ${d.retryCount}×` : ""} · {formatAge(Date.now() - new Date(d.lastFailedAt).getTime())} ago
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-danger">{d.lastError}</div>
                {d.entityType && (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-faint">
                    {d.entityType.toLowerCase()} {d.entityId} · correlation {d.correlationId}
                  </div>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={busy === d.id} onClick={() => void act(d.id, "retry")} className="btn btn-secondary h-8">
                    <RotateCcw className="size-3.5" /> Retry
                  </button>
                  <button type="button" disabled={busy === d.id} onClick={() => void act(d.id, "ignore")} className="btn btn-ghost h-8">
                    Dismiss
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
