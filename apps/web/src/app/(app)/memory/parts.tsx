"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Ban, Check, CheckCircle2, CircleAlert, Loader, Pencil, Plus, Quote, ShieldCheck, X } from "lucide-react";
import { api, errorMessage, post } from "@/lib/api";
import { agoOf, dateOf } from "@/lib/knowledge";
import { dueOf, MSTATUS_STYLE, ORIGIN_STYLE, WHO, type Candidate, type CommitmentRow, type MemoryConflictRow, type MemoryDetail, type MemoryRow, type RelationshipRow } from "@/lib/memory";

const ORIGIN_SHORT: Record<string, string> = { DIRECT_STATEMENT: "They said", MEETING_NOTE: "Meeting", HUMAN_NOTE: "Note", HUMAN_CORRECTION: "Corrected", AI_INFERENCE: "AI guess" };

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (name: string, path: string, body: unknown = {}) => {
    setBusy(name);
    setError(null);
    try {
      await post(path, body);
      onDone();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

export function Empty({ text }: { text: string }) {
  return <p className="card px-4 py-8 text-center text-sm text-muted">{text}</p>;
}

export function OriginBadge({ origin }: { origin: string }) {
  return <span className={`badge text-[10px] ${ORIGIN_STYLE[origin] ?? ""}`}>{ORIGIN_SHORT[origin] ?? origin}</span>;
}

/** Memory rows: what the AI remembers, where it came from and how fresh it is. Facts and AI guesses look different. */
export function MemoryList({ rows, onOpen, showCompany = true }: { rows: MemoryRow[]; onOpen: (id: string) => void; showCompany?: boolean }) {
  return (
    <ul className="space-y-2">
      {rows.map((m) => (
        <li key={m.id}>
          <button type="button" onClick={() => onOpen(m.id)} className={`card flex w-full flex-col gap-1.5 p-3 text-left hover:border-line-strong sm:flex-row sm:items-center ${m.status === "CONFLICTED" ? "border-danger/30" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">{m.label}</span>
                <OriginBadge origin={m.origin} />
                {m.status !== "ACTIVE" && <span className={`badge text-[10px] ${MSTATUS_STYLE[m.status] ?? ""}`}>{m.status.toLowerCase()}</span>}
                {!m.useInOutreach && <span className="text-[10px] text-faint">not used in outreach</span>}
              </div>
              <div className={`text-sm font-medium ${m.status === "INVALIDATED" ? "line-through text-faint" : ""}`}>{m.value}</div>
              {m.quote && <div className="truncate text-xs text-faint">“{m.quote}”</div>}
            </div>
            <div className="shrink-0 text-xs text-faint sm:text-right">
              {showCompany && m.company && <div className="text-muted">{m.company}</div>}
              <div>{agoOf(m.observedAt)}</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One memory with its evidence, history and audit — confirm, correct or invalidate it (screen #12 §30-45). */
export function MemoryDrawer({ id, canManage, onClose, onChange }: { id: string; canManage: boolean; onClose: () => void; onChange: () => void }) {
  const [d, setD] = useState<MemoryDetail | null>(null);
  const [mode, setMode] = useState<null | "correct" | "invalidate">(null);
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setD(await api<MemoryDetail>(`/memory/memories/${id}`));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  const { busy, error, run } = useAction(() => {
    setMode(null);
    setText("");
    setReason("");
    onChange();
    void load();
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "correct" && text.trim()) await run("correct", `/memory/memories/${id}/correct`, { value: text.trim(), reason: reason.trim() || null });
    if (mode === "invalidate" && reason.trim()) await run("invalidate", `/memory/memories/${id}/invalidate`, { reason: reason.trim() });
  }

  const m = d?.memory;
  const live = m && (m.status === "ACTIVE" || m.status === "STALE" || m.status === "CONFLICTED");
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Memory">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface p-4 shadow-xl sm:p-5" data-tone="ai">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="eyebrow text-[11px]">Memory</div>
          <button type="button" onClick={onClose} className="btn btn-ghost h-8 px-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {!m ? (
          loadError ? (
            <p className="text-sm text-danger">{loadError}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader className="size-4 animate-spin" /> Loading…
            </p>
          )
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">{m.label}</span>
                <OriginBadge origin={m.origin} />
                <span className={`badge text-[10px] ${MSTATUS_STYLE[m.status] ?? ""}`}>{m.status.toLowerCase()}</span>
              </div>
              <p className={`mt-1 text-lg font-semibold ${m.status === "INVALIDATED" ? "line-through text-faint" : ""}`}>{m.value}</p>
              <p className="text-xs text-muted">
                {m.company ? (
                  <Link href={`/companies/${m.companyId}?tab=memory`} className="hover:text-tone">
                    {m.company}
                  </Link>
                ) : null}
                {m.company ? " · " : ""}
                {m.originLabel} · {m.confidence.toLowerCase()} confidence · seen {dateOf(m.observedAt)}
              </p>
              {m.statusReason && <p className="mt-1 text-xs text-amber">{m.statusReason}</p>}
            </div>

            {canManage && live && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary text-xs" disabled={!!busy} onClick={() => void run("verify", `/memory/memories/${id}/verify`)}>
                  {busy === "verify" ? <Loader className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} Still true
                </button>
                <button type="button" className="btn btn-secondary text-xs" onClick={() => (setMode("correct"), setText(m.value))}>
                  <Pencil className="size-3.5" /> Correct
                </button>
                <button type="button" className="btn btn-ghost text-xs" onClick={() => setMode("invalidate")}>
                  <Ban className="size-3.5" /> Not true / remove
                </button>
              </div>
            )}
            {mode && (
              <form onSubmit={(e) => void submit(e)} className="space-y-2 rounded-md border border-line p-3">
                {mode === "correct" && <input autoFocus className="input w-full" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Correct value" />}
                <input className="input w-full" placeholder={mode === "correct" ? "Why (optional)" : "Why is it wrong or removed?"} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => setMode(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary text-xs" disabled={!!busy || (mode === "correct" ? !text.trim() : !reason.trim())}>
                    {mode === "correct" ? "Save correction" : "Invalidate"}
                  </button>
                </div>
              </form>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}

            <section className="rounded-md border border-line p-3 text-xs">
              <div className="mb-1.5 font-medium">Why the AI keeps this</div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-muted">
                <dt className="text-faint">Type</dt>
                <dd>{d.why.type}</dd>
                <dt className="text-faint">Used for</dt>
                <dd>{d.why.usedFor}</dd>
                <dt className="text-faint">Source</dt>
                <dd>{d.why.source}</dd>
                <dt className="text-faint">Kept</dt>
                <dd>{d.why.retention}</dd>
                <dt className="text-faint">Outreach</dt>
                <dd>{d.why.outreach}</dd>
              </dl>
            </section>

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Evidence</h3>
              {d.evidence.length === 0 ? (
                <p className="text-xs text-muted">No evidence recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {d.evidence.map((e) => (
                    <li key={e.id} className="rounded-md border border-line p-2.5 text-xs">
                      {e.quote && (
                        <p className="flex gap-1.5 text-fg">
                          <Quote className="mt-0.5 size-3 shrink-0 text-faint" /> {e.quote}
                        </p>
                      )}
                      <p className="mt-1 text-faint">
                        {e.sourceType.replace(/_/g, " ").toLowerCase()} · {dateOf(e.observedAt)}
                        {e.message && (
                          <>
                            {" · "}
                            <Link href={`/inbox?c=${e.message.conversationId}`} className="text-tone hover:underline">
                              {e.message.subject || "open message"}
                            </Link>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {d.history.length > 0 && (
              <section>
                <h3 className="mb-1.5 text-sm font-semibold">Earlier values</h3>
                <ul className="space-y-1 text-xs">
                  {d.history.map((h) => (
                    <li key={h.id} className="flex justify-between gap-2">
                      <span className={h.status === "INVALIDATED" ? "line-through text-faint" : "text-muted"}>{h.value}</span>
                      <span className="shrink-0 text-faint">
                        {h.status.toLowerCase()} · {dateOf(h.observedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">Audit</h3>
              {d.audit.length === 0 ? (
                <p className="text-xs text-muted">No changes recorded.</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {d.audit.map((a, i) => (
                    <li key={i}>
                      <span className="text-fg">{a.action.replace(/^memory\./, "").replace(/_/g, " ")}</span>
                      <span className="text-faint">
                        {" "}
                        · {a.actorType.toLowerCase()} · {agoOf(a.at)}
                        {a.reason ? ` · ${a.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Proposed memories a person must confirm — budget, authority, or the AI was unsure (screen #12 §46). */
export function CandidatesPanel({ rows, canManage, onChange }: { rows: Candidate[]; canManage: boolean; onChange: () => void }) {
  const { busy, error, run } = useAction(onChange);
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  if (!rows.length) return <Empty text="Nothing to review. Sensitive or unsure memories wait here before the AI may use them." />;
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      {rows.map((c) => (
        <div key={c.id} className="card space-y-2 p-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">{c.label}</span>
            <OriginBadge origin={c.origin} />
            <span className="text-[11px] text-faint">{c.confidence.toLowerCase()} confidence</span>
            {c.company && (
              <Link href={`/companies/${c.companyId}?tab=memory`} className="ml-auto text-xs text-muted hover:text-tone">
                {c.company}
              </Link>
            )}
          </div>
          {edit?.id === c.id ? (
            <input autoFocus className="input w-full" value={edit.value} onChange={(e) => setEdit({ id: c.id, value: e.target.value })} maxLength={500} aria-label="Value" />
          ) : (
            <p className="text-sm font-medium">{c.value}</p>
          )}
          {c.quote && <p className="text-xs text-faint">“{c.quote}”</p>}
          {c.reason && <p className="text-[11px] text-amber">Needs a person: {c.reason}</p>}
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary h-7 text-xs"
                disabled={!!busy}
                onClick={() => void run(c.id, `/memory/candidates/${c.id}/review`, { action: "ACCEPT", ...(edit?.id === c.id && edit.value.trim() !== c.value ? { value: edit.value.trim() } : {}) }).then((ok) => ok && setEdit(null))}
              >
                <Check className="size-3.5" /> {edit?.id === c.id ? "Save & accept" : "Accept"}
              </button>
              {edit?.id !== c.id && (
                <button type="button" className="btn btn-secondary h-7 text-xs" onClick={() => setEdit({ id: c.id, value: c.value })}>
                  <Pencil className="size-3.5" /> Edit
                </button>
              )}
              <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(c.id, `/memory/candidates/${c.id}/review`, { action: "REJECT" })}>
                <X className="size-3.5" /> Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Two memories disagree — the AI uses neither until a person picks (screen #12 §47). */
export function ConflictsPanel({ rows, canManage, onChange }: { rows: MemoryConflictRow[]; canManage: boolean; onChange: () => void }) {
  const { busy, error, run } = useAction(onChange);
  if (!rows.length) return <Empty text="No conflicting memories." />;
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      {rows.map((c) => (
        <div key={c.id} className="card space-y-3 border-danger/30 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <CircleAlert className="size-4 text-danger" />
            <span className="text-sm font-medium">{c.label}</span>
            {c.company && (
              <Link href={`/companies/${c.companyId}?tab=memory`} className="text-xs text-muted hover:text-tone">
                {c.company}
              </Link>
            )}
            <span className="ml-auto text-[11px] text-faint">{agoOf(c.detectedAt)}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["A", "B"] as const).map((k) => {
              const s = k === "A" ? c.a : c.b;
              return (
                <div key={k} className="rounded-md border border-line p-2.5">
                  <p className="text-sm font-medium">{s?.value ?? "—"}</p>
                  {s && (
                    <p className="mt-0.5 text-[11px] text-faint">
                      {ORIGIN_SHORT[s.origin] ?? s.origin} · {dateOf(s.observedAt)}
                    </p>
                  )}
                  {s?.quote && <p className="mt-1 text-xs text-muted">“{s.quote}”</p>}
                  {canManage && s && (
                    <button type="button" className="btn btn-secondary mt-2 h-7 text-xs" disabled={!!busy} onClick={() => void run(c.id, `/memory/conflicts/${c.id}/resolve`, { keep: k })}>
                      Keep this
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {canManage && (
            <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(c.id, `/memory/conflicts/${c.id}/resolve`, { keep: "BOTH" })}>
              Both are true (different context)
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Promises both ways, with due dates; done needs evidence (screen #12 §50-55). */
export function CommitmentsPanel({ rows, canManage, onChange, showCompany = true }: { rows: CommitmentRow[]; canManage: boolean; onChange: () => void; showCompany?: boolean }) {
  const { busy, error, run } = useAction(onChange);
  const [done, setDone] = useState<{ id: string; evidence: string } | null>(null);
  if (!rows.length) return <Empty text="No open commitments. Promises found in conversations and meetings — ours and theirs — appear here." />;
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      {rows.map((c) => {
        const open = c.status === "OPEN" || c.status === "WAITING" || c.status === "DUE";
        return (
          <div key={c.id} className={`card space-y-2 p-3.5 ${c.overdue ? "border-danger/30" : c.dueToday ? "border-amber/30" : ""}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`badge text-[10px] ${c.direction === "WE_PROMISED" ? "border-tone/30 bg-tone-soft text-tone" : ""}`}>{WHO[c.direction]}</span>
              <span className={`text-xs ${c.overdue ? "text-danger" : c.dueToday ? "text-amber" : "text-muted"}`}>{dueOf(c)}</span>
              {!open && <span className="badge text-[10px] text-faint">{c.status.toLowerCase()}</span>}
              {showCompany && c.company && (
                <Link href={`/companies/${c.companyId}?tab=memory`} className="ml-auto text-xs text-muted hover:text-tone">
                  {c.company}
                </Link>
              )}
            </div>
            <p className="text-sm font-medium">{c.title}</p>
            {c.detail && <p className="text-xs text-muted">{c.detail}</p>}
            {c.quote && <p className="text-xs text-faint">“{c.quote}”</p>}
            <p className="text-[11px] text-faint">
              {c.owner ? `Owner: ${c.owner} · ` : ""}
              {c.origin.replace(/_/g, " ").toLowerCase()}
              {c.conversationId && (
                <>
                  {" · "}
                  <Link href={`/inbox?c=${c.conversationId}`} className="text-tone hover:underline">
                    conversation
                  </Link>
                </>
              )}
              {c.completionEvidence ? ` · done: ${c.completionEvidence}` : ""}
              {c.statusReason ? ` · ${c.statusReason}` : ""}
            </p>
            {canManage && open && (
              <div className="flex flex-wrap items-center gap-2">
                {done?.id === c.id ? (
                  <form
                    className="flex w-full flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(c.id, `/memory/commitments/${c.id}/complete`, { evidence: done.evidence.trim() }).then((ok) => ok && setDone(null));
                    }}
                  >
                    <input autoFocus className="input h-8 min-w-0 flex-1 text-sm" placeholder="How was it kept? (e.g. sent the case study)" value={done.evidence} onChange={(e) => setDone({ id: c.id, evidence: e.target.value })} maxLength={500} />
                    <button type="submit" className="btn btn-primary h-8 text-xs" disabled={!!busy}>
                      Done
                    </button>
                    <button type="button" className="btn btn-ghost h-8 text-xs" onClick={() => setDone(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <button type="button" className="btn btn-secondary h-7 text-xs" onClick={() => setDone({ id: c.id, evidence: "" })}>
                      <CheckCircle2 className="size-3.5" /> Mark done
                    </button>
                    <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(c.id, `/memory/commitments/${c.id}/status`, { status: "CANCELLED", reason: "No longer needed" })}>
                      Cancel
                    </button>
                    {c.direction !== "WE_PROMISED" && c.overdue && (
                      <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(c.id, `/memory/commitments/${c.id}/status`, { status: "BROKEN", reason: "Not kept" })}>
                        Not kept
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AddCommitment({ companyId, conversationId, opportunities, onDone, onCancel }: { companyId: string; conversationId?: string; opportunities?: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const [direction, setDirection] = useState<"WE_PROMISED" | "PROSPECT_PROMISED" | "MUTUAL">("WE_PROMISED");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const { busy, error, run } = useAction(onDone);
  return (
    <form
      className="card space-y-3 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        void run("add", "/memory/commitments", { companyId, conversationId: conversationId ?? null, opportunityId: opportunityId || null, direction, title: title.trim(), dueAt: due ? new Date(due).toISOString() : null });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)} aria-label="Who promised">
          <option value="WE_PROMISED">We promised</option>
          <option value="PROSPECT_PROMISED">They promised</option>
          <option value="MUTUAL">Agreed together</option>
        </select>
        <input autoFocus className="input" placeholder="What was promised?" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs text-muted">Due (optional)</span>
          <input type="datetime-local" className="input w-full" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
        {opportunities && opportunities.length > 0 && (
          <label className="space-y-1">
            <span className="text-xs text-muted">Opportunity (optional)</span>
            <select className="input w-full" value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
              <option value="">—</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary text-xs" disabled={!!busy || !title.trim()}>
          <Plus className="size-3.5" /> Add commitment
        </button>
      </div>
    </form>
  );
}

export function AddNote({ companyId, people, onDone, onCancel }: { companyId: string; people?: { id: string; name: string }[]; onDone: () => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [personId, setPersonId] = useState("");
  const { busy, error, run } = useAction(onDone);
  return (
    <form
      className="card space-y-3 p-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        void run("note", "/memory/notes", { companyId, entityType: personId ? "PERSON" : "COMPANY", entityId: personId || null, text: text.trim() });
      }}
    >
      <textarea autoFocus className="input min-h-20 w-full py-2" placeholder="Something the team should remember (e.g. prefers calls on Fridays)" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
      {people && people.length > 0 && (
        <select className="input w-full" value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="About">
          <option value="">About the company</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              About {p.name}
            </option>
          ))}
        </select>
      )}
      <p className="text-[11px] text-faint">Notes are human facts. Never put passwords, payment details or opt-out requests here.</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary text-xs" disabled={!!busy || !text.trim()}>
          <Plus className="size-3.5" /> Save note
        </button>
      </div>
    </form>
  );
}

export function RelationshipsPanel({ rows, canManage, onChange }: { rows: RelationshipRow[]; canManage: boolean; onChange: () => void }) {
  const { busy, error, run } = useAction(onChange);
  if (!rows.length) return <Empty text="No relationships yet. Referrals and introductions found in conversations appear here." />;
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-danger">{error}</p>}
      {rows.map((r) => (
        <div key={r.id} className="card flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="font-medium">{r.from}</span> <span className="text-muted">{r.label.toLowerCase()}</span> <span className="font-medium">{r.to}</span>
            </p>
            <p className="text-xs text-faint">
              {r.company ? (
                <Link href={`/companies/${r.companyId}?tab=memory`} className="hover:text-tone">
                  {r.company}
                </Link>
              ) : null}
              {r.company ? " · " : ""}
              {r.confidence.toLowerCase()} confidence · {agoOf(r.createdAt)}
              {r.status !== "ACTIVE" ? ` · ${r.status.toLowerCase()}` : ""}
            </p>
            {r.quote && <p className="mt-0.5 text-xs text-muted">“{r.quote}”</p>}
          </div>
          {canManage && r.status === "ACTIVE" && (
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(r.id, `/memory/relationships/${r.id}/status`, { status: "ENDED" })}>
                Ended
              </button>
              <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run(r.id, `/memory/relationships/${r.id}/status`, { status: "INVALIDATED" })}>
                Wrong
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
