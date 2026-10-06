"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleAlert, Loader, Lock, OctagonX, PauseCircle, PlayCircle, ShieldCheck } from "lucide-react";
import {
  AUTONOMY_INFO,
  AUTONOMY_LEVELS,
  OUTBOUND_INFO,
  type AutonomyLevel,
  type OutboundState,
  type PolicySettings,
} from "@revenue-os/shared";
import { OUTBOUND_CHANGED } from "@/components/app/OutboundBanner";
import { errorMessage, patch, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import {
  ACTION_LABEL,
  actorLabel,
  OUTCOME_LABEL,
  OUTCOME_STYLE,
  WEEKDAYS,
  type OutboundInfo,
  type PolicyDecisionRow,
  type PolicyOverview,
  type SimulationResult,
} from "@/lib/policy";

// ───────────────────────────── kill switch ─────────────────────────────

const TRANSITION_PERMISSION = (from: OutboundState, to: OutboundState) =>
  to === "EMERGENCY_STOP"
    ? "outbound.emergency_stop"
    : from === "EMERGENCY_STOP"
      ? "outbound.resume"
      : "outbound.pause";

/** Pause / emergency stop / resume (screen #17 §82-90). Stopping asks for a reason; resuming revalidates everything waiting. */
export function OutboundControl({
  outbound,
  permissions,
  onChanged,
}: {
  outbound: OutboundInfo;
  permissions: string[];
  onChanged: () => void;
}) {
  const [target, setTarget] = useState<OutboundState | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = outbound.state;
  const can = (to: OutboundState) => permissions.includes(TRANSITION_PERMISSION(state, to));

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await post("/policy/outbound", { state: target, reason: target === "ACTIVE" ? null : reason.trim() });
      setTarget(null);
      setReason("");
      window.dispatchEvent(new Event(OUTBOUND_CHANGED));
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const Icon = state === "EMERGENCY_STOP" ? OctagonX : state === "PAUSED" ? PauseCircle : ShieldCheck;
  const tone = state === "EMERGENCY_STOP" ? "border-danger/40" : state === "PAUSED" ? "border-amber/40" : "";
  const options: { to: OutboundState; label: string; icon: typeof PauseCircle; danger?: boolean }[] =
    state === "ACTIVE"
      ? [
          { to: "PAUSED", label: "Pause outbound", icon: PauseCircle },
          { to: "EMERGENCY_STOP", label: "Emergency stop", icon: OctagonX, danger: true },
        ]
      : state === "PAUSED"
        ? [
            { to: "ACTIVE", label: "Resume outbound", icon: PlayCircle },
            { to: "EMERGENCY_STOP", label: "Emergency stop", icon: OctagonX, danger: true },
          ]
        : [{ to: "ACTIVE", label: "Resume outbound", icon: PlayCircle }];

  return (
    <div className={`card p-5 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-tone/20 bg-tone-soft">
            <Icon
              className={`size-5 ${state === "EMERGENCY_STOP" ? "text-danger" : state === "PAUSED" ? "text-amber" : "text-tone"}`}
            />
          </div>
          <div className="min-w-0">
            <div className="font-semibold">{OUTBOUND_INFO[state].label}</div>
            <p className="text-sm text-muted">{OUTBOUND_INFO[state].description}</p>
            {state !== "ACTIVE" && (
              <p className="mt-1 text-xs text-faint">
                {outbound.reason ? `“${outbound.reason}”` : "No reason given"}
                {outbound.changedBy ? ` · ${outbound.changedBy}` : ""}
                {outbound.changedAt ? ` · ${formatAgo(outbound.changedAt)}` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {options.map((o) =>
            can(o.to) ? (
              <button
                key={o.to}
                type="button"
                className={`btn ${o.danger ? "border-danger/40 bg-danger text-white hover:bg-danger/90" : "btn-secondary"}`}
                onClick={() => {
                  setTarget(o.to);
                  setError(null);
                }}
              >
                <o.icon className="size-4" /> {o.label}
              </button>
            ) : (
              <span key={o.to} className="inline-flex items-center gap-1.5 text-xs text-faint">
                <Lock className="size-3.5" /> {o.label}:{" "}
                {o.to === "ACTIVE" && state === "EMERGENCY_STOP" ? "owner only" : "not allowed for your role"}
              </span>
            ),
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-faint">
        Inbound email, research, scoring and manual work keep running while outbound is stopped.
      </p>

      {target && (
        <div className="mt-4 space-y-3 rounded-lg border border-line bg-raised p-4">
          <div className="text-sm font-medium">
            {target === "ACTIVE"
              ? "Resume outbound? Waiting messages are checked again one by one — nothing is sent blindly."
              : target === "EMERGENCY_STOP"
                ? "Emergency stop blocks every outbound action, including queued ones. Only an owner can resume."
                : "Pause outbound? New and queued messages wait until it is resumed."}
          </div>
          {target !== "ACTIVE" && (
            <label className="block text-sm">
              <span className="text-muted">Why? (shown to everyone)</span>
              <input
                className="input mt-1 w-full"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Checking a complaint"
              />
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || (target !== "ACTIVE" && !reason.trim())}
              onClick={() => void confirm()}
            >
              {busy && <Loader className="size-4 animate-spin" />} Confirm
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setTarget(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── autonomy + rules + simulator ─────────────────────────────

/** Autonomy preset and configurable rules (docs/10 §35-36), previewed with the simulator before saving. */
export function PolicyEditor({
  overview,
  canManage,
  onSaved,
}: {
  overview: PolicyOverview;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [level, setLevel] = useState<AutonomyLevel>(overview.autonomyLevel);
  const [s, setS] = useState<PolicySettings>(overview.settings);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = level !== overview.autonomyLevel || JSON.stringify(s) !== JSON.stringify(overview.settings);

  useEffect(() => {
    // Show today's decisions for the fixed scenarios straight away (draft = current).
    post<SimulationResult>("/policy/simulate", {})
      .then(setSim)
      .catch(() => undefined);
  }, [overview.policyVersion]);

  async function preview() {
    setBusy("preview");
    setError(null);
    try {
      setSim(await post<SimulationResult>("/policy/simulate", { autonomyLevel: level, settings: s }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      await patch("/policy", { autonomyLevel: level, settings: s });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const set = <K extends keyof PolicySettings>(k: K, v: PolicySettings[K]) => {
    setS((prev) => ({ ...prev, [k]: v }));
    setSaved(false);
  };
  const win = s.sendWindow;
  const disabled = !canManage;

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Autonomy level</h3>
          <span className="text-xs text-faint">Policy v{overview.policyVersion}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          A starting preset for the whole workspace. An agent can be set lower, never higher. Hard rules apply at every
          level.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {AUTONOMY_LEVELS.map((l) => (
            <label
              key={l}
              className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition-colors ${level === l ? "border-tone/40 bg-tone-soft" : "border-line hover:bg-hover"} ${disabled ? "cursor-default opacity-80" : ""}`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="autonomy"
                  className="accent-current"
                  checked={level === l}
                  disabled={disabled}
                  onChange={() => {
                    setLevel(l);
                    setSaved(false);
                  }}
                />
                {l} · {AUTONOMY_INFO[l].label}
              </span>
              <span className="mt-1 text-xs text-muted">{AUTONOMY_INFO[l].description}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold">Outbound rules</h3>
        <p className="mt-1 text-sm text-muted">
          These you can change. They apply to every outbound message, by a person or the AI.
        </p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={s.firstTouchApproval}
              disabled={disabled}
              onChange={(e) => set("firstTouchApproval", e.target.checked)}
            />
            <span>
              <span className="font-medium">AI first messages need approval</span>
              <span className="block text-muted">
                The first email the AI sends to a new contact waits for a person, at any autonomy level.
              </span>
            </span>
          </label>
          <div className="text-sm">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={win.enabled}
                disabled={disabled}
                onChange={(e) => set("sendWindow", { ...win, enabled: e.target.checked })}
              />
              <span>
                <span className="font-medium">Send only in working hours</span>
                <span className="block text-muted">
                  Workspace time zone ({overview.timezone}). Outside these hours messages wait.
                </span>
              </span>
            </label>
            {win.enabled && (
              <div className="mt-3 space-y-2 pl-7">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input h-9 w-24"
                    value={win.startHour}
                    disabled={disabled}
                    onChange={(e) => set("sendWindow", { ...win, startHour: Number(e.target.value) })}
                    aria-label="From hour"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{`${h}:00`}</option>
                    ))}
                  </select>
                  <span className="text-muted">to</span>
                  <select
                    className="input h-9 w-24"
                    value={win.endHour}
                    disabled={disabled}
                    onChange={(e) => set("sendWindow", { ...win, endHour: Number(e.target.value) })}
                    aria-label="To hour"
                  >
                    {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                      <option key={h} value={h}>{`${h}:00`}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      disabled={disabled}
                      aria-pressed={win.days.includes(i)}
                      className={`badge cursor-pointer ${win.days.includes(i) ? "border-tone/30 bg-tone-soft text-tone" : ""}`}
                      onClick={() =>
                        set("sendWindow", {
                          ...win,
                          days: win.days.includes(i) ? win.days.filter((x) => x !== i) : [...win.days, i].sort(),
                        })
                      }
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <NumberField
            label="Daily sending limit"
            hint="Emails per day for the whole workspace. Empty = no limit."
            value={s.dailySendLimit}
            nullable
            disabled={disabled}
            onChange={(v) => set("dailySendLimit", v)}
          />
          <NumberField
            label="Cool-down per contact (days)"
            hint="Minimum days between two messages to the same address."
            value={s.contactCooldownDays}
            disabled={disabled}
            onChange={(v) => set("contactCooldownDays", v ?? 0)}
          />
          <NumberField
            label="Approvals stay valid (hours)"
            hint="After this an undecided or unused approval expires."
            value={s.approvalTtlHours}
            disabled={disabled}
            onChange={(v) => set("approvalTtlHours", v ?? 24)}
          />
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-danger">
            <CircleAlert className="size-4" /> {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {canManage ? (
            <>
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void preview()}>
                {busy === "preview" && <Loader className="size-4 animate-spin" />} Preview changes
              </button>
              <button type="button" className="btn btn-primary" disabled={!dirty || !!busy} onClick={() => void save()}>
                {busy === "save" && <Loader className="size-4 animate-spin" />} Save as v{overview.policyVersion + 1}
              </button>
              {saved && !dirty && <span className="text-sm text-brand">Saved</span>}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-faint">
              <Lock className="size-3.5" /> Only owners and admins change policies
            </span>
          )}
        </div>
      </div>

      {sim && <SimulationView sim={sim} dirty={dirty} />}
    </div>
  );
}

function NumberField({
  label,
  hint,
  value,
  nullable,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  nullable?: boolean;
  disabled?: boolean;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <span className="block text-muted">{hint}</span>
      <input
        type="number"
        min={0}
        className="input mt-2 h-9 w-32"
        value={value ?? ""}
        placeholder={nullable ? "No limit" : undefined}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.trim();
          onChange(v === "" ? (nullable ? null : 0) : Math.max(0, Math.floor(Number(v))));
        }}
      />
    </label>
  );
}

