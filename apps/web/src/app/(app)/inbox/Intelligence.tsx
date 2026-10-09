"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, CalendarClock, Compass, History, Lightbulb, Loader, Megaphone, Send, Target, X } from "lucide-react";
import { CATEGORY_INFO, EXTRACTION_INFO, INTENT_INFO, MODE_INFO, OBJECTION_INFO, STAGE_INFO, type ExtractionField, type ObjectionType, type PermissionKey } from "@revenue-os/shared";
import { errorMessage, post } from "@/lib/api";
import { CATEGORY_STYLE, intentStyle, TIMELINE_LABEL, type ConversationDetail } from "@/lib/conversations";
import { formatAgo } from "@/lib/crm";
import { whenOf, zoneOf } from "@/lib/meetings";
import { useMe } from "@/lib/session-context";

/**
 * The intelligence panel (screen #5 §1, §23, §40, §44): what to do next and why, what they asked, what we now know
 * (with their exact words), the company, and what happened — decisions with reasons, never chain of thought.
 */
export function Intelligence({ detail, onChange, onOffer }: { detail: ConversationDetail; onChange: () => Promise<void>; onOffer?: (text: string) => void }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const c = detail.conversation;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = [...detail.messages].reverse().find((m) => m.classification && m.classification.primaryIntent !== "OUT_OF_OFFICE");
  const cls = latest?.classification ?? null;

  async function rejectFact(id: string) {
    setBusy(id);
    setError(null);
    try {
      await post(`/conversations/${c.id}/facts/${id}/reject`);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function assign(userId: string) {
    setBusy("assign");
    try {
      await post(`/conversations/${c.id}/assign`, { userId: userId || null });
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* next action */}
      <section className="card border-tone/25 p-4" data-tone="email">
        <div className="eyebrow mb-1.5 flex items-center gap-1.5 text-[11px]">
          <Compass className="size-3.5 text-tone" /> Next action
        </div>
        <p className="text-sm font-medium leading-snug">{c.nextAction}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`badge text-[10px] ${CATEGORY_STYLE[c.category]}`}>{CATEGORY_INFO[c.category].label}</span>
          <span className="badge text-[10px]">{STAGE_INFO[c.stage]}</span>
          <span className="badge text-[10px]" title={MODE_INFO[c.mode].description}>
            {MODE_INFO[c.mode].label}
          </span>
        </div>
        {c.priorityReasons.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Priority {c.priority}: {c.priorityReasons.join(" · ")}
          </p>
        )}
        {can("conversation.takeover") && detail.members.length > 0 && (
          <label className="mt-3 flex items-center gap-2 text-xs text-muted">
            Owner
            <select className="input h-auto flex-1 py-1 text-xs" value={c.assignedToId ?? ""} disabled={busy === "assign"} onChange={(e) => void assign(e.target.value)}>
              <option value="">Unassigned</option>
              {detail.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <MeetingCard detail={detail} canBook={can("meeting.book")} onChange={onChange} onOffer={onOffer} />

      <OpportunityCard detail={detail} canCreate={can("opportunity.create")} />

      {error && <div className="card border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>}

      {/* latest reading */}
      {cls && (
        <section className="card space-y-2.5 p-4">
          <div className="eyebrow flex items-center gap-1.5 text-[11px]">
            <Lightbulb className="size-3.5 text-tone-ai" /> What they said
          </div>
          <div className="flex flex-wrap gap-1">
            <span className={`badge ${intentStyle(cls.primaryIntent)}`}>{INTENT_INFO[cls.primaryIntent]?.label ?? cls.primaryIntent}</span>
            {cls.secondaryIntents.map((i) => (
              <span key={i} className="badge text-[11px]">
                {INTENT_INFO[i]?.label ?? i}
              </span>
            ))}
            {c.sentiment && <span className="badge text-[11px]">Tone: {c.sentiment.toLowerCase()}</span>}
          </div>
          {c.summary && <p className="text-xs leading-relaxed text-muted">{c.summary}</p>}
          {cls.questions.length > 0 && (
            <div>
              <div className="text-xs font-medium">Questions</div>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {cls.questions.map((q) => (
                  <li key={q}>“{q}”</li>
                ))}
              </ul>
            </div>
          )}
          {cls.objections.length > 0 && (
            <div>
              <div className="text-xs font-medium">Objections</div>
              <ul className="mt-1 space-y-1 text-xs text-muted">
                {cls.objections.map((o) => (
                  <li key={o.text}>
                    <span className="font-medium text-fg">{OBJECTION_INFO[o.type as ObjectionType] ?? o.type}:</span> “{o.text}”
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* structured context */}
      <section className="card p-4">
        <div className="eyebrow mb-2 text-[11px]">What we know from the conversation</div>
        {detail.context.length === 0 ? (
          <p className="text-xs text-muted">Nothing stated yet — need, timeline, budget and who decides stay unknown until they say so.</p>
        ) : (
          <ul className="space-y-2">
            {detail.context.map((f) => (
              <li key={f.field} className="group rounded-lg border border-line px-2.5 py-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{EXTRACTION_INFO[f.field as ExtractionField] ?? f.field}</div>
                    <div className="text-muted">{f.value}</div>
                  </div>
                  {f.id && can("company.update") && (
                    <button type="button" aria-label="This is wrong" title="This is wrong" className="shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-danger" disabled={busy === f.id} onClick={() => void rejectFact(f.id!)}>
                      {busy === f.id ? <Loader className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                    </button>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-faint">
                  “{f.quote}” · {formatAgo(f.at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* company + campaign */}
      {detail.company && (
        <section className="card space-y-2 p-4 text-sm">
          <div className="eyebrow flex items-center gap-1.5 text-[11px]">
            <Building2 className="size-3.5" /> Company
          </div>
          <Link href={`/companies/${detail.company.id}`} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            {detail.company.name} <ArrowRight className="size-3.5" />
          </Link>
          <p className="text-xs text-muted">
            {[detail.company.industry, [detail.company.city, detail.company.region].filter(Boolean).join(", "), detail.company.website].filter(Boolean).join(" · ")}
          </p>
          {detail.person && (
            <p className="text-xs text-muted">
              {detail.person.name}
              {detail.person.title ? ` — ${detail.person.title}` : ""}
            </p>
          )}
          {detail.company.priority && (
            <p className="text-xs text-muted">
              Priority {detail.company.priority.level.toLowerCase()}
              {detail.company.priority.reasons[0] ? ` — ${detail.company.priority.reasons[0]}` : ""}
            </p>
          )}
          {detail.campaign && (
            <div className="border-t border-line pt-2 text-xs">
              <div className="flex items-center gap-1.5 text-muted">
                <Megaphone className="size-3.5" /> From campaign
              </div>
              <Link href={`/campaigns/${detail.campaign.id}`} className="font-medium text-accent hover:underline">
                {detail.campaign.name}
              </Link>
              {detail.enrollment && <p className="text-muted">Cold sequence: {detail.enrollment.status === "REPLIED" ? "stopped when they replied" : detail.enrollment.status.toLowerCase()}</p>}
            </div>
          )}
          {detail.mailbox && (
            <p className="border-t border-line pt-2 text-xs text-muted">
              Mailbox: {detail.mailbox.name}
              {detail.mailbox.testMailbox ? " (test — nothing really leaves)" : ""}
            </p>
          )}
        </section>
      )}

      {/* timeline */}
      <section className="card p-4">
        <div className="eyebrow mb-2 flex items-center gap-1.5 text-[11px]">
          <History className="size-3.5" /> What happened
        </div>
        <ol className="space-y-2 border-l border-line pl-3">
          {[...detail.timeline].reverse().slice(0, 25).map((e) => (
            <li key={e.id} className="relative text-xs">
              <span className="absolute -left-[16.5px] top-1 size-2 rounded-full border border-line bg-surface" />
              <div className="font-medium">{TIMELINE_LABEL[e.type] ?? e.type}</div>
              <div className="text-muted">
                {describe(e)} · {formatAgo(e.at)}
                {e.actorName ? ` · ${e.actorName}` : e.actorType === "AI_AGENT" ? " · AI" : ""}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Meeting request card (screen #8 §10): what they asked for, their time zone, who takes it, and genuinely free times
 * from the calendar. "Offer these times" puts a message in the reply box; "Book" asks the calendar (the Policy Engine
 * decides) — it only shows as booked once the calendar confirms.
 */
function MeetingCard({ detail, canBook, onChange, onOffer }: { detail: ConversationDetail; canBook: boolean; onChange: () => Promise<void>; onOffer?: (text: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const m = detail.meeting;
  const c = detail.conversation;
  const asked = c.stage === "MEETING_REQUESTED" || c.primaryIntent === "MEETING_REQUEST";
  if (!m && !(canBook && (asked || c.stage === "ENGAGED" || c.stage === "MEETING_BOOKED"))) return null;

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const arranging = m && (m.status === "PROPOSED" || m.status === "PENDING_CONFIRMATION");
  const bookingNow = arranging && !!m.pendingStartAt;
  const ownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <section className={`card p-4 ${asked && arranging ? "border-tone-sales/30 bg-tone-sales-soft/40" : ""}`} data-tone="sales">
      <div className="eyebrow mb-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5 text-tone" /> {arranging ? "Meeting request" : "Meeting"}
        </span>
        {m && (
          <Link href={`/meetings/${m.id}`} className="normal-case tracking-normal text-accent hover:underline">
            Open →
          </Link>
        )}
      </div>
      {!m ? (
        <>
          <p className="text-xs text-muted">{asked ? "They asked to meet — find genuinely free times in the calendar." : "No meeting yet."}</p>
          <button type="button" className="btn btn-secondary mt-2 w-full justify-center text-xs" disabled={!!busy} onClick={() => void act("propose", () => post("/meetings/propose", { conversationId: c.id }))}>
            {busy === "propose" ? <Loader className="size-3.5 animate-spin" /> : <CalendarClock className="size-3.5" />} Find free times
          </button>
        </>
      ) : arranging ? (
        <div className="space-y-2 text-xs">
          <p className="text-sm font-medium">
            {m.typeName} · {m.durationMinutes} min
          </p>
          {m.preferenceLabel && <p className="text-muted">Asked for: <span className="text-fg">{m.preferenceLabel}</span></p>}
          <p className="text-muted">
            Their time: {zoneOf(m.timezone)}
            {m.timezoneConfidence === "LOW" ? " (a guess — the offer asks them to confirm)" : ""}
            {m.ownerName ? ` · with ${m.ownerName}` : ""}
          </p>
          {bookingNow ? (
            <p className="rounded-lg border border-amber/30 bg-amber-soft px-2.5 py-2 text-amber">
              Booking {whenOf(m.pendingStartAt!, m.timezone)} — {m.statusReason ?? "waiting for the calendar"}
            </p>
          ) : m.slots.length === 0 ? (
            <p className="rounded-lg border border-line px-2.5 py-2 text-muted">{m.statusReason ?? m.nextAction}</p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {m.slots.map((s) => (
                  <li key={s.start} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-1.5">
                    <span>
                      <span className="font-medium">{whenOf(s.start, m.timezone)}</span> <span className="text-faint">{zoneOf(m.timezone, s.start)}</span>
                      {ownZone !== m.timezone && <span className="block text-[11px] text-faint">You: {whenOf(s.start)}</span>}
                    </span>
                    {canBook && (
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-hover"
                        disabled={!!busy}
                        onClick={() => window.confirm(`Book ${whenOf(s.start, m.timezone)} (${zoneOf(m.timezone, s.start)}) and send the invite?`) && void act(s.start, () => post(`/meetings/${m.id}/book`, { start: s.start }))}
                      >
                        {busy === s.start ? <Loader className="size-3.5 animate-spin" /> : "Book"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {m.slotsCheckedAt && <p className="text-[11px] text-faint">Checked against the calendar {formatAgo(m.slotsCheckedAt)} — checked again before booking.</p>}
              {canBook && onOffer && (
                <button
                  type="button"
                  className="btn btn-primary w-full justify-center text-xs"
                  disabled={!!busy}
                  onClick={() =>
                    void act("offer", async () => {
                      const r = await post<{ text: string }>(`/meetings/${m.id}/offer`);
                      onOffer(r.text);
                    })
                  }
                >
                  {busy === "offer" ? <Loader className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Offer these times
                </button>
              )}
              {m.offeredAt && <p className="text-[11px] text-muted">Offered {formatAgo(m.offeredAt)} — when they pick one, it is booked (within policy).</p>}
            </>
          )}
          {canBook && !bookingNow && (
            <button type="button" className="text-[11px] text-accent hover:underline" disabled={!!busy} onClick={() => void act("refresh", () => post(`/meetings/${m.id}/slots`, {}))}>
              {busy === "refresh" ? "Checking…" : "Check the calendar again"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1 text-xs">
          <p className="text-sm font-medium">{m.title}</p>
          {m.startAt && (
            <p className="text-muted">
              {whenOf(m.startAt, m.timezone)} {zoneOf(m.timezone, m.startAt)} · {m.status === "RESCHEDULING" ? "being moved" : m.status.toLowerCase().replace("_", " ")}
            </p>
          )}
          <p className="text-muted">{m.nextAction}</p>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

/** Deal from this conversation (Phase 13): a link once it exists; otherwise the commercial evidence the rules noticed. */
function OpportunityCard({ detail, canCreate }: { detail: ConversationDetail; canCreate: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = detail.opportunity;
  const signal = detail.commercialSignal;
  if (!o && !signal && !canCreate) return null;
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ id: string }>("/opportunities/from-conversation", { conversationId: detail.conversation.id });
      window.location.href = `/opportunities/${r.id}`;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <section className={`card p-4 ${signal && !o ? "border-tone-sales/30 bg-tone-sales-soft/40" : ""}`} data-tone="sales">
      <div className="eyebrow mb-1.5 flex items-center gap-1.5 text-[11px]">
        <Target className="size-3.5 text-tone" /> Opportunity
      </div>
      {o ? (
        <Link href={`/opportunities/${o.id}`} className="block text-sm">
          <span className="font-medium text-accent hover:underline">{o.name}</span>
          <span className="block text-xs text-muted">{o.status === "OPEN" ? o.stage : o.status.toLowerCase()} — its qualification updates from this conversation</span>
        </Link>
      ) : signal ? (
        <>
          <p className="text-sm font-medium">Potential opportunity</p>
          <p className="text-xs text-muted">{signal.reason}</p>
          {signal.quote && <p className="mt-1 text-[11px] italic text-faint">“{signal.quote}”</p>}
          {canCreate && (
            <button type="button" className="btn btn-primary mt-2 w-full justify-center text-xs" disabled={busy} onClick={() => void create()}>
              {busy ? <Loader className="size-3.5 animate-spin" /> : <Target className="size-3.5" />} Create opportunity
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted">No commercial need stated yet — interest alone isn’t a deal.</p>
          <button type="button" className="mt-1 text-xs text-accent hover:underline" disabled={busy} onClick={() => void create()}>
            Create one anyway
          </button>
        </>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </section>
  );
}

function describe(e: ConversationDetail["timeline"][number]): string {
  const p = e.payload as Record<string, string | boolean | number | null>;
  switch (e.type) {
    case "ConversationMessageClassified":
      return `${INTENT_INFO[p.primaryIntent as keyof typeof INTENT_INFO]?.label ?? p.primaryIntent}${p.needsHuman ? " — needs a person" : ""}`;
    case "ConversationEscalated":
      return String(p.reason ?? "");
    case "ConversationReplyDrafted":
      return `${p.author === "AI" ? "AI" : "Person"} · ${String(p.status).toLowerCase()}`;
    case "ConversationReplySent":
      return p.author === "AI" ? "by the AI, within policy" : "by a person";
    case "ConversationModeChanged":
      return `${String(p.from)} → ${String(p.to)}${p.cancelledReplies ? ` · ${p.cancelledReplies} AI reply cancelled` : ""}`;
    case "ConversationMessageReceived":
      return String(p.kind ?? "").toLowerCase().replace("_", " ");
    case "ConversationSnoozed":
      return `until ${String(p.until).slice(0, 10)}`;
    default:
      return "";
  }
}
