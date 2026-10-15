"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Bell, Briefcase, Building2, CheckCircle2, CircleAlert, Eye, ExternalLink, FileSearch, Loader, Megaphone, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import {
  OPEN_SIGNAL_STATUSES,
  RECOMMENDED_ACTION_INFO,
  RELATIONSHIP_INFO,
  RULE_ACTION_INFO,
  SIGNAL_CATEGORY_INFO,
  SIGNAL_FEEDBACK,
  SIGNAL_FEEDBACK_LABEL,
  SIGNAL_STATUS_INFO,
  type Level,
  type PermissionKey,
  type SignalDetail,
  type SignalFeedbackKey,
} from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { ACT_LABEL, LEVEL_STYLE, levelText, shortDate, timeAgo } from "@/lib/signals";
import { StatusBadge, StrengthBadge, WindowBadge, relevanceText } from "../parts";

type Act = "RESEARCH" | "ATTACH_TO_DEAL" | "NOTIFY_OWNER" | "RE_ENGAGE" | "CAMPAIGN_CANDIDATE" | "VALIDATE" | "MONITOR";

/** One signal in full (screen #9 §4-5, §13, §32-35): fact vs interpretation, the evidence diff, explainable relevance. */
export function SignalView({ id }: { id: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canManage = can("signal.manage");
  const [s, setS] = useState<SignalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await api<SignalDetail>(`/signals/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  async function run(name: string, path: string, body: unknown, done: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await post(path, body);
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }
  const act = (a: Act) => void run(a, `/signals/${id}/act`, { action: a }, `${ACT_LABEL[a]} — done.`);

  const screen = findScreen("/signals");
  if (!s)
    return (
      <div className="space-y-5" data-tone="leads">
        <PageHeader screen={screen} />
        <BackLink />
        {error ? (
          <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            <CircleAlert className="size-4 shrink-0" /> {error}
          </div>
        ) : (
          <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
            <Loader className="size-4 animate-spin" /> Loading signal…
          </div>
        )}
      </div>
    );

  const open = OPEN_SIGNAL_STATUSES.includes(s.status);
  const candidateOk = s.relationship === "COLD" && s.status === "ACTIONABLE";
  const candidateWhy =
    s.relationship === "COLD"
      ? `Only actionable signals can become campaign candidates (this one is “${SIGNAL_STATUS_INFO[s.status].label.toLowerCase()}”).`
      : s.relationship === "CUSTOMER"
        ? "Customer protection — expansion goes to the account owner, never a cold campaign."
        : s.relationship === "IN_CONVERSATION" || s.relationship === "OPEN_DEAL"
          ? "Existing conversation protection — attach it to the deal or tell the owner instead."
          : "Not a cold prospect — re-engage through the relationship instead of a cold campaign.";
  const rec = RECOMMENDED_ACTION_INFO[s.recommendedAction];
  const busyIcon = (name: string, icon: ReactNode) => (busy === name ? <Loader className="size-4 animate-spin" /> : icon);

  return (
    <div className="space-y-5" data-tone="leads">
      <PageHeader screen={screen} />
      <BackLink />

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StrengthBadge strength={s.strength} />
          <span className="badge text-[10px]">{s.typeLabel}</span>
          <span className="badge text-[10px] text-faint">{SIGNAL_CATEGORY_INFO[s.category].label}</span>
          <StatusBadge status={s.status} />
          <WindowBadge s={s} />
          {s.campaignCandidate && <span className="badge border-accent/30 bg-accent-soft text-[10px] text-accent">Campaign candidate</span>}
        </div>
        <h2 className="text-xl font-semibold break-words">{s.title}</h2>
        <p className="text-sm text-muted">
          <Link href={`/companies/${s.companyId}?tab=signals`} className="inline-flex items-center gap-1 text-accent hover:underline">
            <Building2 className="size-3.5" /> {s.company}
          </Link>
          {[s.industry, s.city].filter(Boolean).length ? ` · ${[s.industry, s.city].filter(Boolean).join(" · ")}` : ""} · detected {timeAgo(s.detectedAt)}
        </p>
      </div>

      {canManage && open && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => act("RESEARCH")}>
              {busyIcon("RESEARCH", <FileSearch className="size-4" />)} Research
            </button>
            {s.opportunityId && (
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => act("ATTACH_TO_DEAL")}>
                {busyIcon("ATTACH_TO_DEAL", <Briefcase className="size-4" />)} Attach to deal
              </button>
            )}
            {s.relationship !== "COLD" && (
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => act("NOTIFY_OWNER")}>
                {busyIcon("NOTIFY_OWNER", <Bell className="size-4" />)} Notify owner
              </button>
            )}
            {(s.relationship === "LOST_DEAL" || s.relationship === "DORMANT" || s.relationship === "FORMER_CUSTOMER" || s.recommendedAction === "RE_ENGAGE") && (
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => act("RE_ENGAGE")}>
                {busyIcon("RE_ENGAGE", <RotateCcw className="size-4" />)} Re-engage
              </button>
            )}
            <button type="button" className="btn btn-secondary" disabled={!!busy || !candidateOk || s.campaignCandidate} title={candidateOk ? RECOMMENDED_ACTION_INFO.CAMPAIGN_CANDIDATE.description : candidateWhy} onClick={() => act("CAMPAIGN_CANDIDATE")}>
              {busyIcon("CAMPAIGN_CANDIDATE", <Megaphone className="size-4" />)} Campaign candidate
            </button>
            {s.status === "DETECTED" && (
              <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => act("VALIDATE")}>
                {busyIcon("VALIDATE", <ShieldCheck className="size-4" />)} Validate
              </button>
            )}
            {s.status !== "MONITOR" && (
              <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => act("MONITOR")}>
                {busyIcon("MONITOR", <Eye className="size-4" />)} Monitor
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void run("analyze", `/signals/${id}/analyze`, {}, "Re-analysis queued — the interpretation refreshes when it finishes.")}>
              {busyIcon("analyze", <RefreshCw className="size-4" />)} Re-analyze
            </button>
            <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => setDismissing((v) => !v)}>
              <Ban className="size-4" /> Not relevant
            </button>
          </div>
          {!candidateOk && !s.campaignCandidate && <p className="text-xs text-faint">Campaign candidate unavailable: {candidateWhy}</p>}
          {dismissing && (
            <Dismiss
              busy={busy === "dismiss"}
              onCancel={() => setDismissing(false)}
              onSubmit={(feedback, note) => void run("dismiss", `/signals/${id}/dismiss`, { feedback, note: note || undefined }, "Dismissed — your feedback improves future signals.").then((ok) => ok && setDismissing(false))}
            />
          )}
        </div>
      )}
      {!open && (
        <p className="text-sm text-muted">
          {SIGNAL_STATUS_INFO[s.status].label}: {SIGNAL_STATUS_INFO[s.status].description}
          {s.actedAction ? ` · ${ACT_LABEL[s.actedAction] ?? s.actedAction} ${timeAgo(s.actedAt)}` : ""}
          {s.feedback ? ` · feedback: ${SIGNAL_FEEDBACK_LABEL[s.feedback as SignalFeedbackKey] ?? s.feedback}` : ""}
        </p>
      )}

      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <section className="card space-y-1.5 border-tone/25 p-4">
              <div className="flex items-center gap-1.5">
                <span className="badge border-tone/30 bg-tone-soft text-[10px] text-tone">Fact</span>
                <span className="text-xs text-faint">What was observed, with its source</span>
              </div>
              <p className="text-sm break-words">{s.fact}</p>
            </section>
            <section className="card space-y-1.5 border-amber/25 p-4">
              <div className="flex items-center gap-1.5">
                <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">{s.interpretationSource === "AI" ? "AI hypothesis" : s.interpretationSource === "RULE" ? "Rule interpretation" : "Interpretation"}</span>
                <span className="text-xs text-faint">What it may mean — not a fact</span>
              </div>
              <p className="text-sm break-words text-muted">{s.interpretation ?? "Not interpreted yet. Re-analyze to ask what it may mean."}</p>
            </section>
          </div>

          <section className={`card p-4 text-sm ${s.whyNow ? "border-tone/25" : ""}`}>
            <h3 className="mb-1 text-sm font-semibold">Why contact them now?</h3>
            {s.whyNow ? <p>{s.whyNow}</p> : <p className="text-muted">No signal-based outreach — no meaningful why-now. The company stays in the normal prospecting pool.</p>}
            <p className="mt-2 text-xs">
              <span className="font-medium">Recommended: {rec.label}</span> <span className="text-muted">— {rec.description}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              Relationship: <span className="text-fg">{RELATIONSHIP_INFO[s.relationship].label}</span> — {RELATIONSHIP_INFO[s.relationship].description}
            </p>
          </section>

          {s.change && <Comparison change={s.change} />}

          <section className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Signal relevance</h3>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                Overall <StrengthBadge strength={s.strength} />
              </span>
            </div>
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ["Freshness", s.relevance.freshness],
                  ["Source reliability", s.relevance.sourceReliability],
                  ["ICP relevance", s.relevance.icpRelevance],
                  ["Commercial relevance", s.relevance.commercialRelevance],
                  ["Relationship context", s.relevance.relationshipContext],
                ] as [string, Level][]
              ).map(([label, l]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <dt className="text-muted">{label}</dt>
                  <dd>
                    <span className={`badge text-[10px] ${LEVEL_STYLE[l]}`}>{levelText(l)}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="mt-3 list-inside list-disc space-y-0.5 text-xs text-muted">
              {s.relevance.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              <span className="text-faint">Our relevance: </span>
              {relevanceText(s)}
            </p>
          </section>

          <section className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">
              Evidence <span className="text-xs font-normal text-faint">{s.sourceCount} independent source{s.sourceCount === 1 ? "" : "s"}</span>
            </h3>
            {s.evidence.length === 0 ? (
              <p className="text-sm text-muted">No stored evidence — treat this signal as unverified.</p>
            ) : (
              <ul className="space-y-2">
                {s.evidence.map((e) => (
                  <li key={e.evidenceId} className="rounded-lg border border-line p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-fg">{e.source}</span>
                      <span className="badge text-[10px]">{e.trust.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="text-faint">{e.evidenceType.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="ml-auto text-faint">observed {shortDate(e.observedAt)}</span>
                    </div>
                    {e.excerpt && <p className="mt-1.5 break-words text-muted">“{e.excerpt}”</p>}
                    {e.note && <p className="mt-1 text-faint">{e.note}</p>}
                    {e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 text-accent hover:underline">
                        <span className="truncate">{e.url}</span> <ExternalLink className="size-3 shrink-0" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {s.history.length > 0 && (
            <section className="card p-4">
              <h3 className="mb-2 text-sm font-semibold">History</h3>
              <ol className="space-y-1.5 text-xs">
                {s.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2">
                    <span className="text-faint">{shortDate(h.at)}</span>
                    <span className="font-medium">{h.action.replace(/^signal\./, "").replace(/_/g, " ")}</span>
                    <span className="text-muted">{h.actor}</span>
                    {h.detail && <span className="w-full text-muted">{h.detail}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="card p-4 text-sm">
            <h3 className="mb-2 font-semibold">Provenance</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-faint">Source</dt>
              <dd>{s.sourceKind.replace(/_/g, " ").toLowerCase()}</dd>
              <dt className="text-faint">Confidence</dt>
              <dd>{levelText(s.confidence)}</dd>
              <dt className="text-faint">First detected</dt>
              <dd>{shortDate(s.detectedAt)}</dd>
              <dt className="text-faint">Happened</dt>
              <dd>{shortDate(s.effectiveAt)}</dd>
              <dt className="text-faint">Last seen</dt>
              <dd>{shortDate(s.lastSeenAt)}</dd>
              <dt className="text-faint">Useful until</dt>
              <dd>{shortDate(s.expiresAt)}</dd>
              {s.windowEndsAt && (
                <>
                  <dt className="text-faint">Window ends</dt>
                  <dd className={s.windowState === "PASSED" ? "text-danger" : ""}>
                    {shortDate(s.windowEndsAt)}
                    {s.windowState === "PASSED" ? " · passed" : ""}
                  </dd>
                </>
              )}
              <dt className="text-faint">Researched</dt>
              <dd>{s.researchedAt ? timeAgo(s.researchedAt) : "Not yet"}</dd>
              <dt className="text-faint">ICP fit</dt>
              <dd>{levelText(s.icp)}</dd>
            </dl>
          </section>

          {s.hypothesis && (
            <section className="card space-y-1 p-4 text-sm">
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold">Opportunity hypothesis</h3>
                <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">Not verified</span>
              </div>
              <p>{s.hypothesis.hypothesis}</p>
              <p className="text-xs text-muted">{s.hypothesis.reasonSummary}</p>
              <p className="text-xs text-faint">
                {levelText(s.hypothesis.confidence)} confidence · {s.hypothesis.status.toLowerCase()} · {s.hypothesis.source}
              </p>
              <Link href={`/companies/${s.companyId}?tab=digital`} className="text-xs text-tone hover:underline">
                Open on company
              </Link>
            </section>
          )}

          {s.opportunity && (
            <section className="card space-y-1 p-4 text-sm">
              <h3 className="font-semibold">Open deal</h3>
              <Link href={`/opportunities/${s.opportunity.id}`} className="text-accent hover:underline">
                {s.opportunity.name}
              </Link>
              <p className="text-xs text-muted">
                {s.opportunity.stage.toLowerCase()}
                {s.opportunity.owner ? ` · owner ${s.opportunity.owner}` : ""}
              </p>
              <p className="text-xs text-faint">The signal belongs on the deal — no new cold email.</p>
            </section>
          )}

          {s.conversation && (
            <section className="card space-y-1 p-4 text-sm">
              <h3 className="font-semibold">Conversation</h3>
              <Link href={`/inbox?c=${s.conversation.id}`} className="text-accent hover:underline">
                {s.conversation.subject || "Open conversation"}
              </Link>
              <p className="text-xs text-muted">
                {s.conversation.contactName ?? "Unknown contact"}
                {s.conversation.owner ? ` · owner ${s.conversation.owner}` : ""}
              </p>
            </section>
          )}

          <section className="card p-4 text-sm">
            <h3 className="mb-1.5 font-semibold">Matched rules</h3>
            {s.matchedRules.length === 0 ? (
              <p className="text-xs text-muted">No rule matched.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {s.matchedRules.map((r) => (
                  <li key={r.id}>
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted"> → {r.actions.map((a) => RULE_ACTION_INFO[a as keyof typeof RULE_ACTION_INFO]?.label ?? a).join(", ") || "nothing"}</span>
                  </li>
                ))}
              </ul>
            )}
            {s.autoActions.length > 0 && <p className="mt-1.5 text-xs text-faint">Done automatically: {s.autoActions.join(", ").toLowerCase().replace(/_/g, " ")}</p>}
          </section>

          {s.related.length > 0 && (
            <section className="card p-4 text-sm">
              <h3 className="mb-1 font-semibold">Other open signals · same company</h3>
              <p className="mb-2 text-xs text-faint">Together they may form a pattern — still an inference, never proof.</p>
              <ul className="space-y-1.5">
                {s.related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/signals/${r.id}`} className="flex items-start gap-2 hover:text-tone">
                      <StrengthBadge strength={r.strength} />
                      <span className="min-w-0">
                        <span className="block text-sm break-words">{r.title}</span>
                        <span className="block text-xs text-faint">
                          {r.typeLabel} · {timeAgo(r.detectedAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/signals" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
      <ArrowLeft className="size-3.5" /> Signals
    </Link>
  );
}

function Dismiss({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (f: SignalFeedbackKey, note: string) => void }) {
  const [feedback, setFeedback] = useState<SignalFeedbackKey | null>(null);
  const [note, setNote] = useState("");
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (feedback) onSubmit(feedback, note.trim());
      }}
    >
      <p className="text-sm font-medium">Why is it not relevant?</p>
      <div className="flex flex-wrap gap-1.5">
        {SIGNAL_FEEDBACK.map((f) => (
          <button key={f} type="button" aria-pressed={feedback === f} onClick={() => setFeedback(f)} className={`rounded-md border px-2.5 py-1 text-xs ${feedback === f ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}>
            {SIGNAL_FEEDBACK_LABEL[f]}
          </button>
        ))}
      </div>
      <input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="Note" />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary text-xs" disabled={busy || !feedback}>
          {busy ? <Loader className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />} Dismiss
        </button>
      </div>
    </form>
  );
}

const asList = (v: string[] | string | null): string[] => (v == null ? [] : Array.isArray(v) ? v : v.trim() ? [v] : []);

/** Previous vs current (screen #9 §5): the user sees exactly why the signal exists. */
function Comparison({ change }: { change: NonNullable<SignalDetail["change"]> }) {
  const prev = asList(change.previous);
  const curr = asList(change.current);
  const has = (list: string[], x: string) => list.some((y) => y.toLowerCase() === x.toLowerCase());
  return (
    <section className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Evidence comparison · {change.label}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-line p-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">Previous</div>
          {prev.length === 0 ? (
            <p className="text-sm text-faint">Nothing recorded</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {prev.map((x, i) => (
                <li key={i} className={`break-words ${curr.length && !has(curr, x) ? "text-faint line-through" : "text-muted"}`}>
                  {x}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 rounded-lg border border-tone/25 p-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">Current</div>
          {curr.length === 0 ? (
            <p className="text-sm text-faint">Nothing recorded</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {curr.map((x, i) => {
                const isNew = !has(prev, x);
                return (
                  <li key={i} className={`flex flex-wrap items-center gap-1.5 break-words ${isNew ? "font-medium" : "text-muted"}`}>
                    {x}
                    {isNew && <span className="badge h-4 border-tone/30 bg-tone-soft px-1.5 text-[9px] text-tone">New</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
