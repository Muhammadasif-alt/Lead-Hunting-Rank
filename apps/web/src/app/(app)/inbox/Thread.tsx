"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowLeft,
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  FlaskConical,
  Hand,
  Loader,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  StickyNote,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { INTENT_INFO, MODE_INFO, RISK_INFO, type ConversationMode, type PermissionKey, type RiskFlag } from "@revenue-os/shared";
import { errorMessage, post } from "@/lib/api";
import { intentStyle, REPLY_STATUS, VALIDATOR_LABEL, type ConversationDetail, type Reply, type ThreadMessage } from "@/lib/conversations";
import { formatAgo } from "@/lib/crm";
import { useMe } from "@/lib/session-context";

const SIMULATIONS: [string, string][] = [
  ["Question", "Thanks for getting in touch. How does it work?"],
  ["Pricing", "Sounds interesting. How much does it cost for a business like ours?"],
  ["Meeting", "Happy to chat. Could we do a call on Thursday afternoon?"],
  ["Objection", "We already work with a local agency for our website."],
  ["Not now", "Not a priority right now — reach out in 3 months."],
  ["Unsubscribe", "Please remove me from your list."],
];

/** The conversation itself: messages, the AI's draft with its grounding, approvals, and the person's own reply. */
export function Thread({ detail, onBack, onChange, prefill }: { detail: ConversationDetail; onBack: () => void; onChange: () => Promise<void>; prefill?: { text: string; key: number } | null }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const c = detail.conversation;
  const id = c.id;
  const [body, setBody] = useState("");
  const [fromReplyId, setFromReplyId] = useState<string | null>(null);
  const [noteMode, setNoteMode] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // "Offer these times" (meeting card) puts the message here for a person to read, edit and send.
  useEffect(() => {
    if (!prefill) return;
    setBody(prefill.text);
    setFromReplyId(null);
    setNoteMode(false);
    const el = document.getElementById("composer");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }, [prefill]);

  async function run(name: string, path: string, payload: unknown = {}, confirmText?: string, done?: string) {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await post(path, payload);
      if (done) setNotice(done);
      await onChange();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const suppressed = c.stage === "SUPPRESSED";
  const closed = suppressed || !!c.resolvedAt;
  const draft = detail.replies.find((r) => r.status === "DRAFT" && r.author === "AI");
  const pending = detail.replies.filter((r) => r.status === "PENDING_APPROVAL" || r.status === "WAITING" || r.status === "QUEUED");
  const rejected = detail.replies.find((r) => r.status === "REJECTED" && !draft && detail.replies.indexOf(r) === 0);
  const who = c.contactName ?? c.email;

  async function send() {
    const text = body.trim();
    if (!text) return;
    if (noteMode) {
      if (await run("note", `/conversations/${id}/notes`, { text }, undefined, "Note added — only your team (and the AI) can see it.")) setBody("");
      return;
    }
    if (await run("send", `/conversations/${id}/reply`, { body: text, fromReplyId }, undefined, "Reply handed to the Policy Engine — it goes out after the final checks.")) {
      setBody("");
      setFromReplyId(null);
    }
  }

  return (
    <div className="card overflow-hidden" data-tone="email">
      {/* header */}
      <div className="space-y-3 border-b border-line p-4">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg lg:hidden">
          <ArrowLeft className="size-3.5" /> Inbox
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{c.subject}</h2>
            <p className="truncate text-sm text-muted">
              {who}
              {c.contactName ? ` · ${c.email}` : ""}
              {detail.company ? (
                <>
                  {" · "}
                  <Link href={`/companies/${detail.company.id}`} className="text-accent hover:underline">
                    {detail.company.name}
                  </Link>
                </>
              ) : null}
            </p>
          </div>
          {can("conversation.takeover") && !suppressed && (
            <div className="flex flex-wrap items-center gap-2">
              <ModeSwitch mode={c.mode} busy={busy === "mode"} onChange={(mode) => void run("mode", `/conversations/${id}/mode`, { mode })} />
              {c.mode !== "HUMAN" ? (
                <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void run("mode", `/conversations/${id}/takeover`, {}, undefined, "You have the conversation. The AI won't reply — it still reads and suggests.")}>
                  <Hand className="size-4" /> Take over
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => void run("mode", `/conversations/${id}/mode`, { mode: "ASSIST" }, undefined, "Back to the AI (Assist): it drafts, you send.")}>
                  <Bot className="size-4" /> Return to AI
                </button>
              )}
            </div>
          )}
        </div>
        <Banners detail={detail} />
        {notice && <div className="rounded-lg border border-line bg-raised px-3 py-2 text-sm">{notice}</div>}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            <CircleAlert className="size-4 shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* messages */}
      <ol className="space-y-4 bg-canvas/40 p-4">
        {detail.messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </ol>

      {/* replies in flight */}
      <div className="space-y-3 border-t border-line p-4">
        {pending.map((r) => (
          <PendingReply
            key={r.id}
            r={r}
            canDecide={can("approval.decide")}
            canSend={can("conversation.send")}
            busy={busy}
            onApprove={(approvalId) => void run("approve", `/policy/approvals/${approvalId}/approve`, {}, undefined, "Approved — checked again and sent.")}
            onReject={(approvalId) => void run("reject", `/policy/approvals/${approvalId}/reject`, {}, undefined, "Rejected — nothing was sent.")}
            onWithdraw={() => void run("discard", `/conversations/${id}/replies/${r.id}/discard`, {}, "Withdraw this reply? It won't be sent.")}
          />
        ))}
        {draft && !closed && (
          <DraftCard
            r={draft}
            canSend={can("conversation.send")}
            busy={busy}
            onUse={() => {
              setBody(draft.body);
              setFromReplyId(draft.id);
              setNoteMode(false);
            }}
            onSendAsIs={() => void run("send", `/conversations/${id}/reply`, { body: draft.body, fromReplyId: draft.id }, undefined, "Sent to the Policy Engine — it goes out after the final checks.")}
            onDiscard={() => void run("discard", `/conversations/${id}/replies/${draft.id}/discard`)}
            onFeedback={(rating) => void run("feedback", `/conversations/${id}/replies/${draft.id}/feedback`, { rating }, undefined, "Thanks — feedback saved for review.")}
          />
        )}
        {rejected && !closed && (
          <div className="rounded-xl border border-danger/25 bg-danger-soft/50 p-3 text-sm">
            <div className="flex items-center gap-1.5 font-medium text-danger">
              <CircleX className="size-4" /> The AI draft failed its checks
            </div>
            <p className="mt-1 text-muted">{rejected.statusReason}</p>
            <p className="mt-1 text-muted">Nothing was sent. Write the reply yourself, or ask for a new suggestion.</p>
          </div>
        )}

        {/* composer */}
        {!suppressed && (can("conversation.send") || noteMode) && (
          <div className={`rounded-xl border p-3 ${noteMode ? "border-amber/40 bg-amber-soft/40" : "border-line bg-surface"}`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 text-xs">
                <button type="button" onClick={() => setNoteMode(false)} className={`rounded-md px-2 py-1 font-medium ${!noteMode ? "bg-tone-soft text-tone" : "text-muted hover:text-fg"}`}>
                  <Send className="mr-1 inline size-3.5" />
                  Reply
                </button>
                <button type="button" onClick={() => setNoteMode(true)} className={`rounded-md px-2 py-1 font-medium ${noteMode ? "bg-amber-soft text-amber" : "text-muted hover:text-fg"}`}>
                  <StickyNote className="mr-1 inline size-3.5" />
                  Internal note
                </button>
              </div>
              {!noteMode && (
                <button type="button" className="btn btn-ghost text-xs" disabled={!!busy} onClick={() => void run("suggest", `/conversations/${id}/suggest`, {}, undefined, "New AI suggestion below — nothing was sent.")}>
                  {busy === "suggest" ? <Loader className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Suggest a reply
                </button>
              )}
            </div>
            <label className="sr-only" htmlFor="composer">
              {noteMode ? "Internal note" : `Reply to ${who}`}
            </label>
            <textarea
              id="composer"
              className="input min-h-28 w-full resize-y"
              placeholder={noteMode ? "Only your team sees this. The AI reads it as context." : `Write to ${who}…`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                {noteMode
                  ? "Never sent to the prospect."
                  : fromReplyId
                    ? "Editing the AI draft — your edits are kept as feedback."
                    : "Your name is added as the signature. Suppression and the kill switch are checked before it goes."}
              </p>
              <button type="button" className={`btn ${noteMode ? "btn-secondary" : "btn-primary"}`} disabled={!!busy || !body.trim()} onClick={() => void send()}>
                {busy === "send" || busy === "note" ? <Loader className="size-4 animate-spin" /> : noteMode ? <StickyNote className="size-4" /> : <Send className="size-4" />}
                {noteMode ? "Add note" : "Send reply"}
              </button>
            </div>
          </div>
        )}

        {/* thread actions */}
        <div className="flex flex-wrap gap-2 pt-1">
          {can("conversation.takeover") &&
            (c.resolvedAt || c.stage === "CLOSED" ? (
              !suppressed && (
                <button type="button" className="btn btn-ghost text-xs" disabled={!!busy} onClick={() => void run("reopen", `/conversations/${id}/reopen`)}>
                  <RotateCcw className="size-3.5" /> Reopen
                </button>
              )
            ) : (
              <>
                <button type="button" className="btn btn-ghost text-xs" disabled={!!busy} onClick={() => void run("resolve", `/conversations/${id}/resolve`, { reason: null }, undefined, "Marked resolved.")}>
                  <CircleCheck className="size-3.5" /> Mark resolved
                </button>
                <SnoozeMenu disabled={!!busy || suppressed} onPick={(until, label) => void run("snooze", `/conversations/${id}/snooze`, { until }, undefined, `Snoozed until ${label}.`)} />
              </>
            ))}
          {can("company.update") && !suppressed && (
            <button
              type="button"
              className="btn btn-ghost text-xs text-danger"
              disabled={!!busy}
              onClick={() => void run("dnc", `/conversations/${id}/do-not-contact`, { reason: null }, `Put ${c.email} on the do-not-contact list? Nothing more will be sent to this address.`, "Added to the do-not-contact list.")}
            >
              <Ban className="size-3.5" /> Do not contact
            </button>
          )}
        </div>

        {detail.mailbox?.testMailbox && can("campaign.create") && !suppressed && <Simulator onSend={(text) => void run("simulate", `/conversations/${id}/simulate`, { text }, undefined, "Message arrived. The AI reads it within a few seconds (needs the worker running).")} busy={busy === "simulate"} />}
      </div>
    </div>
  );
}

function ModeSwitch({ mode, busy, onChange }: { mode: ConversationMode; busy: boolean; onChange: (m: ConversationMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Who replies" className="inline-flex rounded-lg border border-line bg-raised p-0.5">
      {(["AUTO", "ASSIST", "HUMAN"] as ConversationMode[]).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          title={MODE_INFO[m].description}
          disabled={busy}
          onClick={() => mode !== m && onChange(m)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === m ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"}`}
        >
          {MODE_INFO[m].label}
        </button>
      ))}
    </div>
  );
}

function Banners({ detail }: { detail: ConversationDetail }) {
  const c = detail.conversation;
  const items: { tone: "amber" | "danger" | "muted"; text: string }[] = [];
  if (c.stage === "SUPPRESSED") items.push({ tone: "danger", text: "They asked not to be contacted. Nothing can be sent — the address is on the do-not-contact list." });
  else if (c.needsHuman && c.escalationReason) items.push({ tone: "amber", text: `Needs you: ${c.escalationReason}` });
  if (c.takenOver && c.mode === "HUMAN") items.push({ tone: "muted", text: `Taken over by ${c.takenOver.by ?? "a person"} ${formatAgo(c.takenOver.at)}. The AI won't reply.` });
  if (c.mode === "AUTO" && detail.policy.aiRepliesNeedApproval && c.stage !== "SUPPRESSED")
    items.push({ tone: "muted", text: `Auto mode, but autonomy is ${detail.policy.autonomyLevel}: each AI reply waits for approval (L3 lets routine replies go on their own).` });
  if (detail.policy.outboundState !== "ACTIVE") items.push({ tone: "danger", text: `Outbound is ${detail.policy.outboundState === "PAUSED" ? "paused" : "emergency-stopped"} — replies wait until it is back on.` });
  if (!items.length) return null;
  const style = { amber: "border-amber/30 bg-amber-soft text-amber", danger: "border-danger/25 bg-danger-soft text-danger", muted: "border-line bg-raised text-muted" };
  return (
    <div className="space-y-2">
      {items.map((b) => (
        <div key={b.text} className={`rounded-lg border px-3 py-2 text-sm ${style[b.tone]}`}>
          {b.text}
        </div>
      ))}
    </div>
  );
}

function Message({ m }: { m: ThreadMessage }) {
  if (m.direction === "INTERNAL") {
    return (
      <li className="rounded-xl border border-dashed border-amber/40 bg-amber-soft/40 px-3.5 py-2.5 text-sm">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber">
          <StickyNote className="size-3.5" /> Note by {m.authorName ?? "a teammate"} · {formatAgo(m.occurredAt)}
        </div>
        <p className="whitespace-pre-wrap">{m.text}</p>
      </li>
    );
  }
  const inbound = m.direction === "INBOUND";
  const by = inbound ? (m.fromEmail ?? "Prospect") : m.author === "AI" ? (m.fromCampaign ? "Campaign email (AI)" : "AI reply") : `You${m.authorName ? ` · ${m.authorName}` : ""}`;
  const cls = m.classification;
  return (
    <li className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[92%] rounded-2xl border px-3.5 py-3 text-sm sm:max-w-[80%] ${inbound ? "rounded-tl-sm border-line bg-surface" : "rounded-tr-sm border-tone/20 bg-tone-soft"}`}>
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="font-medium text-fg">{by}</span>
          <span>{formatAgo(m.occurredAt)}</span>
          {m.kind === "AUTO_REPLY" && <span className="badge text-[10px]">Automatic reply</span>}
        </div>
        <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>
        {cls && (
          <div className="mt-2.5 space-y-1.5 border-t border-line pt-2">
            <div className="flex flex-wrap items-center gap-1">
              <span className={`badge text-[10px] ${intentStyle(cls.primaryIntent)}`}>{INTENT_INFO[cls.primaryIntent]?.label ?? cls.primaryIntent}</span>
              {cls.secondaryIntents.map((i) => (
                <span key={i} className="badge text-[10px]">
                  + {INTENT_INFO[i]?.label ?? i}
                </span>
              ))}
              {cls.riskFlags.map((f) => (
                <span key={f} className="badge border-danger/25 bg-danger-soft text-[10px] text-danger">
                  {RISK_INFO[f as RiskFlag] ?? f}
                </span>
              ))}
              <span className="ml-auto text-[10px] text-faint">
                {cls.method === "AI" ? "read by the Inbox Agent" : cls.method === "RULES" ? "read by rules" : "rules (AI unavailable)"} · {cls.confidence.toLowerCase()} confidence
              </span>
            </div>
            {cls.questions.length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted">
                {cls.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function DraftCard({ r, canSend, busy, onUse, onSendAsIs, onDiscard, onFeedback }: { r: Reply; canSend: boolean; busy: string | null; onUse: () => void; onSendAsIs: () => void; onDiscard: () => void; onFeedback: (rating: "UP" | "DOWN") => void }) {
  const [open, setOpen] = useState(false);
  const failed = r.validation.filter((v) => !v.ok);
  return (
    <div className="rounded-xl border border-tone-ai/25 bg-tone-ai-soft/60 p-3" data-tone="ai">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-tone-ai">
          <Sparkles className="size-4" /> AI draft{r.stale ? " (for an earlier message)" : ""}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Good draft" className={`btn btn-ghost px-2 ${r.feedback?.rating === "UP" ? "text-brand" : ""}`} disabled={!!busy} onClick={() => onFeedback("UP")}>
            <ThumbsUp className="size-3.5" />
          </button>
          <button type="button" aria-label="Bad draft" className={`btn btn-ghost px-2 ${r.feedback?.rating === "DOWN" ? "text-danger" : ""}`} disabled={!!busy} onClick={() => onFeedback("DOWN")}>
            <ThumbsDown className="size-3.5" />
          </button>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed">{r.body}</p>
      {(r.unanswered.length > 0 || r.statusReason) && (
        <div className="mt-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
          {r.unanswered.length > 0 ? (
            <>
              <span className="font-medium">Not answered — the AI won't invent it:</span> {r.unanswered.join(" · ")}
            </>
          ) : (
            r.statusReason
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen(!open)} className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-fg" aria-expanded={open}>
        <ShieldCheck className="size-3.5" /> {failed.length ? `${failed.length} check(s) flagged` : `All ${r.validation.length} checks passed`}
        {r.answered.length ? ` · ${r.answered.length} answered from approved knowledge` : ""}
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          {r.answered.map((a) => (
            <div key={a.question} className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="font-medium">“{a.question}”</div>
              <div className="text-muted">
                {a.answer} <span className="text-faint">— from {a.source === "OFFER" ? "the campaign offer" : a.source === "THREAD" ? "the conversation" : "the company record"}</span>
              </div>
            </div>
          ))}
          <ul className="grid gap-1 sm:grid-cols-2">
            {r.validation.map((v) => (
              <li key={v.validator} className="flex items-start gap-1.5">
                {v.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-brand" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-danger" />}
                <span>{VALIDATOR_LABEL[v.validator] ?? v.validator}{v.ok ? "" : ` — ${v.detail}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {canSend && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={!!busy} onClick={onSendAsIs}>
            {busy === "send" ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />} Send as is
          </button>
          <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={onUse}>
            Edit first
          </button>
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={onDiscard}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

function PendingReply({ r, canDecide, canSend, busy, onApprove, onReject, onWithdraw }: { r: Reply; canDecide: boolean; canSend: boolean; busy: string | null; onApprove: (id: string) => void; onReject: (id: string) => void; onWithdraw: () => void }) {
  const s = REPLY_STATUS[r.status];
  return (
    <div className="rounded-xl border border-amber/30 bg-amber-soft/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`badge ${s.className}`}>{s.label}</span>
        <span className="text-muted">{r.author === "AI" ? "AI reply" : `Your reply${r.authorName ? ` (${r.authorName})` : ""}`}</span>
        {r.status === "WAITING" && r.resumeAt && <span className="text-xs text-muted">· goes at {new Date(r.resumeAt).toLocaleString()}</span>}
      </div>
      {r.statusReason && <p className="mt-1 text-xs text-muted">{r.statusReason}</p>}
      <p className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-relaxed">{r.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {r.approvalId && canDecide && (
          <>
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => onApprove(r.approvalId!)}>
              {busy === "approve" ? <Loader className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Approve & send
            </button>
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => onReject(r.approvalId!)}>
              Reject
            </button>
          </>
        )}
        {canSend && r.status !== "QUEUED" && (
          <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={onWithdraw}>
            Withdraw
          </button>
        )}
      </div>
    </div>
  );
}

function SnoozeMenu({ disabled, onPick }: { disabled: boolean; onPick: (iso: string, label: string) => void }) {
  const options: [string, number][] = [
    ["tomorrow", 1],
    ["next week", 7],
    ["next month", 30],
  ];
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Snooze</span>
      <AlarmClock className="pointer-events-none absolute left-2.5 size-3.5 text-muted" />
      <select
        className="input h-auto py-1.5 pl-7 pr-7 text-xs"
        disabled={disabled}
        value=""
        onChange={(e) => {
          const days = Number(e.target.value);
          const label = options.find(([, d]) => d === days)?.[0] ?? "";
          const until = new Date(Date.now() + days * 86_400_000);
          until.setHours(9, 0, 0, 0);
          if (days) onPick(until.toISOString(), label);
        }}
      >
        <option value="">Snooze…</option>
        {options.map(([label, d]) => (
          <option key={d} value={d}>
            Until {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Simulator({ onSend, busy }: { onSend: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <details className="rounded-xl border border-dashed border-line p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted">
        <FlaskConical className="size-3.5" /> Test mailbox: write as the prospect
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SIMULATIONS.map(([label, t]) => (
          <button key={label} type="button" className="badge hover:bg-hover" onClick={() => setText(t)}>
            {label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="simulate">
        Message from the prospect
      </label>
      <textarea id="simulate" className="input mt-2 min-h-20 w-full" placeholder="What the prospect writes…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !text.trim()}
          onClick={() => {
            onSend(text.trim());
            setText("");
          }}
        >
          {busy ? <Loader className="size-4 animate-spin" /> : <Send className="size-4" />} Receive
        </button>
      </div>
    </details>
  );
}
