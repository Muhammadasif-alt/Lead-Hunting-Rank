"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  CircleAlert,
  Database,
  HardDrive,
  Loader,
  Mail,
  MailCheck,
  Plug,
  Plus,
  Power,
  RefreshCw,
  Stethoscope,
  Unplug,
} from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

// ── API shapes (GET/POST /api/v1/integrations/…) ──────────────────────────────────────────────

type HealthState = "HEALTHY" | "DEGRADED" | "RATE_LIMITED" | "AUTH_REQUIRED" | "UNAVAILABLE";

interface CatalogEntry {
  key: string;
  name: string;
  category: string;
  capabilities: string[];
  costModel: string;
  connection: "NONE" | "API_KEY" | "OAUTH";
  fake: boolean;
  status: "AVAILABLE" | "PLANNED";
  plannedPhase?: number;
  description: string;
  connectable: boolean;
}

interface Integration {
  id: string;
  provider: string;
  category: string;
  name: string;
  status: string;
  capabilities: string[];
  lastHealthCheckAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  health: { capability: string; state: HealthState; reason: string | null; checkedAt: string }[];
  usage24h: { calls: number; failures: number; avgLatencyMs: number | null; costMinor: number | null };
}

interface Check {
  capability: string;
  ok: boolean;
  state: HealthState;
  detail?: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message: string } } | null;
  if (!res.ok) throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body?.data as T;
}

const CATEGORY_ICON: Record<string, ComponentType<{ className?: string }>> = {
  EMAIL: Mail,
  CALENDAR: CalendarDays,
  LEAD_DATA: Database,
  VERIFICATION: MailCheck,
  AI: Bot,
  STORAGE: HardDrive,
  NOTIFICATIONS: Bell,
};

const CAPABILITY_LABEL: Record<string, string> = {
  EMAIL_SEND: "Send email",
  EMAIL_READ: "Read email",
  CALENDAR_READ: "Read availability",
  CALENDAR_WRITE: "Create events",
  COMPANY_SEARCH: "Company search",
  COMPANY_ENRICH: "Company enrichment",
  PERSON_ENRICH: "Person enrichment",
  EMAIL_VERIFY: "Email verification",
  LLM_REASONING: "Reasoning",
  LLM_EXTRACTION: "Extraction",
  EMBEDDINGS: "Embeddings",
  STORAGE: "File storage",
  NOTIFY: "Notifications",
};

const HEALTH: Record<HealthState, { label: string; className: string }> = {
  HEALTHY: { label: "Healthy", className: "border-brand/25 bg-brand-soft text-brand" },
  DEGRADED: { label: "Degraded", className: "border-amber/30 bg-amber-soft text-amber" },
  RATE_LIMITED: { label: "Rate-limited", className: "border-amber/30 bg-amber-soft text-amber" },
  AUTH_REQUIRED: { label: "Needs reconnect", className: "border-danger/30 bg-danger-soft text-danger" },
  UNAVAILABLE: { label: "Unavailable", className: "border-danger/30 bg-danger-soft text-danger" },
};

const STATUS: Record<string, { label: string; dot: string }> = {
  ACTIVE: { label: "Connected", dot: "bg-brand" },
  DEGRADED: { label: "Degraded", dot: "bg-amber" },
  RATE_LIMITED: { label: "Rate-limited", dot: "bg-amber" },
  AUTH_EXPIRED: { label: "Needs reconnect", dot: "bg-danger" },
  ERROR: { label: "Unavailable", dot: "bg-danger" },
  DISABLED: { label: "Disabled", dot: "bg-faint" },
  DISCONNECTED: { label: "Disconnected", dot: "bg-faint" },
  CONNECTING: { label: "Connecting", dot: "bg-faint" },
};

const NEEDS_ATTENTION = new Set(["DEGRADED", "RATE_LIMITED", "AUTH_EXPIRED", "ERROR"]);

/**
 * Integrations (screen #15, Phase 5): connected providers with per-capability health, 24 h usage and the actions the
 * user is allowed (integration.manage). Credentials never reach the browser.
 */
