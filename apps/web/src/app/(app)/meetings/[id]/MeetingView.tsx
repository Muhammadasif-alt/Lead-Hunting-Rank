"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CalendarX2,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Compass,
  Copy,
  FileText,
  History,
  Loader,
  MessageSquareReply,
  RefreshCw,
  ShieldCheck,
  Target,
  UserX,
  Users,
  Video,
} from "lucide-react";
import { MEETING_CHANGE_INFO, MEETING_LOCATION_INFO, MEETING_OUTCOME_INFO, MEETING_OUTCOMES, MEETING_STATUS_INFO, OBJECTION_INFO, STAGE_SEMANTIC_INFO, type MeetingLocation, type MeetingOutcomeKey, type ObjectionType, type PermissionKey } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { CHANGE_SOURCE, isoToLocalInput, localInputToIso, relative, STATUS_STYLE, timeOf, whenOf, zoneOf, type MeetingDetail } from "@/lib/meetings";
import { useMe } from "@/lib/session-context";

/**
 * One meeting (screen #8 §10-35): when (yours and theirs), who, why — the brief to walk in prepared — and the actions
 * that fit its state: book a free time, move or cancel it, record what happened. Booked only once the calendar confirms.
 */
export function MeetingView({ id }: { id: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [d, setD] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api<MeetingDetail>(`/meetings/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  // A booking or move is confirmed by the calendar in the background — refresh while one is pending.
  const pending = !!d && (!!d.meeting.pendingStartAt || d.meeting.status === "RESCHEDULING");
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  async function run(name: string, path: string, body: unknown = {}, done?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      const r = await post<unknown>(path, body);
      if (done) setNotice(done);
      await load();
      return r;
    } catch (err) {
      setError(errorMessage(err));
      await load();
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (!d)
    return error ? (
      <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    ) : (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading meeting…
      </div>
    );

  const m = d.meeting;
  const allowed = (a: string) => d.allowedActions.includes(a) && can(a === "apply-stage" ? "opportunity.update" : "meeting.book");
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = m.startAt ?? m.pendingStartAt;

  return (
    <div className="space-y-5" data-tone="sales">
      <Link href="/meetings" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Meetings
      </Link>

      {/* header */}
      <header className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{d.company.name}</h1>
              <span className={`badge ${STATUS_STYLE[m.status]}`}>{MEETING_STATUS_INFO[m.status].label}</span>
            </div>
            <p className="text-sm text-muted">
              {d.type.name} · {d.type.durationMinutes} min · {MEETING_LOCATION_INFO[m.locationType as MeetingLocation] ?? m.locationType}
              {d.owner?.name ? ` · with ${d.owner.name}` : ""}
            </p>
          </div>
          {m.meetingUrl && m.status === "BOOKED" && (
            <a href={m.meetingUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
              <Video className="size-4" /> Join
            </a>
          )}
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted">{m.startAt ? "When" : m.pendingStartAt ? "Booking" : "When"}</div>
            {at ? (
              <>
                <div className="font-medium">{whenOf(at)}</div>
                <div className="text-xs text-faint">
                  {relative(at)} · your time ({zoneOf(viewerZone, at)})
                </div>
              </>
            ) : (
              <div className="text-muted">Not booked yet</div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted">Their time</div>
            <div className="font-medium">{at ? `${timeOf(at, m.timezone)} ${zoneOf(m.timezone, at)}` : zoneOf(m.timezone)}</div>
            <div className="text-xs text-faint">
              {m.timezone} · {m.timezoneSource === "BUSINESS_LOCATION" ? "from the business location" : m.timezoneSource === "PERSON" ? "saved on the contact" : "workspace default — confirm with them"}
              {m.timezoneConfidence !== "HIGH" ? ` (${m.timezoneConfidence.toLowerCase()} confidence)` : ""}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">Calendar</div>
            <div className="font-medium">{m.bookedVia === "PROVIDER" ? "Confirmed by the calendar" : m.bookedVia === "MANUAL" ? "Recorded by a person" : "Not in the calendar yet"}</div>
            <div className="text-xs text-faint">{m.lastSyncedAt ? `Checked ${formatAgo(m.lastSyncedAt)}` : m.bookedAt ? `Booked ${formatAgo(m.bookedAt)}` : `Created ${formatAgo(m.createdAt)} by ${m.createdByType === "AI_AGENT" ? "the Scheduling Agent" : m.createdByType === "HUMAN" ? "a person" : "the system"}`}</div>
          </div>
        </div>
      </header>

      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {/* next action */}
          <section className="card border-tone/25 p-4">
            <div className="eyebrow mb-1.5 flex items-center gap-1.5 text-[11px]">
              <Compass className="size-3.5" /> Next action
            </div>
            <p className="text-sm font-medium">{m.nextAction}</p>
            {m.statusReason && m.statusReason !== m.nextAction && <p className="mt-1 text-xs text-muted">{m.statusReason}</p>}
            {m.routingReason && <p className="mt-1 text-xs text-faint">Owner: {m.routingReason}</p>}
            {d.noShowRisk && <p className="mt-2 rounded-lg border border-danger/25 bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{d.noShowRisk}</p>}
            {d.action?.status === "WAITING_APPROVAL" && d.action.approvalRequestId && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
                <ShieldCheck className="size-4" /> The AI asked to book this time — a person approves first ({d.action.statusReason}).
                {can("approval.decide") && (
                  <span className="ml-auto flex gap-2">
                    <button type="button" className="btn btn-primary h-8 text-xs" disabled={!!busy} onClick={() => void run("approve", `/policy/approvals/${d.action!.approvalRequestId}/approve`, {}, "Approved — the calendar is asked now (checked again first).")}>
                      Approve
                    </button>
                    <button type="button" className="btn btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => void run("reject", `/policy/approvals/${d.action!.approvalRequestId}/reject`, {}, "Rejected — nothing was booked.")}>
                      Reject
                    </button>
                  </span>
                )}
              </div>
            )}
          </section>

          {allowed("book") && <Arrange d={d} busy={busy} run={run} />}
          {(allowed("reschedule") || allowed("cancel") || allowed("outcome")) && <Manage d={d} busy={busy} run={run} canMove={allowed("reschedule")} canCancel={allowed("cancel")} canOutcome={allowed("outcome")} canApplyStage={can("opportunity.update")} />}
          {d.outcome && <Outcome d={d} busy={busy} run={run} canApply={allowed("apply-stage")} />}
          <Brief d={d} busy={busy} onRefresh={allowed("brief") ? () => void run("brief", `/meetings/${m.id}/brief`, {}, "Brief refreshed from current data.") : null} />
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <section className="card space-y-2 p-4 text-sm">
            <div className="eyebrow flex items-center gap-1.5 text-[11px]">
              <Users className="size-3.5" /> Who
            </div>
            <ul className="space-y-1.5">
              {d.attendees.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.side === "EXTERNAL" ? "Prospect" : "Our team"}
                      {a.email ? ` · ${a.email}` : ""}
                    </span>
                  </span>
                  {a.attended !== null && <span className={`badge text-[10px] ${a.attended ? "border-brand/25 bg-brand-soft text-brand" : "border-danger/25 bg-danger-soft text-danger"}`}>{a.attended ? "Attended" : "Absent"}</span>}
                </li>
              ))}
            </ul>
          </section>

          <section className="card space-y-2 p-4 text-sm">
            {d.opportunity ? (
              <Link href={`/opportunities/${d.opportunity.id}`} className="flex items-start gap-2 hover:text-accent">
                <Target className="mt-0.5 size-4 text-tone" />
                <span>
                  <span className="font-medium">{d.opportunity.name}</span>
                  <span className="block text-xs text-muted">{d.opportunity.status === "OPEN" ? `Deal · ${d.opportunity.stageName}` : `Deal · ${d.opportunity.status.toLowerCase()}`}</span>
                </span>
              </Link>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted">
                <Target className="size-4" /> No deal yet — booking the meeting creates one.
              </p>
            )}
            {d.conversation && (
              <Link href={`/inbox?c=${d.conversation.id}`} className="flex items-start gap-2 hover:text-accent">
                <MessageSquareReply className="mt-0.5 size-4 text-tone-email" />
                <span>
                  <span className="font-medium">Conversation</span>
                  <span className="block truncate text-xs text-muted">{d.conversation.subject}</span>
                </span>
              </Link>
            )}
            <Link href={`/companies/${d.company.id}`} className="block text-xs text-accent hover:underline">
              Company 360 →
            </Link>
          </section>

          {d.journey.length > 1 && (
            <section className="card p-4 text-sm">
              <div className="eyebrow mb-2 text-[11px]">Meeting journey</div>
              <ol className="space-y-1.5">
                {d.journey.map((j) => (
                  <li key={j.id} className={`flex items-center justify-between gap-2 text-xs ${j.current ? "font-semibold" : ""}`}>
                    <Link href={`/meetings/${j.id}`} className="truncate hover:text-accent">
                      {j.title}
                    </Link>
                    <span className="shrink-0 text-muted">
                      {j.startAt ? new Date(j.startAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"} · {j.outcome ? MEETING_OUTCOME_INFO[j.outcome].label : MEETING_STATUS_INFO[j.status].label}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="card p-4">
            <div className="eyebrow mb-2 flex items-center gap-1.5 text-[11px]">
              <History className="size-3.5" /> What happened
            </div>
            <ol className="space-y-2 border-l border-line pl-3">
              {[...d.changes].reverse().map((c) => (
                <li key={c.id} className="relative text-xs">
                  <span className="absolute -left-[16.5px] top-1 size-2 rounded-full border border-line bg-surface" />
                  <div className="font-medium">{MEETING_CHANGE_INFO[c.kind] ?? c.kind}</div>
                  <div className="text-muted">
                    {c.toStartAt ? `${whenOf(c.toStartAt)} · ` : ""}
                    {c.reason ? `${c.reason} · ` : ""}
                    {c.actorName ?? (c.reason && /calendar/i.test(c.reason) && c.source === "PROVIDER" ? null : (CHANGE_SOURCE[c.source] ?? c.source))}{c.actorName || !(c.reason && /calendar/i.test(c.reason) && c.source === "PROVIDER") ? " · " : ""}{formatAgo(c.at)}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

type Run = (name: string, path: string, body?: unknown, done?: string) => Promise<unknown>;

/** Being arranged: free times, find others, offer them, book one — or record a meeting booked elsewhere. */
function Arrange({ d, busy, run }: { d: MeetingDetail; busy: string | null; run: Run }) {
  const m = d.meeting;
  const [ask, setAsk] = useState("");
  const [typeId, setTypeId] = useState(d.type.id);
  const [ownerId, setOwnerId] = useState(d.owner?.id ?? "");
  const [manual, setManual] = useState(false);
  const [manualAt, setManualAt] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function offer() {
    const r = (await run("offer", `/meetings/${m.id}/offer`)) as { text: string } | null;
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.text);
      setCopied(true);
    } catch {
      window.prompt("Copy this message:", r.text);
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <CalendarClock className="size-4 text-tone" /> Free times
        </h2>
        {m.slotsCheckedAt && <span className="text-xs text-faint">Checked against the calendar {formatAgo(m.slotsCheckedAt)}</span>}
      </div>
      {m.requestText && <p className="text-xs text-muted">They wrote: “{m.requestText}”{m.preferenceLabel ? ` — read as ${m.preferenceLabel}` : ""}</p>}
      {m.slots.length === 0 ? (
        <p className="rounded-lg border border-line px-3 py-2 text-sm text-muted">{m.statusReason ?? "No free time found in the next two weeks."}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {m.slots.map((s) => (
            <li key={s.start} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{whenOf(s.start, m.timezone)}</span> <span className="text-xs text-faint">{zoneOf(m.timezone, s.start)}</span>
                {viewerZone !== m.timezone && <span className="block text-xs text-faint">You: {whenOf(s.start)}</span>}
              </span>
              <button
                type="button"
                className="btn btn-secondary h-8 shrink-0 text-xs"
                disabled={!!busy}
                onClick={() => window.confirm(`Book ${whenOf(s.start, m.timezone)} and send the calendar invite?`) && void run(s.start, `/meetings/${m.id}/book`, { start: s.start }, "Booking asked — it shows as booked once the calendar confirms.")}
              >
                {busy === s.start ? <Loader className="size-3.5 animate-spin" /> : "Book"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {m.slots.length > 0 && (
          <button type="button" className="btn btn-primary text-sm" disabled={!!busy} onClick={() => void offer()}>
            {busy === "offer" ? <Loader className="size-4 animate-spin" /> : <Copy className="size-4" />} {copied ? "Copied — paste it in the reply" : "Offer these times"}
          </button>
        )}
        {d.conversation && copied && (
          <Link href={`/inbox?c=${d.conversation.id}`} className="btn btn-secondary text-sm">
            <MessageSquareReply className="size-4" /> Open the conversation
          </Link>
        )}
        <button type="button" className="btn btn-ghost text-sm" onClick={() => setManual((v) => !v)}>
          Booked elsewhere?
        </button>
      </div>

      <details className="rounded-xl border border-line p-3 text-sm">
        <summary className="cursor-pointer font-medium">Find other times</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-muted sm:col-span-3">
            What they asked for
            <input className="input mt-1" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. next Tuesday morning, or Friday after 2pm" />
          </label>
          <label className="text-xs text-muted">
            Meeting type
            <select className="input mt-1" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {d.types.map((t) => (
                <option key={t.id} value={t.id} disabled={!!t.blocked}>
                  {t.name} ({t.durationMinutes} min){t.blocked ? " — needs more qualification" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            With
            <select className="input mt-1" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {!ownerId && <option value="">Nobody bookable</option>}
              {d.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              className="btn btn-secondary w-full"
              disabled={!!busy}
              onClick={() => void run("slots", `/meetings/${m.id}/slots`, { requestText: ask.trim() || null, meetingTypeId: typeId !== d.type.id ? typeId : null, ownerUserId: ownerId && ownerId !== d.owner?.id ? ownerId : null }, "Fresh times from the calendar.")}
            >
              {busy === "slots" ? <Loader className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Check the calendar
            </button>
          </div>
        </div>
      </details>

      {manual && (
        <div className="rounded-xl border border-amber/30 bg-amber-soft/40 p-3 text-sm">
          <p className="mb-2 text-xs text-muted">For a meeting agreed outside the system (phone, your own calendar). It is recorded as booked by you — no invite is sent.</p>
          <div className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
            <input type="datetime-local" aria-label="When" className="input" value={manualAt} onChange={(e) => setManualAt(e.target.value)} />
            <input className="input" placeholder="How was it booked? (e.g. agreed on the phone)" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="btn btn-primary" disabled={!!busy || !manualAt || !note.trim()} onClick={() => void run("manual", `/meetings/${m.id}/confirm-manual`, { start: localInputToIso(manualAt), note: note.trim() }, "Recorded as booked.")}>
              Record
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Booked: move it, cancel it, or — once it started — record what happened. */
function Manage({ d, busy, run, canMove, canCancel, canOutcome, canApplyStage }: { d: MeetingDetail; busy: string | null; run: Run; canMove: boolean; canCancel: boolean; canOutcome: boolean; canApplyStage: boolean }) {
  const m = d.meeting;
  const [mode, setMode] = useState<"none" | "move" | "cancel">("none");
  const [moveAt, setMoveAt] = useState(m.startAt ? isoToLocalInput(m.startAt) : "");
  const [reason, setReason] = useState("");
  const [source, setSource] = useState<"PROSPECT" | "TEAM">("PROSPECT");
  const [outcome, setOutcome] = useState<MeetingOutcomeKey>("ADVANCED");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [attended, setAttended] = useState<Record<string, boolean>>(Object.fromEntries(d.attendees.map((a) => [a.id, true])));
  const [applyStage, setApplyStage] = useState(true);

  return (
    <section className="card space-y-3 p-4">
      {(canMove || canCancel) && (
        <div className="flex flex-wrap gap-2">
          {canMove && (
            <button type="button" className={`btn ${mode === "move" ? "btn-primary" : "btn-secondary"} text-sm`} onClick={() => setMode(mode === "move" ? "none" : "move")}>
              <CalendarClock className="size-4" /> Reschedule
            </button>
          )}
          {canCancel && (
            <button type="button" className={`btn ${mode === "cancel" ? "btn-primary" : "btn-secondary"} text-sm`} onClick={() => setMode(mode === "cancel" ? "none" : "cancel")}>
              <CalendarX2 className="size-4" /> Cancel
            </button>
          )}
          {canOutcome && (
            <button type="button" className="btn btn-ghost text-sm" disabled={!!busy} onClick={() => window.confirm("Mark as a no-show? The deal stays open and the conversation comes back to you to offer a new time.") && void run("noshow", `/meetings/${m.id}/outcome`, { outcome: "NO_SHOW" }, "Recorded as a no-show — offer them a new time.")}>
              <UserX className="size-4" /> They didn’t show
            </button>
          )}
        </div>
      )}
      {mode === "move" && (
        <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
          <input type="datetime-local" aria-label="New time" className="input" value={moveAt} onChange={(e) => setMoveAt(e.target.value)} />
          <input className="input" placeholder="Why it moves" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={!!busy || !moveAt || !reason.trim()} onClick={() => void run("move", `/meetings/${m.id}/reschedule`, { start: localInputToIso(moveAt), reason: reason.trim() }, "Moving it — the old time stands until the calendar confirms.")}>
            Move
          </button>
          <p className="text-xs text-muted sm:col-span-3">Checked against the calendar first; nothing is double-booked. The time is in your zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}).</p>
        </div>
      )}
      {mode === "cancel" && (
        <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[160px_minmax(0,1fr)_auto]">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as "PROSPECT" | "TEAM")} aria-label="Who cancelled">
            <option value="PROSPECT">They cancelled</option>
            <option value="TEAM">We cancelled</option>
          </select>
          <input className="input" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn btn-primary" disabled={!!busy || !reason.trim()} onClick={() => void run("cancel", `/meetings/${m.id}/cancel`, { reason: reason.trim(), source }, "Cancelled — the deal stays open.")}>
            Cancel meeting
          </button>
          <p className="text-xs text-muted sm:col-span-3">The calendar event is removed and the invite withdrawn. A cancellation never closes the deal by itself.</p>
        </div>
      )}

      {canOutcome && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ClipboardCheck className="size-4 text-tone" /> What happened?
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {MEETING_OUTCOMES.filter((o) => o !== "NO_SHOW").map((o) => (
              <button key={o} type="button" aria-pressed={outcome === o} title={MEETING_OUTCOME_INFO[o].description} onClick={() => setOutcome(o)} className={`rounded-full border px-3 py-1 text-xs font-medium ${outcome === o ? "border-tone bg-tone-soft text-tone" : "border-line text-muted"}`}>
                {MEETING_OUTCOME_INFO[o].label}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Summary (one line)" value={summary} onChange={(e) => setSummary(e.target.value)} />
          <textarea className="input min-h-24 w-full resize-y py-2" placeholder="Notes — what they need, who decides, concerns, what we promised…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <input className="input" placeholder="Next step (becomes the deal’s next action)" value={nextStep} onChange={(e) => setNextStep(e.target.value)} />
          <fieldset className="text-xs">
            <legend className="mb-1 font-medium text-muted">Who attended</legend>
            <div className="flex flex-wrap gap-3">
              {d.attendees.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5">
                  <input type="checkbox" checked={attended[a.id] ?? false} onChange={(e) => setAttended((x) => ({ ...x, [a.id]: e.target.checked }))} /> {a.name}
                </label>
              ))}
            </div>
          </fieldset>
          {d.opportunity && canApplyStage && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={applyStage} onChange={(e) => setApplyStage(e.target.checked)} /> Move the deal if the rules recommend a stage (you can also do it later)
            </label>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!!busy}
            onClick={() =>
              void run(
                "outcome",
                `/meetings/${m.id}/outcome`,
                { outcome, summary: summary.trim() || null, notes: notes.trim() || null, nextStep: nextStep.trim() || null, attendance: d.attendees.map((a) => ({ attendeeId: a.id, attended: attended[a.id] ?? false })), applyStage: !!d.opportunity && canApplyStage && applyStage },
                "Outcome recorded.",
              )
            }
          >
            {busy === "outcome" ? <Loader className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Save outcome
          </button>
        </div>
      )}
    </section>
  );
}

function Outcome({ d, busy, run, canApply }: { d: MeetingDetail; busy: string | null; run: Run; canApply: boolean }) {
  const o = d.outcome!;
  return (
    <section className="card space-y-2 p-4 text-sm">
      <div className="eyebrow flex items-center gap-1.5 text-[11px]">
        <ClipboardCheck className="size-3.5" /> Outcome
      </div>
      <p>
        <span className="font-medium">{MEETING_OUTCOME_INFO[o.outcome].label}</span>
        {o.summary ? ` — ${o.summary}` : ""}
      </p>
      {o.nextStep && <p className="text-muted">Next step: {o.nextStep}</p>}
      {o.notes && <p className="whitespace-pre-wrap rounded-lg bg-raised px-3 py-2 text-xs text-muted">{o.notes}</p>}
      {o.recommendedStage && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Recommended stage: {STAGE_SEMANTIC_INFO[o.recommendedStage].label}</span>
          {o.stageApplied ? (
            <span className="badge border-brand/25 bg-brand-soft text-[10px] text-brand">Applied</span>
          ) : (
            canApply && (
              <button type="button" className="btn btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => void run("apply", `/meetings/${d.meeting.id}/apply-stage`, {}, "The deal moved.")}>
                Accept
              </button>
            )
          )}
        </div>
      )}
      <p className="text-xs text-faint">
        Recorded {formatAgo(o.recordedAt)}
        {o.recordedBy ? ` by ${o.recordedBy}` : ""}
      </p>
    </section>
  );
}

/** The pre-meeting brief (screen #8 §20-23): known with their words, unknown as a few questions with reasons, don't ask again, gaps. */
function Brief({ d, busy, onRefresh }: { d: MeetingDetail; busy: string | null; onRefresh: (() => void) | null }) {
  const b = d.brief;
  return (
    <section id="brief" className="card scroll-mt-4 space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <FileText className="size-4 text-tone" /> Brief
        </h2>
        <div className="flex items-center gap-2 text-xs text-faint">
          {b && `v${b.version} · ${formatAgo(b.generatedAt)} · from rules, not AI`}
          {onRefresh && (
            <button type="button" className="btn btn-ghost h-8 text-xs" disabled={!!busy} onClick={onRefresh}>
              {busy === "brief" ? <Loader className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
            </button>
          )}
        </div>
      </div>
      {!b ? (
        <p className="text-sm text-muted">The brief is prepared when the meeting is booked (and refreshed shortly before it starts).</p>
      ) : (
        <>
          {b.gaps.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
              {b.gaps.map((g) => (
                <li key={g}>⚠ {g}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Block title="Who">
              {b.content.who.length ? b.content.who.map((w) => <p key={w.name}>{w.name}{w.title ? ` — ${w.title}` : ""}</p>) : <p className="text-muted">Unknown</p>}
            </Block>
            <Block title="Company">
              <p>{b.content.company.name}</p>
              <p className="text-muted">{[b.content.company.industry, b.content.company.where, b.content.company.website].filter(Boolean).join(" · ")}</p>
            </Block>
            <Block title="Why they engaged">
              {b.content.whyEngaged ? (
                <>
                  <p>{b.content.whyEngaged.reason}</p>
                  {b.content.whyEngaged.quote && <p className="text-xs italic text-faint">“{b.content.whyEngaged.quote}”</p>}
                </>
              ) : (
                <p className="text-muted">Not recorded</p>
              )}
            </Block>
            <Block title="Objective">
              <p className="font-medium">{b.content.objective}</p>
            </Block>
            <Block title="Known">
              {b.content.known.length ? (
                <ul className="space-y-1">
                  {b.content.known.map((k) => (
                    <li key={k.label}>
                      ✓ <span className="font-medium">{k.label}:</span> {k.value}
                      {k.quote && <span className="block text-xs italic text-faint">“{k.quote}”</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nothing confirmed yet</p>
              )}
            </Block>
            <Block title="Unknown">
              {b.content.unknown.length ? (
                <ul className="space-y-0.5">
                  {b.content.unknown.map((u) => (
                    <li key={u.label}>? {u.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">Nothing important is missing</p>
              )}
            </Block>
            {b.content.questionsAsked.length > 0 && (
              <Block title="They asked">
                <ul className="space-y-0.5">
                  {b.content.questionsAsked.map((q) => (
                    <li key={q}>• “{q}”</li>
                  ))}
                </ul>
              </Block>
            )}
            {b.content.objections.length > 0 && (
              <Block title="Objections">
                <ul className="space-y-0.5">
                  {b.content.objections.map((o) => (
                    <li key={o.text}>
                      <span className="font-medium">{OBJECTION_INFO[o.type as ObjectionType] ?? o.type}:</span> “{o.text}”
                    </li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
          {b.content.suggestedQuestions.length > 0 && (
            <Block title="Suggested questions">
              <ol className="space-y-2">
                {b.content.suggestedQuestions.map((q, i) => (
                  <li key={q.question}>
                    <span className="font-medium">
                      {i + 1}. {q.question}
                    </span>
                    <span className="block text-xs text-muted">Why: {q.reason}</span>
                  </li>
                ))}
              </ol>
            </Block>
          )}
          {b.content.dontAskAgain.length > 0 && (
            <Block title="Don’t ask again">
              <ul className="space-y-0.5 text-muted">
                {b.content.dontAskAgain.map((x) => (
                  <li key={x}>✓ {x}</li>
                ))}
              </ul>
            </Block>
          )}
          {(b.content.stakeholders.length > 0 || b.content.signals.length > 0 || b.content.previousMeetings.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-3">
              {b.content.stakeholders.length > 0 && (
                <Block title="Others involved">
                  {b.content.stakeholders.map((s) => (
                    <p key={s.name}>
                      {s.name} <span className="text-xs text-muted">({s.status.toLowerCase()})</span>
                    </p>
                  ))}
                </Block>
              )}
              {b.content.signals.length > 0 && (
                <Block title="From research (may, not verified)">
                  {b.content.signals.map((s) => (
                    <p key={s.label} className="text-muted">
                      {s.label}
                    </p>
                  ))}
                </Block>
              )}
              {b.content.previousMeetings.length > 0 && (
                <Block title="Earlier meetings">
                  {b.content.previousMeetings.map((p, i) => (
                    <p key={`${p.title}-${i}`} className="text-muted">
                      {p.title}
                      {p.at ? ` · ${new Date(p.at).toLocaleDateString()}` : ""} · {p.outcome ?? p.status.toLowerCase()}
                    </p>
                  ))}
                </Block>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}
