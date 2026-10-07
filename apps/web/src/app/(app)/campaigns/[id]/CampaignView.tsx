"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleX,
  Loader,
  Pause,
  Play,
  Rocket,
  ShieldCheck,
  Square,
  UserPlus,
} from "lucide-react";
import type { PermissionKey } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import {
  ANGLE_LABEL,
  CAMPAIGN_STATUS,
  ENROLLMENT_STATUS,
  INBOUND_LABEL,
  MESSAGE_STATUS,
  OBJECTIVE_LABEL,
  type CampaignCheck,
  type CampaignDetail,
  type DraftPreview,
  type EnrollmentRow,
  type MessageStatus,
} from "@/lib/campaigns";
import { formatAgo } from "@/lib/crm";
import { OUTCOME_LABEL, OUTCOME_STYLE } from "@/lib/policy";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { CampaignEditor } from "../CampaignEditor";

type Tab = "overview" | "prospects" | "preview" | "setup";

/** One campaign (screen #6): controls by state, pre-launch checks, outcome funnel, live feed, prospects, dry run. */
export function CampaignView({ id }: { id: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [data, setData] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<CampaignDetail>(`/campaigns/${id}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);
  // A running campaign changes by itself (drafts, sends, replies) — keep the view fresh.
  useEffect(() => {
    if (data?.campaign.status !== "ACTIVE") return;
    const t = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(t);
  }, [data?.campaign.status, load]);

  async function command(name: string, path: string, body: unknown = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(name);
    setNotice(null);
    setError(null);
    try {
      const r = await post<Record<string, unknown>>(`/campaigns/${id}/${path}`, body);
      if (name === "launch" || name === "enroll")
        setNotice(`${String(r.enrolled ?? 0)} prospect(s) enrolled. Drafts start within a minute.`);
      if (name === "check") setNotice(r.ready ? "All checks passed — ready to launch." : "Some checks need attention.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const screen = findScreen("/campaigns");
  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader screen={screen} />
        {error ? (
          <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <CircleAlert className="size-4" /> {error}
          </div>
        ) : (
          <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading…
          </div>
        )}
      </div>
    );
  }
  const c = data.campaign;
  const status = CAMPAIGN_STATUS[c.status];
  const editable = c.status === "DRAFT" || c.status === "READY";

  const actions = (
    <div className="flex flex-wrap gap-2">
      {editable && can("campaign.create") && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!!busy}
          onClick={() => void command("check", "check")}
        >
          {busy === "check" ? <Loader className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Run
          checks
        </button>
      )}
      {c.status === "READY" && can("campaign.start") && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            void command(
              "launch",
              "launch",
              {},
              `Launch “${c.name}” and enroll up to ${c.cohortSize} prospects? Each email still goes through the Policy Engine (and approvals) before it is sent.`,
            )
          }
        >
          {busy === "launch" ? <Loader className="size-4 animate-spin" /> : <Rocket className="size-4" />} Launch
        </button>
      )}
      {c.status === "ACTIVE" && can("campaign.start") && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!!busy}
          onClick={() =>
            void command(
              "enroll",
              "enroll",
              { count: c.cohortSize },
              `Enroll up to ${c.cohortSize} more eligible prospects?`,
            )
          }
        >
          <UserPlus className="size-4" /> Add {c.cohortSize} more
        </button>
      )}
      {c.status === "ACTIVE" && can("campaign.pause") && (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!!busy}
          onClick={() => void command("pause", "pause", { reason: null })}
        >
          <Pause className="size-4" /> Pause
        </button>
      )}
      {c.status === "PAUSED" && can("campaign.start") && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() => void command("resume", "resume")}
        >
          <Play className="size-4" /> Resume
        </button>
      )}
      {(c.status === "ACTIVE" || c.status === "PAUSED") && can("campaign.pause") && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!!busy}
          onClick={() =>
            void command(
              "complete",
              "complete",
              { reason: null },
              "End this campaign? Pending emails are cancelled and it can never send again.",
            )
          }
        >
          <Square className="size-4" /> End
        </button>
      )}
      {(c.status === "COMPLETED" || editable) && can("campaign.create") && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={!!busy}
          onClick={() => void command("archive", "archive", {}, "Archive this campaign? History is kept.")}
        >
          Archive
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader screen={screen} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/campaigns" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" /> Campaigns
          </Link>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-xl font-semibold">
            {c.name} <span className={`badge ${status.className}`}>{status.label}</span>
          </h2>
          <p className="text-sm text-muted">
            {OBJECTIVE_LABEL[c.objective]} · {data.mailbox ? `from ${data.mailbox.name}` : "no mailbox"}
            {data.mailbox?.provider === "fake_email" ? " (test mailbox — nothing really leaves)" : ""}
            {c.statusReason ? ` · ${c.statusReason}` : ""}
          </p>
        </div>
        {actions}
      </div>
      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}

      <div role="tablist" aria-label="Campaign" className="flex gap-1 overflow-x-auto border-b border-line">
        {(
          [
            ["overview", "Overview"],
            ["prospects", `Prospects (${data.funnel.enrolled})`],
            ["preview", "Preview emails"],
            ["setup", editable ? "Setup" : "Settings"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${tab === key ? "border-tone text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview data={data} />}
      {tab === "prospects" && (
        <Prospects campaignId={id} testMailbox={data.mailbox?.provider === "fake_email"} onChange={() => void load()} />
      )}
      {tab === "preview" && <Preview campaignId={id} canPreview={can("campaign.create")} />}
      {tab === "setup" &&
        (editable && can("campaign.create") ? (
          <CampaignEditor
            key={c.version}
            detail={data}
            onSaved={() => void load().then(() => setNotice("Saved. Run the checks again before launching."))}
          />
        ) : (
          <Settings data={data} />
        ))}
    </div>
  );
}

function Checks({ checks, checkedAt }: { checks: CampaignCheck[]; checkedAt: string | null }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Pre-launch checks</h3>
        {checkedAt && <span className="text-xs text-faint">checked {formatAgo(checkedAt)}</span>}
      </div>
      <ul className="mt-3 space-y-2 text-sm">
        {checks.map((x) => (
          <li key={x.key} className="flex gap-2">
            {x.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
            ) : x.blocking ? (
              <CircleX className="mt-0.5 size-4 shrink-0 text-danger" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" />
            )}
            <span>
              <span className="font-medium">{x.label}</span> <span className="text-muted">— {x.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

function Overview({ data }: { data: CampaignDetail }) {
  const c = data.campaign;
  const f = data.funnel;
  return (
    <div className="space-y-6">
      {(c.status === "DRAFT" || c.status === "READY") &&
        (c.checks ? (
          <Checks checks={c.checks} checkedAt={c.checkedAt} />
        ) : (
          <div className="card px-5 py-4 text-sm text-muted">
            Set the campaign up, then press “Run checks”. Nothing is sent until you launch.
          </div>
        ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Enrolled" value={f.enrolled} />
        <Stat label="Contacted" value={f.contacted} />
        <Stat label="Replied" value={f.replied} hint="sequence stopped" />
        <Stat label="Unsubscribed" value={f.unsubscribed} />
        <Stat label="Bounced" value={f.bounced} />
        <Stat label="Finished" value={f.completed} hint="all steps sent" />
      </div>
      {data.messages.pendingApproval > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-2 border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <span>
            {data.messages.pendingApproval} email{data.messages.pendingApproval === 1 ? "" : "s"} wait for approval —
            the autonomy level or a rule says a person decides.
          </span>
          <Link href="/ai-control" className="font-medium text-accent hover:underline">
            Review in AI Control Center → Approvals
          </Link>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <section className="min-w-0 space-y-3">
          <h3 className="font-semibold">Live feed</h3>
          <div className="card divide-y divide-line">
            {data.feed.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">
                Nothing yet. After launch, drafts, sends, replies and skips show here.
              </p>
            ) : (
              data.feed.map((x) => (
                <div key={`${x.type}-${x.id}`} className="flex items-start gap-3 px-5 py-3 text-sm">
                  {x.type === "message" ? (
                    <span className={`badge shrink-0 ${MESSAGE_STATUS[x.status as MessageStatus]?.className ?? ""}`}>
                      {MESSAGE_STATUS[x.status as MessageStatus]?.label ?? x.status}
                    </span>
                  ) : (
                    <span className="badge shrink-0 border-accent/25 bg-accent-soft text-accent">
                      {INBOUND_LABEL[x.status] ?? x.status}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {x.type === "message" ? `Step ${x.position} to ` : "From "}
                      <span className="font-medium">{x.company ?? x.email}</span>
                      {x.company && <span className="text-muted"> ({x.email})</span>}
                    </div>
                    <div className="truncate text-xs text-muted">{x.reason ? x.reason : x.subject}</div>
                  </div>
                  <span className="shrink-0 text-xs text-faint">{formatAgo(x.at)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        <aside className="min-w-0 space-y-3">
          <h3 className="font-semibold">Emails</h3>
          <div className="card divide-y divide-line text-sm">
            {(
              [
                ["Sent", data.messages.sent],
                ["Waiting for approval", data.messages.pendingApproval],
                ["Queued", data.messages.queued],
                ["Waiting (hours, limits)", data.messages.waiting],
                ["Blocked by policy", data.messages.blocked],
                ["Cancelled", data.messages.cancelled],
                ["Drafts rejected by checks", data.messages.rejectedDrafts],
                ["Auto-replies (ignored)", data.inbound.autoReplies],
              ] as [string, number][]
            ).map(([label, n]) => (
              <div key={label} className="flex justify-between px-4 py-2">
                <span className="text-muted">{label}</span>
                <span className="tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Prospects({
  campaignId,
  testMailbox,
  onChange,
}: {
  campaignId: string;
  testMailbox: boolean;
  onChange: () => void;
}) {
  const me = useMe();
  const [rows, setRows] = useState<EnrollmentRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<EnrollmentRow[]>(`/campaigns/${campaignId}/enrollments`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [campaignId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(e: EnrollmentRow, path: string, body: unknown = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(e.id);
    setError(null);
    try {
      await post(`/campaigns/${campaignId}/enrollments/${e.id}/${path}`, body);
      await load();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!rows)
    return (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading…
      </div>
    );
  const live = (s: string) => ["ENROLLED", "ACTIVE", "PAUSED"].includes(s);
  return (
    <div className="space-y-3">
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="card px-5 py-4 text-sm text-muted">
          No prospects yet — they are enrolled when the campaign launches.
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((e) => (
            <div key={e.id} className="px-5 py-3 text-sm">
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left"
                aria-expanded={open === e.id}
                onClick={() => setOpen(open === e.id ? null : e.id)}
              >
                <span className={`badge ${ENROLLMENT_STATUS[e.status].className}`}>
                  {ENROLLMENT_STATUS[e.status].label}
                </span>
                <span className="min-w-0 truncate font-medium">{e.company.name ?? "Company"}</span>
                <span className="min-w-0 truncate text-muted">
                  {e.firstName ? `${e.firstName} · ` : ""}
                  {e.email}
                </span>
                <span className="ml-auto text-xs text-faint">
                  {e.status === "ACTIVE" && e.nextStepDueAt
                    ? `step ${e.nextStepPosition} ${new Date(e.nextStepDueAt) > new Date() ? `due ${new Date(e.nextStepDueAt).toLocaleDateString()}` : "preparing"}`
                    : e.lastSentAt
                      ? `last sent ${formatAgo(e.lastSentAt)}`
                      : ""}
                </span>
                <ChevronDown
                  className={`size-4 text-faint transition-transform ${open === e.id ? "rotate-180" : ""}`}
                />
              </button>
              {e.statusReason && e.status !== "ACTIVE" && <p className="mt-1 text-xs text-muted">{e.statusReason}</p>}
              {open === e.id && (
                <div className="mt-3 space-y-3">
                  {e.messages.length === 0 ? (
                    <p className="text-xs text-muted">No email drafted yet.</p>
                  ) : (
                    e.messages.map((m) => (
                      <div key={m.id} className="rounded-lg border border-line bg-raised p-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium">Step {m.position}</span>
                          <span className={`badge ${MESSAGE_STATUS[m.status].className}`}>
                            {MESSAGE_STATUS[m.status].label}
                          </span>
                          {m.sentAt && <span className="text-faint">sent {formatAgo(m.sentAt)}</span>}
                          {m.statusReason && <span className="text-muted">{m.statusReason}</span>}
                        </div>
                        {m.body && (
                          <>
                            <div className="mt-2 font-medium">{m.subject}</div>
                            <p className="mt-1 whitespace-pre-wrap break-words text-muted">{m.body}</p>
                          </>
                        )}
                        {m.claims.length > 0 && (
                          <ul className="mt-2 space-y-0.5 text-xs text-faint">
                            {m.claims.map((cl, i) => (
                              <li key={i}>
                                Evidence-backed: “{cl.text}” ({cl.evidenceIds.length} source
                                {cl.evidenceIds.length === 1 ? "" : "s"})
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                  <div className="flex flex-wrap gap-2">
                    {me.permissions.includes("company.update") &&
                      ["ACTIVE", "ENROLLED", "PAUSED", "COMPLETED"].includes(e.status) && (
                        <button
                          type="button"
                          className="btn btn-secondary h-8"
                          disabled={busy === e.id}
                          onClick={() =>
                            void act(e, "replied", {}, "Mark as replied? The cold sequence stops for good.")
                          }
                        >
                          Mark replied
                        </button>
                      )}
                    {me.permissions.includes("company.update") && e.status !== "SUPPRESSED" && (
                      <button
                        type="button"
                        className="btn btn-secondary h-8"
                        disabled={busy === e.id}
                        onClick={() =>
                          void act(
                            e,
                            "unsubscribed",
                            {},
                            `Record that ${e.email} unsubscribed? They go on the do-not-contact list.`,
                          )
                        }
                      >
                        Mark unsubscribed
                      </button>
                    )}
                    {me.permissions.includes("campaign.pause") && live(e.status) && (
                      <button
                        type="button"
                        className="btn btn-ghost h-8"
                        disabled={busy === e.id}
                        onClick={() =>
                          void act(e, "remove", { reason: null }, "Remove this prospect from the campaign?")
                        }
                      >
                        Remove
                      </button>
                    )}
                    {testMailbox && me.permissions.includes("campaign.create") && e.lastSentAt && (
                      <span className="flex flex-wrap items-center gap-1 border-l border-line pl-2 text-xs text-faint">
                        Test mailbox — simulate:
                        {(["REPLY", "UNSUBSCRIBE", "BOUNCE", "AUTO_REPLY"] as const).map((k) => (
                          <button
                            key={k}
                            type="button"
                            className="btn btn-ghost h-7 px-2 text-xs"
                            disabled={busy === e.id}
                            onClick={() => void act(e, "simulate", { kind: k })}
                          >
                            {k === "REPLY"
                              ? "a reply"
                              : k === "UNSUBSCRIBE"
                                ? "“unsubscribe me”"
                                : k === "BOUNCE"
                                  ? "a bounce"
                                  : "an auto-reply"}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Preview({ campaignId, canPreview }: { campaignId: string; canPreview: boolean }) {
  const [drafts, setDrafts] = useState<DraftPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setDrafts((await post<{ drafts: DraftPreview[] }>(`/campaigns/${campaignId}/preview`, { count: 3 })).drafts);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
        <p className="max-w-2xl text-muted">
          Dry run: the Campaign Agent drafts first emails for a few eligible prospects, the message checks run, and the
          Policy Engine says what it would decide. Nothing is sent or queued.
        </p>
        {canPreview && (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run()}>
            {busy && <Loader className="size-4 animate-spin" />} {drafts ? "Draft again" : "Draft 3 previews"}
          </button>
        )}
      </div>
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      {drafts?.length === 0 && (
        <div className="card px-5 py-4 text-sm text-muted">Nobody in the audience can be contacted yet.</div>
      )}
      {drafts?.map((d) => (
        <div key={d.company.id} className="card p-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{d.company.name}</span>
            <span className="text-muted">
              → {d.recipient.name}
              {d.recipient.title ? `, ${d.recipient.title}` : ""} ({d.recipient.email})
            </span>
            {d.policy && (
              <span className={`badge ml-auto ${OUTCOME_STYLE[d.policy.decision]}`} title={d.policy.reasonSummary}>
                Policy: {OUTCOME_LABEL[d.policy.decision]}
              </span>
            )}
          </div>
          {d.body ? (
            <div className="mt-3 rounded-lg border border-line bg-raised p-3">
              <div className="font-medium">{d.subject}</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-muted">{d.body}</p>
            </div>
          ) : (
            <p className="mt-3 text-danger">No usable draft: {d.reason}</p>
          )}
          {d.policy && <p className="mt-2 text-xs text-muted">Why: {d.policy.reasonSummary}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.validation.map((v) => (
              <span
                key={v.validator}
                className={`badge ${v.ok ? "" : "border-danger/25 bg-danger-soft text-danger"}`}
                title={v.detail}
              >
                {v.ok ? "✓" : "✗"} {v.validator.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Settings({ data }: { data: CampaignDetail }) {
  const c = data.campaign;
  return (
    <div className="card space-y-3 p-5 text-sm">
      <p className="text-muted">
        A launched campaign can’t be edited — end it and create a new one to change the approach.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-faint">Offer</dt>
          <dd>{c.offer || "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Ends with</dt>
          <dd>{c.strategy.cta || "Default question for the objective"}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">First cohort · new per day</dt>
          <dd>
            {c.cohortSize} · {c.dailyNewLimit}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Sequence</dt>
          <dd>
            {data.steps
              .map((s) =>
                s.position === 1 ? "first email" : `+${s.delayDays}d ${ANGLE_LABEL[s.angle]?.toLowerCase() ?? s.angle}`,
              )
              .join(" → ")}
          </dd>
        </div>
      </dl>
    </div>
  );
}
