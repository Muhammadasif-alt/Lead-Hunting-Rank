"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CircleAlert, CircleCheck, CircleX, Loader, Lock, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, patch } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

interface AgentRow {
  agentType: string;
  label: string;
  purpose: string;
  version: number;
  enabled: boolean;
  modelClass: string;
  modelConnected: boolean;
  allowedTools: { key: string; category: string; description: string }[];
  dailyRunLimit: number | null;
  prompt: { taskType: string; version: number } | null;
  today: {
    runs: number;
    rejected: number;
    failedRuns: number;
    tasksCompleted: number;
    tasksBlocked: number;
    tasksFailed: number;
    tokens: number;
    costMinor: number | null;
  };
}

interface AgentsResponse {
  models: { provider: string; name: string; capabilities: string[] }[];
  agents: AgentRow[];
  decisions: {
    id: string;
    agentType: string;
    actionType: string;
    decision: string;
    reasonSummary: string;
    model: string | null;
    promptVersion: number | null;
    passed: boolean;
    entity: { type: string; id: string; name: string | null };
    createdAt: string;
  }[];
}

const LATER = [
  { title: "Autonomy levels L0–L4", phase: 10 },
  { title: "Policies: ACT / ASK / WAIT / BLOCK", phase: 10 },
  { title: "Emergency stop (kill switch)", phase: 10 },
  { title: "Approvals and shadow mode", phase: 21 },
];

/**
 * AI Control Center (screen #17) — the Phase 9 slice: the agents, what each may do (tools, enforced on the server),
 * what they used today, and their latest decisions. Owners/admins can turn an agent off or cap its daily runs.
 */
export function AiControl() {
  const me = useMe();
  const canRead = me.permissions.includes("policy.read");
  const canManage = me.permissions.includes("policy.manage");
  const [data, setData] = useState<AgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AgentsResponse>("/ai/agents"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  async function change(agentType: string, body: { enabled?: boolean; dailyRunLimit?: number | null }) {
    setBusy(agentType);
    try {
      await patch(`/ai/agents/${agentType}`, body);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const screen = findScreen("/ai-control");
  const testOnly = data && data.models.length > 0 && data.models.every((m) => m.provider.startsWith("fake_"));

  return (
    <div className="space-y-8">
      <PageHeader
        screen={screen}
        actions={
          canRead && (
            <button type="button" onClick={() => void load()} className="btn btn-secondary">
              <RefreshCw className="size-4" /> Refresh
            </button>
          )
        }
      />
      {!canRead ? (
        <div className="card px-5 py-4 text-sm text-muted">You don&apos;t have permission to view the AI controls.</div>
      ) : (
        <>
          {error && (
            <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <CircleAlert className="size-4 shrink-0" /> {error}
            </div>
          )}
          {data && (
            <div className={`card px-4 py-3 text-sm ${data.models.length ? "" : "border-amber/40"}`}>
              {data.models.length === 0 ? (
                <span>
                  No AI model connected — agents wait until one is.{" "}
                  <Link href="/integrations" className="text-accent hover:underline">
                    Connect one in Integrations
                  </Link>
                  .
                </span>
              ) : (
                <span>
                  Model: {data.models.map((m) => m.name).join(", ")}
                  {testOnly && (
                    <span className="text-muted">
                      {" "}
                      — the test model answers with rules, checked by the same validators. Connect Anthropic Claude for
                      real AI.
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          <section className="space-y-4">
            <h2 className="text-base font-semibold">Agents</h2>
            {!data ? (
              <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
                <Loader className="size-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {data.agents.map((a) => (
                  <div key={a.agentType} className="card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-tone/20 bg-tone-soft">
                          <Bot className="size-4 text-tone" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {a.label} <span className="text-xs text-faint">v{a.version}</span>
                          </div>
                          <div className="text-sm text-muted">{a.purpose}</div>
                        </div>
                      </div>
                      <span className={`badge shrink-0 ${a.enabled ? "border-brand/25 bg-brand-soft text-brand" : ""}`}>
                        {a.enabled ? "On" : "Off"}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <Stat label="Runs today" value={a.today.runs} />
                      <Stat label="Completed" value={a.today.tasksCompleted} />
                      <Stat label="Blocked / failed" value={a.today.tasksBlocked + a.today.tasksFailed} />
                      <Stat label="Rejected answers" value={a.today.rejected} />
                    </dl>
                    <div className="mt-3 text-xs text-faint">
                      {a.modelClass.toLowerCase()} model{a.modelConnected ? "" : " (not connected)"} · prompt{" "}
                      {a.prompt ? `${a.prompt.taskType.toLowerCase()} v${a.prompt.version}` : "—"} · {a.today.tokens}{" "}
                      tokens today · cost{" "}
                      {a.today.costMinor === null ? "unknown" : `$${(a.today.costMinor / 100).toFixed(2)}`}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {a.allowedTools.map((t) => (
                        <span key={t.key} className="badge" title={t.description}>
                          <span className="text-faint">{t.category.toLowerCase()}</span> {t.key}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-secondary h-8"
                            disabled={busy === a.agentType}
                            onClick={() => void change(a.agentType, { enabled: !a.enabled })}
                          >
                            {busy === a.agentType && <Loader className="size-3.5 animate-spin" />}
                            {a.enabled ? "Turn off" : "Turn on"}
                          </button>
                          <label className="flex items-center gap-2 text-muted">
                            Daily runs
                            <input
                              type="number"
                              min={0}
                              className="input h-8 w-24"
                              defaultValue={a.dailyRunLimit ?? ""}
                              placeholder="No limit"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                const next = v === "" ? null : Math.max(0, Math.floor(Number(v)));
                                if (next !== a.dailyRunLimit) void change(a.agentType, { dailyRunLimit: next });
                              }}
                            />
                          </label>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-faint">
                          <Lock className="size-3.5" /> Only owners and admins change agents
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-base font-semibold">Latest AI decisions</h2>
            <div className="card divide-y divide-line">
              {!data || data.decisions.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">
                  No decisions yet. They appear after companies are researched.
                </p>
              ) : (
                data.decisions.map((d) => (
                  <div key={d.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                    {d.passed ? (
                      <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand" />
                    ) : (
                      <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{d.agentType.replace("_", " ").toLowerCase()}</span>
                        <span className="text-xs text-muted">{d.decision.toLowerCase()}</span>
                        {d.entity.type === "COMPANY" && (
                          <Link
                            href={`/companies/${d.entity.id}`}
                            className="truncate text-xs text-accent hover:underline"
                          >
                            {d.entity.name ?? "company"}
                          </Link>
                        )}
                      </div>
                      <div className="truncate text-muted">{d.reasonSummary}</div>
                    </div>
                    <span className="shrink-0 text-xs text-faint">{formatAgo(d.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold">Coming with later phases</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {LATER.map((l) => (
                <div key={l.title} className="card p-4 text-sm text-muted">
                  {l.title}
                  <div className="mt-1 text-xs text-faint">Phase {l.phase}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