export function Integrations() {
  const me = useMe();
  const canRead = me.permissions.includes("integration.read");
  const canManage = me.permissions.includes("integration.manage");
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, i] = await Promise.all([
        api<CatalogEntry[]>("/integrations/catalog"),
        api<Integration[]>("/integrations"),
      ]);
      setCatalog(c);
      setIntegrations(i);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  const screen = findScreen("/integrations");
  const live = (integrations ?? []).filter((i) => i.status !== "DISCONNECTED");
  const liveKeys = new Set(live.map((i) => i.provider));
  const available = (catalog ?? []).filter((p) => p.status === "AVAILABLE" && !liveKeys.has(p.key));
  const planned = (catalog ?? []).filter((p) => p.status === "PLANNED");
  const byKey = new Map((catalog ?? []).map((p) => [p.key, p]));

  return (
    <div className="space-y-8">
      <PageHeader
        screen={screen}
        actions={
          canRead && (
            <button type="button" onClick={() => void load()} disabled={loading} className="btn btn-secondary">
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )
        }
      />

      {!canRead ? (
        <div className="card px-5 py-4 text-sm text-muted">
          You don&apos;t have permission to view integrations. Ask a workspace owner or admin.
        </div>
      ) : (
        <>
          {error && (
            <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <CircleAlert className="size-4 shrink-0" /> {error}
            </div>
          )}

          <Summary integrations={integrations} />

          <section className="space-y-4">
            <h2 className="text-base font-semibold">Connected</h2>
            {integrations === null ? (
              <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
                <Loader className="size-4 animate-spin" /> Loading…
              </div>
            ) : live.length === 0 ? (
              <div className="card flex items-center gap-3 px-5 py-5 text-sm text-muted">
                <Plug className="size-4 shrink-0" /> Nothing connected yet.
                {canManage ? " Connect a provider below." : ""}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {live.map((i) => (
                  <IntegrationCard
                    key={i.id}
                    integration={i}
                    definition={byKey.get(i.provider)}
                    canManage={canManage}
                    onChange={load}
                  />
                ))}
              </div>
            )}
          </section>

          {available.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold">Available</h2>
                <p className="mt-1 text-sm text-muted">
                  Test providers simulate a vendor with repeatable data, so features can be built and tested without
                  touching real inboxes or paying for data.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {available.map((p) => (
                  <AvailableCard
                    key={p.key}
                    entry={p}
                    reconnect={(integrations ?? []).some((i) => i.provider === p.key && i.status === "DISCONNECTED")}
                    canManage={canManage}
                    onChange={load}
                  />
                ))}
              </div>
            </section>
          )}

          {planned.length > 0 && (
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Coming later</h2>
              <ul className="card divide-y divide-line">
                {planned.map((p) => {
                  const Icon = CATEGORY_ICON[p.category] ?? Plug;
                  return (
                    <li key={p.key} className="flex items-center gap-3 px-5 py-3.5">
                      <Icon className="size-4 shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="truncate text-xs text-muted">{p.description}</div>
                      </div>
                      <span className="badge shrink-0">Phase {p.plannedPhase}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-xs leading-relaxed text-faint">
            Every provider call goes through the Provider Gateway: timeouts, rate limits and a circuit breaker stop
            failure storms, and each call is recorded for usage and cost. Health is tracked per capability — a mailbox
            can read fine while sending is rate-limited. Credentials never reach the browser or the AI.
          </p>
        </>
      )}
    </div>
  );
}

function Summary({ integrations }: { integrations: Integration[] | null }) {
  const live = (integrations ?? []).filter((i) => i.status !== "DISCONNECTED");
  const n = (v: number) => (integrations ? v.toLocaleString() : "—");
  const attention = live.filter((i) => NEEDS_ATTENTION.has(i.status)).length;
  const calls = live.reduce((s, i) => s + i.usage24h.calls, 0);
  const failures = live.reduce((s, i) => s + i.usage24h.failures, 0);
  const tiles = [
    { label: "Connected", value: n(live.filter((i) => i.status !== "DISABLED").length), hint: "active integrations" },
    {
      label: "Need attention",
      value: n(attention),
      hint: attention ? "see the cards below" : "all healthy",
      alert: attention > 0,
    },
    { label: "Provider calls", value: n(calls), hint: "last 24 hours" },
    { label: "Failed calls", value: n(failures), hint: "last 24 hours", alert: failures > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={`card p-4 ${t.alert ? "border-amber/40" : ""}`}>
          <div className="text-xs text-muted">{t.label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${t.alert ? "text-amber" : ""}`}>
            {t.value}
          </div>
          <div className="mt-0.5 text-xs text-faint">{t.hint}</div>
        </div>
      ))}
    </div>
  );
}

function IntegrationCard({
  integration: i,
  definition,
  canManage,
  onChange,
}: {
  integration: Integration;
  definition?: CatalogEntry;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const Icon = CATEGORY_ICON[i.category] ?? Plug;
  const status = STATUS[i.status] ?? { label: i.status, dot: "bg-faint" };
  const disabled = i.status === "DISABLED";

  async function act(action: "test" | "disable" | "enable" | "disconnect") {
    if (action === "disconnect" && !window.confirm(`Disconnect ${i.name}? New calls stop; history and usage are kept.`))
      return;
    setBusy(action);
    setError(null);
    try {
      if (action === "disconnect") await api(`/integrations/${i.id}`, { method: "DELETE" });
      else {
        const res = await api<{ checks?: Check[] }>(`/integrations/${i.id}/${action}`, { method: "POST", body: "{}" });
        setChecks(action === "test" ? (res.checks ?? null) : null);
      }
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const healthFor = (capability: string) => i.health.find((h) => h.capability === capability);

  return (
    <div className={`card flex flex-col p-5 ${NEEDS_ATTENTION.has(i.status) ? "border-amber/40" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-raised">
          <Icon className="size-5 text-tone" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{i.name}</h3>
            {definition?.fake && <span className="badge">Test provider</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <span className={`size-1.5 rounded-full ${status.dot}`} /> {status.label}
            {i.lastHealthCheckAt && <span className="text-faint">· checked {formatAge(i.lastHealthCheckAt)} ago</span>}
          </div>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {i.capabilities.map((c) => {
          const h = healthFor(c);
          const style = h ? HEALTH[h.state] : null;
          return (
            <li key={c} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">{CAPABILITY_LABEL[c] ?? c}</span>
              {disabled ? (
                <span className="badge">Off</span>
              ) : style ? (
                <span className={`badge ${style.className}`} title={h?.reason ?? undefined}>
                  {style.label}
                </span>
              ) : (
                <span className="badge">Not checked</span>
              )}
            </li>
          );
        })}
      </ul>
      {!disabled && i.health.some((h) => h.state !== "HEALTHY" && h.reason) && (
        <p className="mt-2 text-xs text-amber">{i.health.find((h) => h.state !== "HEALTHY" && h.reason)?.reason}</p>
      )}

      <dl className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-raised px-4 py-3 text-xs">
        <div>
          <dt className="text-faint">Calls · 24 h</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {i.usage24h.calls.toLocaleString()}
            {i.usage24h.failures > 0 && <span className="text-amber"> ({i.usage24h.failures} failed)</span>}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Avg latency</dt>
          <dd className="mt-0.5 font-medium tabular-nums">
            {i.usage24h.avgLatencyMs === null ? "—" : `${i.usage24h.avgLatencyMs} ms`}
          </dd>
        </div>
        <div>
          <dt className="text-faint">Cost · 24 h</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{formatCost(i.usage24h.costMinor, definition?.costModel)}</dd>
        </div>
      </dl>

      {checks && (
        <ul className="mt-3 space-y-1 text-xs">
          {checks.map((c) => (
            <li key={c.capability} className={c.ok ? "text-brand" : "text-danger"}>
              {c.ok ? "✓" : "✗"} {CAPABILITY_LABEL[c.capability] ?? c.capability}
              {c.detail ? <span className="text-muted"> — {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {!disabled && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void act("test")}
              className="btn btn-secondary h-8"
            >
              {busy === "test" ? <Loader className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}{" "}
              Test
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act(disabled ? "enable" : "disable")}
            className="btn btn-ghost h-8"
          >
            <Power className="size-3.5" /> {disabled ? "Enable" : "Disable"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void act("disconnect")}
            className="btn btn-ghost h-8 sm:ml-auto"
          >
            <Unplug className="size-3.5" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function AvailableCard({
  entry: p,
  reconnect,
  canManage,
  onChange,
}: {
  entry: CatalogEntry;
  reconnect: boolean;
  canManage: boolean;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = CATEGORY_ICON[p.category] ?? Plug;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api(`/integrations/${p.key}/connect`, { method: "POST", body: "{}" });
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised">
          <Icon className="size-4 text-tone" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{p.name}</h3>
          <div className="text-xs text-faint">{p.capabilities.map((c) => CAPABILITY_LABEL[c] ?? c).join(" · ")}</div>
        </div>
      </div>
      <p className="mt-3 flex-1 text-xs leading-relaxed text-muted">{p.description}</p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {canManage && p.connectable && (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="btn btn-secondary mt-4 h-8 self-start"
        >
          {busy ? <Loader className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{" "}
          {reconnect ? "Reconnect" : "Connect"}
        </button>
      )}
      {!p.connectable && <span className="badge mt-4 self-start">Not available in this environment</span>}
    </div>
  );
}

function formatCost(costMinor: number | null, costModel?: string): string {
  if (costMinor !== null) return `$${(costMinor / 100).toFixed(2)}`;
  if (costModel === "FREE") return "Free";
  return "Unknown";
}

function formatAge(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}