function Outcome({ d }: { d: { decision: keyof typeof OUTCOME_STYLE } }) {
  return <span className={`badge shrink-0 ${OUTCOME_STYLE[d.decision]}`}>{OUTCOME_LABEL[d.decision]}</span>;
}

/** Policy simulator (docs/10 §76-92): fixed scenarios + replay of recent real decisions, current vs draft. */
function SimulationView({ sim, dirty }: { sim: SimulationResult; dirty: boolean }) {
  const changed = sim.scenarios.filter((x) => x.changed).length;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Policy simulator</h3>
        <span className="text-xs text-faint">Read-only — nothing is saved or sent</span>
      </div>
      <p className="mt-1 text-sm text-muted">
        {dirty || changed
          ? `With your draft, ${changed} of ${sim.scenarios.length} situations decide differently.`
          : "What the current policy decides in typical situations. Change a setting and press “Preview changes” to compare."}
      </p>
      <div className="mt-4 divide-y divide-line rounded-lg border border-line">
        {sim.scenarios.map((x) => (
          <div
            key={x.key}
            className={`flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center ${x.changed ? "bg-accent-soft" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium">{x.label}</div>
              <div className="truncate text-xs text-muted" title={x.draft.reasonSummary}>
                {x.draft.reasonSummary}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {x.changed && (
                <>
                  <Outcome d={x.current} />
                  <span className="text-faint">→</span>
                </>
              )}
              <Outcome d={x.draft} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 text-sm text-muted">
        {sim.history.replayed === 0 ? (
          "No real decisions to replay yet — they appear once outbound actions are requested."
        ) : (
          <>
            Replayed {sim.history.replayed} recent real decisions:{" "}
            {(["ACT", "ASK", "WAIT", "BLOCK"] as const)
              .map((k) => `${OUTCOME_LABEL[k]} ${sim.history.counts.current[k]}→${sim.history.counts.draft[k]}`)
              .join(" · ")}
            {sim.history.changes.length > 0 && ` · ${sim.history.changes.length} would change`}
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── hard rules + decisions ─────────────────────────────

export function HardRules({ rules }: { rules: PolicyOverview["hardRules"] }) {
  return (
    <div className="card p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <Lock className="size-4 text-tone" /> Hard rules
      </h3>
      <p className="mt-1 text-sm text-muted">No setting, role, approval or AI can loosen these.</p>
      <ul className="mt-3 space-y-2 text-sm">
        {rules.map((r) => (
          <li key={r.key} className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" />
            <span>{r.description}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-faint">
        Do-not-contact list:{" "}
        <Link href="/settings" className="text-accent hover:underline">
          Settings → Suppression
        </Link>
      </p>
    </div>
  );
}

/** Latest Policy Engine decisions, each with "Why?" — reason codes, matched rules, policy version. No chain of thought. */
export function Decisions({
  decisions,
  last7Days,
}: {
  decisions: PolicyDecisionRow[];
  last7Days: PolicyOverview["last7Days"];
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Policy decisions</h2>
        <span className="text-xs text-muted">
          Last 7 days:{" "}
          {(["ACT", "ASK", "WAIT", "BLOCK"] as const).map((k) => `${OUTCOME_LABEL[k]} ${last7Days[k]}`).join(" · ")}
        </span>
      </div>
      <div className="card divide-y divide-line">
        {decisions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">
            No decisions yet. Every outbound action is decided here — before it is queued and again right before it is
            sent.
          </p>
        ) : (
          decisions.map((d) => (
            <div key={d.id} className="px-5 py-3 text-sm">
              <button
                type="button"
                className="flex w-full items-start gap-3 text-left"
                onClick={() => setOpen(open === d.id ? null : d.id)}
                aria-expanded={open === d.id}
              >
                <Outcome d={d} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{ACTION_LABEL[d.actionType] ?? d.actionType}</span>
                    <span className="text-xs text-muted">by {actorLabel({ ...d.actor })}</span>
                    {d.entity.name && <span className="truncate text-xs text-muted">· {d.entity.name}</span>}
                    <span className="text-xs text-faint">
                      ·{" "}
                      {d.stage === "EXECUTION"
                        ? "right before sending"
                        : d.stage === "APPROVAL"
                          ? "on approval"
                          : "on request"}
                    </span>
                  </div>
                  <div className="truncate text-muted">{d.reasonSummary}</div>
                </div>
                <span className="shrink-0 text-xs text-faint">{formatAgo(d.evaluatedAt)}</span>
                <ChevronDown
                  className={`size-4 shrink-0 text-faint transition-transform ${open === d.id ? "rotate-180" : ""}`}
                />
              </button>
              {open === d.id && (
                <dl className="mt-3 grid gap-2 rounded-lg bg-raised p-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-faint">Why</dt>
                    <dd>{d.reasonSummary}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Reason codes</dt>
                    <dd className="font-mono">{d.reasonCodes.join(", ")}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Rules that matched</dt>
                    <dd className="font-mono">{d.matchedRules.length ? d.matchedRules.join(", ") : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-faint">Policy version · risk</dt>
                    <dd>
                      v{d.policyVersion} · {d.riskLevel.toLowerCase()}
                      {d.resumeAt ? ` · tries again ${new Date(d.resumeAt).toLocaleString()}` : ""}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
