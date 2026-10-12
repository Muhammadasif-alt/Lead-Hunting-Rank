"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, CircleAlert, FileUp, Loader, MessageCircleQuestion, ShieldAlert, Sparkles, X } from "lucide-react";
import { formatMoney, INTEGRATION_STATUS_LABEL, KNOWLEDGE_FIELDS, QUESTION_TOPIC_LABEL, type IntegrationStatus, type KnowledgeType } from "@revenue-os/shared";
import { errorMessage, post } from "@/lib/api";
import { agoOf, bytes, dateOf, KSTATUS_STYLE, ORIGIN_LABEL, uploadFile, type DocumentRow, type Gap, type ReviewQueue, type Simulation } from "@/lib/knowledge";

const pretty = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Read-only structured view of one revision's content — labels from the shared field spec. */
export function ContentView({ type, content }: { type: KnowledgeType; content: Record<string, unknown> }) {
  const currency = String(content.currency || "USD");
  const rows = KNOWLEDGE_FIELDS[type].filter((f) => {
    const v = content[f.key];
    return !(v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0));
  });
  if (!rows.length) return <p className="text-sm text-muted">No content yet.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((f) => {
        const v = content[f.key];
        const wide = f.kind === "textarea" || f.kind === "rows" || f.kind === "list";
        let body: React.ReactNode;
        if (f.kind === "list")
          body = (
            <ul className="list-disc space-y-0.5 pl-4">
              {(v as string[]).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          );
        else if (f.kind === "boolean") body = v ? <span className="text-tone">Yes</span> : <span className="text-muted">No</span>;
        else if (f.kind === "money") body = formatMoney(v as number, currency);
        else if (f.kind === "select") body = f.key === "status" && type === "INTEGRATION" ? INTEGRATION_STATUS_LABEL[v as IntegrationStatus] : pretty(String(v));
        else if (f.kind === "rows")
          body = (
            <ul className="space-y-1">
              {(v as Record<string, unknown>[]).map((r, i) => (
                <li key={i} className="rounded border border-line px-2 py-1">
                  {(f.fields ?? [])
                    .map((c) => (r[c.key] === null || r[c.key] === "" || r[c.key] === undefined ? null : c.kind === "money" ? formatMoney(r[c.key] as number, currency) : c.kind === "boolean" ? (r[c.key] ? c.label : null) : c.key === "percent" ? `${String(r[c.key])}%` : String(r[c.key])))
                    .filter(Boolean)
                    .join(" — ") || (f.fields?.some((c) => c.kind === "money") ? "Custom (a person quotes)" : "")}
                </li>
              ))}
            </ul>
          );
        else body = <span className="whitespace-pre-wrap">{String(v)}</span>;
        return (
          <div key={f.key} className={wide ? "sm:col-span-2" : ""}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-faint">{f.label}</dt>
            <dd className="mt-0.5 text-sm">{body}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge text-[10px] ${KSTATUS_STYLE[status] ?? ""}`}>{pretty(status === "STALE" ? "needs revalidation" : status)}</span>;
}

// ───────────────────────────── gaps ─────────────────────────────

const PRIORITY_STYLE: Record<string, string> = { HIGH: "border-danger/30 bg-danger-soft text-danger", MEDIUM: "border-amber/30 bg-amber-soft text-amber", LOW: "" };

/** Questions the AI could not answer (screen #13 §47-50): answer one → a draft FAQ → approve → the AI answers next time. */
export function GapsPanel({ gaps, canManage, onChange }: { gaps: Gap[]; canManage: boolean; onChange: () => void }) {
  if (!gaps.length)
    return (
      <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
        <MessageCircleQuestion className="size-8 text-tone" />
        <p className="font-medium">No open knowledge gaps</p>
        <p className="max-w-md text-sm text-muted">When a prospect asks something the approved knowledge can’t answer, it appears here — how often, where, and how much pipeline is waiting on it.</p>
      </div>
    );
  return (
    <ul className="space-y-2">
      {gaps.map((g) => (
        <li key={g.id}>
          <GapRow g={g} canManage={canManage} onChange={onChange} />
        </li>
      ))}
    </ul>
  );
}

function GapRow({ g, canManage, onChange }: { g: Gap; canManage: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await post(path, body);
      setOpen(false);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`badge text-[10px] ${PRIORITY_STYLE[g.priority]}`}>{g.priority}</span>
            <span className="badge text-[10px]">{g.topicLabel}</span>
            {g.status !== "OPEN" && <span className="badge text-[10px]">{pretty(g.status)}</span>}
          </div>
          <p className="mt-1.5 font-medium">“{g.question}”</p>
          <p className="mt-0.5 text-xs text-muted">
            {g.reasons.join(" · ")}
            {g.companies.length ? ` · ${g.companies.join(", ")}` : ""} · last asked {agoOf(g.lastSeenAt)}
          </p>
          {g.draft && (
            <p className="mt-1 text-xs">
              Draft answer:{" "}
              <Link href={`/knowledge/${g.draft.id}`} className="text-tone hover:underline">
                {g.draft.code}
              </Link>{" "}
              — waiting for approval
            </p>
          )}
        </div>
        {canManage && g.status === "OPEN" && (
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn btn-primary h-8 text-xs" onClick={() => setOpen((o) => !o)}>
              Answer
            </button>
            <button type="button" className="btn btn-ghost h-8 text-xs" disabled={busy} onClick={() => { const reason = window.prompt('Why dismiss? (e.g. "Not our business")'); if (reason) void act(`/knowledge/gaps/${g.id}/dismiss`, { reason }); }}>
              Dismiss
            </button>
          </div>
        )}
      </div>
      {open && (
        <form
          className="mt-3 space-y-2 border-t border-line pt-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void act(`/knowledge/gaps/${g.id}/answer`, { answer, submit: true });
          }}
        >
          <textarea className="input min-h-24 w-full py-2" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="The approved answer, in general terms (it becomes an FAQ draft)" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost h-8 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary h-8 text-xs" disabled={busy || answer.trim().length < 3}>
              {busy ? <Loader className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save as FAQ draft
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

// ───────────────────────────── review queue ─────────────────────────────

export function ReviewPanel({ data, canApprove, canCommercial, onChange }: { data: ReviewQueue; canApprove: boolean; canCommercial: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function act(key: string, path: string, body: unknown = {}) {
    setBusy(key);
    setError(null);
    try {
      await post(path, body);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }
  const empty = !data.drafts.length && !data.conflicts.length && !data.stale.length;
  if (empty) return <p className="card px-4 py-10 text-center text-sm text-muted">Nothing to review. Drafts, conflicts and knowledge past its review date appear here.</p>;
  const commercial = (t: KnowledgeType) => t === "PRICING" || t === "POLICY" || t === "CLAIM";
  return (
    <div className="space-y-5">
      {error && <div className="card border-danger/30 bg-danger-soft px-4 py-2 text-sm text-danger">{error}</div>}
      {data.conflicts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Conflicts · the AI answers from neither side</h2>
          <ul className="space-y-2">
            {data.conflicts.map((c) => (
              <li key={c.id} className="card flex flex-col gap-2 border-danger/30 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <ShieldAlert className="size-4 text-danger" /> {c.topic}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{c.detail}</p>
                  <p className="mt-1 text-xs">
                    {c.item && (
                      <Link className="text-tone hover:underline" href={`/knowledge/${c.item.id}`}>
                        {c.item.code}
                      </Link>
                    )}
                    {c.other && (
                      <>
                        {" vs "}
                        <Link className="text-tone hover:underline" href={`/knowledge/${c.other.id}`}>
                          {c.other.code}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {canApprove && (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="btn btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => { const note = window.prompt("How was it resolved? (e.g. archived the old price)"); if (note) void act(c.id, `/knowledge/conflicts/${c.id}/resolve`, { resolution: "RESOLVED", note }); }}>
                      Resolved
                    </button>
                    <button type="button" className="btn btn-ghost h-8 text-xs" disabled={!!busy} onClick={() => void act(c.id, `/knowledge/conflicts/${c.id}/resolve`, { resolution: "DISMISSED", note: "Not a real conflict" })}>
                      Not a conflict
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.drafts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Drafts waiting for approval</h2>
          <ul className="space-y-2">
            {data.drafts.map((d) => (
              <li key={d.revisionId} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`badge text-[10px] ${d.priority === "HIGH" ? "border-danger/30 bg-danger-soft text-danger" : d.priority === "MEDIUM" ? "border-amber/30 bg-amber-soft text-amber" : ""}`}>{d.priority}</span>
                    <StatusBadge status={d.status} />
                    <span className="text-xs text-faint">{d.code} · v{d.version}</span>
                  </div>
                  <Link href={`/knowledge/${d.itemId}`} className="mt-1 block truncate text-sm font-medium hover:underline">
                    {d.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {d.isUpdate ? "Update to live knowledge" : "New"} · {ORIGIN_LABEL[d.origin] ?? d.origin}
                    {d.source ? ` (${d.source})` : ""}
                    {d.effectiveFrom ? ` · effective ${dateOf(d.effectiveFrom)}` : ""}
                  </p>
                </div>
                {canApprove && (
                  <div className="flex shrink-0 gap-2">
                    <button type="button" className="btn btn-primary h-8 text-xs" disabled={!!busy || (commercial(d.type) && !canCommercial)} title={commercial(d.type) && !canCommercial ? "Pricing, policies and claims need the owner" : undefined} onClick={() => void act(d.revisionId, `/knowledge/items/${d.itemId}/approve`)}>
                      {busy === d.revisionId ? <Loader className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                    </button>
                    <button type="button" className="btn btn-ghost h-8 text-xs" disabled={!!busy} onClick={() => { const reason = window.prompt("Why reject?"); if (reason) void act(d.revisionId, `/knowledge/items/${d.itemId}/reject`, { reason }); }}>
                      <X className="size-3.5" /> Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.stale.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Needs revalidation</h2>
          <ul className="space-y-2">
            {data.stale.map((s) => (
              <li key={s.id} className="card flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={`/knowledge/${s.id}`} className="block truncate text-sm font-medium hover:underline">
                    {s.title}
                  </Link>
                  <p className="text-xs text-muted">
                    {s.code} · {s.needsReviewReason ?? `review was due ${dateOf(s.nextReviewAt)}`} · used {s.usageCount}×
                  </p>
                </div>
                {canApprove && (
                  <button type="button" className="btn btn-secondary h-8 shrink-0 text-xs" disabled={!!busy || (commercial(s.type) && !canCommercial)} onClick={() => void act(s.id, `/knowledge/items/${s.id}/reviewed`)}>
                    <Check className="size-3.5" /> Still correct
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ───────────────────────────── documents ─────────────────────────────

export function DocumentsPanel({ docs, canManage, onChange }: { docs: DocumentRow[]; canManage: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await uploadFile(file);
      setNotice(r.duplicate ? `${file.name} was already uploaded.` : `${file.name} uploaded — candidates appear in Review in a moment.`);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {canManage && (
        <label className="card flex cursor-pointer flex-col items-center gap-2 border-dashed px-6 py-8 text-center hover:border-line-strong">
          {busy ? <Loader className="size-6 animate-spin text-tone" /> : <FileUp className="size-6 text-tone" />}
          <span className="text-sm font-medium">Upload a document</span>
          <span className="max-w-md text-xs text-muted">PDF, DOCX, TXT, Markdown or CSV, up to 10 MB. A document is a source, not truth: FAQs and prices found in it become drafts for review, and anything that contradicts approved knowledge is flagged.</span>
          <input type="file" className="sr-only" accept=".pdf,.docx,.txt,.md,.markdown,.csv" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} />
        </label>
      )}
      {notice && <p className="text-sm text-tone">{notice}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      {!docs.length ? (
        <p className="card px-4 py-8 text-center text-sm text-muted">No documents yet.</p>
      ) : (
        <ul className="card divide-y divide-line">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.fileName}</p>
                <p className="text-xs text-muted">
                  {bytes(d.sizeBytes)} · uploaded {agoOf(d.uploadedAt)}
                  {d.uploadedBy ? ` by ${d.uploadedBy}` : ""}
                  {d.statusReason ? ` · ${d.statusReason}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5 text-xs">
                <span className={`badge text-[10px] ${d.status === "EXTRACTED" ? "border-tone/30 bg-tone-soft text-tone" : d.status === "FAILED" ? "border-danger/30 bg-danger-soft text-danger" : ""}`}>{pretty(d.status)}</span>
                {d.status === "EXTRACTED" && <span className="badge text-[10px]">{d.candidates} candidates</span>}
                {d.conflicts > 0 && <span className="badge border-danger/30 bg-danger-soft text-[10px] text-danger">{d.conflicts} conflicts</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────────────────────── simulator ─────────────────────────────

/** AI Answer Simulator (screen #13 §51): test the Business Brain before a prospect does. Nothing is sent. */
export function SimulatorPanel() {
  const [q, setQ] = useState("Can you integrate with Jobber and how much would it cost for 10 locations?");
  const [res, setRes] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRes(await post<Simulation>("/knowledge/simulate", { question: q }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const OUTCOME: Record<string, string> = { ANSWER: "The AI would answer everything", PARTIAL: "The AI would answer part and hand the rest to a person", ESCALATE: "A person answers this" };
  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void run(e)} className="card space-y-3 p-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium">Prospect asks</span>
          <textarea className="input min-h-20 w-full py-2" value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} />
        </label>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Uses only approved, current knowledge — exactly what the Conversation Agent would get.</p>
          <button type="submit" className="btn btn-primary" disabled={busy || q.trim().length < 3}>
            {busy ? <Loader className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Ask
          </button>
        </div>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
      {res && (
        <div className="space-y-3">
          <div className={`card px-4 py-3 text-sm font-medium ${res.outcome === "ANSWER" ? "border-tone/30 bg-tone-soft text-tone" : res.outcome === "PARTIAL" ? "border-amber/30 bg-amber-soft text-amber" : "border-danger/30 bg-danger-soft text-danger"}`}>
            {OUTCOME[res.outcome]}
            <span className="ml-2 text-xs font-normal opacity-80">
              {res.approvedItems} approved items · semantic search {res.semantic ? "on" : "off (keywords + structured records)"}
            </span>
          </div>
          {res.answers.map((a, i) => (
            <div key={i} className="card p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`badge text-[10px] ${a.decision === "ANSWER" ? "border-tone/30 bg-tone-soft text-tone" : "border-amber/30 bg-amber-soft text-amber"}`}>{a.decision === "ANSWER" ? "Answer" : "Person"}</span>
                <span className="badge text-[10px]">{QUESTION_TOPIC_LABEL[a.topic]}</span>
                {a.gap && <span className="badge border-danger/30 bg-danger-soft text-[10px] text-danger">Knowledge gap</span>}
              </div>
              <p className="mt-1.5 text-sm font-medium">“{a.question}”</p>
              {a.answer ? <p className="mt-1 text-sm">{a.answer}</p> : <p className="mt-1 text-sm text-muted">{a.reason}</p>}
              {a.used.length > 0 && (
                <p className="mt-1.5 text-xs text-muted">
                  Used:{" "}
                  {a.used.map((u, j) => (
                    <span key={u.revisionId}>
                      {j > 0 && ", "}
                      <Link className="text-tone hover:underline" href={`/knowledge/${u.itemId}`}>
                        {u.code} v{u.version}
                      </Link>{" "}
                      {u.title}
                    </span>
                  ))}
                </p>
              )}
              {a.conflicts.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                  <CircleAlert className="size-3.5" /> Conflict: {a.conflicts.join(", ")}
                </p>
              )}
              {a.caveat && <p className="mt-1 text-xs text-amber">{a.caveat}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
