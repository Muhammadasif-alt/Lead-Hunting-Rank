"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, CircleCheck, Compass, History, Loader, MessageSquare, Pencil, Plus, Quote, RotateCcw, ShieldAlert, Trophy, Users, X, XCircle } from "lucide-react";
import {
  DEAL_HEALTH_INFO,
  LOSS_REASON_INFO,
  LOSS_REASONS,
  QUALIFICATION_INFO,
  STAGE_SEMANTIC_INFO,
  STAKEHOLDER_ROLE_INFO,
  STAKEHOLDER_ROLES,
  type LossReasonCode,
  type PermissionKey,
  type QualificationKey,
  type StageSemantic,
  type StakeholderRoleKey,
} from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, patch, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { formatMoney, HEALTH_STYLE, RISK_STYLE, TIMELINE_LABEL, type OpportunityDetail, type QualificationField } from "@/lib/opportunities";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

/** Opportunity 360 (screen #7 §5-28): why it exists, what is known (with their words), who decides, health, next action, history. */
export function OpportunityView({ id }: { id: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [d, setD] = useState<OpportunityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"won" | "lost" | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api<OpportunityDetail>(`/opportunities/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(name: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const screen = findScreen("/opportunities");
  if (!d) {
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
  const o = d.opportunity;
  const open = o.status === "OPEN";
  const canEdit = can("opportunity.update") && open;

  function moveTo(stage: StageSemantic) {
    const s = d!.stages.find((x) => x.semantic === stage);
    if (!s || s.current) return;
    const order: StageSemantic[] = ["NEW", "DISCOVERY", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION"];
    const back = stage !== "NURTURE" && o.stage !== "NURTURE" && order.indexOf(stage) < order.indexOf(o.stage);
    const reason = back ? window.prompt(`Why does the deal move back to ${s.name}?`) : stage === "NURTURE" ? window.prompt("Why nurture? (optional)") ?? "" : null;
    if (back && !reason?.trim()) return;
    void run("stage", () => post(`/opportunities/${id}/stage`, { stage, reason: reason || null, version: o.version }), `Moved to ${s.name}.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader screen={screen} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/opportunities" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            <ArrowLeft className="size-3.5" /> Opportunities
          </Link>
          <h2 className="mt-1 text-xl font-semibold">{o.name}</h2>
          <p className="text-sm text-muted">
            <Link href={`/companies/${d.company.id}`} className="text-accent hover:underline">
              {d.company.name}
            </Link>
            {d.contact ? ` · ${d.contact.name}` : ""}
            {d.company.status === "CUSTOMER" ? " · customer" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && can("opportunity.mark_won") && (
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => setDialog("won")}>
              <Trophy className="size-4" /> Mark won
            </button>
          )}
          {open && can("opportunity.update") && (
            <button type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => setDialog("lost")}>
              <XCircle className="size-4" /> Mark lost
            </button>
          )}
          {!open && can("opportunity.update") && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={() => {
                const reason = window.prompt("Why reopen this deal?");
                if (reason?.trim()) void run("reopen", () => post(`/opportunities/${id}/reopen`, { reason }), "Reopened.");
              }}
            >
              <RotateCcw className="size-4" /> Reopen
            </button>
          )}
        </div>
      </div>

      {/* stage path */}
      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Stage">
        {d.stages
          .filter((s) => s.semantic !== "WON" && s.semantic !== "LOST")
          .map((s) => {
            const clickable = canEdit && s.allowed;
            const blocked = clickable && s.missing.length > 0;
            return (
              <li key={s.id} className="shrink-0">
                <button
                  type="button"
                  disabled={!clickable || !!busy}
                  title={s.missing.length ? `Needs: ${s.missing.join("; ")}` : STAGE_SEMANTIC_INFO[s.semantic].description}
                  onClick={() => moveTo(s.semantic)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${s.current ? "border-tone bg-tone text-white" : blocked ? "border-dashed border-line text-faint" : "border-line text-muted hover:border-tone hover:text-fg"}`}
                  data-tone="sales"
                  aria-current={s.current ? "step" : undefined}
                >
                  {s.name}
                </button>
              </li>
            );
          })}
        {!open && (
          <li className="shrink-0">
            <span className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-medium ${o.status === "WON" ? "border-brand bg-brand text-white" : "border-danger bg-danger text-white"}`}>{o.status === "WON" ? "Won" : "Lost"}</span>
          </li>
        )}
      </ol>

      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <NextAction d={d} canEdit={canEdit} busy={busy} onSave={(text) => void run("next", () => patch(`/opportunities/${id}`, { nextActionOverride: text, version: o.version }))} />
          <Health d={d} />
          <Qualification
            d={d}
            canEdit={can("opportunity.update")}
            busy={busy}
            onSet={(key, value) => void run(`q-${key}`, () => post(`/opportunities/${id}/qualification/${key}`, { value }))}
            onConfirm={(answerId) => void run("confirm", () => post(`/opportunities/${id}/qualification/answers/${answerId}/confirm`))}
          />
          <Stakeholders
            d={d}
            canEdit={can("opportunity.update")}
            onAdd={(input) => run("sh", () => post(`/opportunities/${id}/stakeholders`, input))}
            onUpdate={(sid, input) => void run("sh", () => patch(`/opportunities/${id}/stakeholders/${sid}`, input))}
            onRemove={(sid) => void run("sh", () => post(`/opportunities/${id}/stakeholders/${sid}/remove`))}
          />
          <StageHistory d={d} />
        </div>
        <aside className="min-w-0 space-y-4">
          <Details d={d} canEdit={canEdit} busy={busy} onSave={(input) => void run("details", () => patch(`/opportunities/${id}`, { ...input, version: o.version }), "Saved.")} />
          <Origin d={d} />
          {d.losses.length > 0 && (
            <section className="card space-y-2 p-4 text-sm">
              <div className="eyebrow text-[11px]">Loss</div>
              {d.losses.map((l) => (
                <div key={l.id} className="text-xs">
                  <div className="font-medium">
                    {LOSS_REASON_INFO[l.reasonCode]}
                    {l.reopenedAt ? " (reopened)" : ""}
                  </div>
                  {l.details && <p className="text-muted">{l.details}</p>}
                  {l.evidenceQuote && <p className="text-faint">“{l.evidenceQuote}”</p>}
                  {l.revisitAt && <p className="text-muted">Revisit after {l.revisitAt.slice(0, 10)}</p>}
                </div>
              ))}
            </section>
          )}
          {o.status === "WON" && (
            <section className="card space-y-1 border-brand/25 p-4 text-sm">
              <div className="eyebrow text-[11px]">Won</div>
              <div className="text-lg font-semibold">{formatMoney(o.wonAmountMinor, o.currency)}</div>
              {o.wonNote && <p className="text-xs text-muted">{o.wonNote}</p>}
              <p className="text-xs text-muted">The company is a customer — cold prospecting to it stopped.</p>
            </section>
          )}
          <Timeline d={d} />
        </aside>
      </div>

      {dialog === "won" && (
        <WonDialog
          currency={o.currency}
          amountMinor={o.amountMinor}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            if (await run("won", () => post(`/opportunities/${id}/won`, input), "Won — the company is now a customer.")) setDialog(null);
          }}
        />
      )}
      {dialog === "lost" && (
        <LostDialog
          suggestion={d.lossSuggestion}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            if (await run("lost", () => post(`/opportunities/${id}/lost`, input), "Marked lost.")) setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function NextAction({ d, canEdit, busy, onSave }: { d: OpportunityDetail; canEdit: boolean; busy: string | null; onSave: (text: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.opportunity.nextActionOverride ?? "");
  return (
    <section className="card border-tone/25 p-4" data-tone="sales">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5 text-[11px]">
          <Compass className="size-3.5 text-tone" /> Next best action
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-ghost px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Set my own
          </button>
        )}
      </div>
      {!editing ? (
        <>
          <p className="mt-1.5 text-base font-semibold">{d.nextAction.action}</p>
          <p className="text-sm text-muted">Why: {d.nextAction.why}</p>
          {d.opportunity.nextActionOverride && canEdit && (
            <button type="button" className="mt-2 text-xs text-accent" disabled={!!busy} onClick={() => onSave(null)}>
              Back to the suggested action
            </button>
          )}
        </>
      ) : (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="next">
            Next action
          </label>
          <input id="next" className="input flex-1" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Call Ann on Friday about the partner" />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={() => {
                onSave(text.trim() || null);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Health({ d }: { d: OpportunityDetail }) {
  const h = d.health;
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5 text-[11px]">
          <ShieldAlert className="size-3.5" /> Deal health
        </div>
        <span className={`badge ${HEALTH_STYLE[h.health].badge}`}>{DEAL_HEALTH_INFO[h.health].label}</span>
      </div>
      <p className="mt-1 text-xs text-muted">From evidence — no made-up “chance to close”.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium">Positive signals</div>
          <ul className="mt-1 space-y-1 text-sm">
            {h.signals.length ? (
              h.signals.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <Check className="size-3.5 text-brand" /> {s}
                </li>
              ))
            ) : (
              <li className="text-muted">None yet</li>
            )}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium">Risks</div>
          <ul className="mt-1 space-y-1 text-sm">
            {h.risks.length ? (
              h.risks.map((r) => (
                <li key={r.text} className={`flex items-start gap-1.5 ${RISK_STYLE[r.severity]}`}>
                  <span aria-hidden="true">⚠</span> {r.text} <span className="text-[10px] uppercase text-faint">{r.severity}</span>
                </li>
              ))
            ) : (
              <li className="text-muted">None found</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Qualification({ d, canEdit, busy, onSet, onConfirm }: { d: OpportunityDetail; canEdit: boolean; busy: string | null; onSet: (key: QualificationKey, value: string | null) => void; onConfirm: (answerId: string) => void }) {
  const known = d.qualification.fields.filter((f) => f.current);
  const unknown = d.qualification.fields.filter((f) => !f.current);
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow text-[11px]">Qualification</div>
        <span className="badge">{d.qualification.status === "QUALIFIED" ? "Qualified" : d.qualification.status === "PARTIAL" ? "Partly known" : "Nothing known yet"}</span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-xs font-medium text-brand">Known</div>
          {known.length === 0 && <p className="text-sm text-muted">Nothing stated yet.</p>}
          <ul className="space-y-2">
            {known.map((f) => (
              <Answer key={f.key} f={f} canEdit={canEdit} busy={busy} onSet={onSet} onConfirm={onConfirm} />
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Unknown — ask naturally, don’t interrogate</div>
          <ul className="space-y-2">
            {unknown.map((f) => (
              <Answer key={f.key} f={f} canEdit={canEdit} busy={busy} onSet={onSet} onConfirm={onConfirm} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Answer({ f, canEdit, busy, onSet, onConfirm }: { f: QualificationField; canEdit: boolean; busy: string | null; onSet: (key: QualificationKey, value: string | null) => void; onConfirm: (answerId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.current?.value ?? "");
  const [open, setOpen] = useState(false);
  const info = QUALIFICATION_INFO[f.key];
  const c = f.current;
  return (
    <li className="rounded-lg border border-line px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">{info.label}</div>
          {c ? <div className="break-words">{c.value}</div> : <div className="text-xs text-faint">? {info.ask}</div>}
        </div>
        {canEdit && !editing && (
          <button type="button" aria-label={`Edit ${info.label}`} className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
          </button>
        )}
      </div>
      {c && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
          {c.source === "CONVERSATION" ? (
            <button type="button" className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Quote className="size-3" /> From their email · {c.confidence.toLowerCase()}
            </button>
          ) : (
            <span>Entered by a person</span>
          )}
          {c.verified ? (
            <span className="inline-flex items-center gap-0.5 text-brand">
              <CircleCheck className="size-3" /> confirmed{c.verifiedBy ? ` by ${c.verifiedBy}` : ""}
            </span>
          ) : (
            canEdit && (
              <button type="button" className="text-accent hover:underline" disabled={!!busy} onClick={() => onConfirm(c.id)}>
                Confirm
              </button>
            )
          )}
          <span>{formatAgo(c.at)}</span>
        </div>
      )}
      {open && c?.quote && <blockquote className="mt-1.5 border-l-2 border-tone/40 pl-2 text-xs italic text-muted">“{c.quote}”</blockquote>}
      {open && f.history.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-faint">
          {f.history.map((h) => (
            <li key={h.id}>
              Earlier: {h.value} ({formatAgo(h.at)})
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mt-2 flex flex-col gap-2">
          <label className="sr-only" htmlFor={`q-${f.key}`}>
            {info.label}
          </label>
          <input id={`q-${f.key}`} className="input w-full" value={value} onChange={(e) => setValue(e.target.value)} placeholder={info.ask} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary text-xs"
              disabled={!!busy}
              onClick={() => {
                onSet(f.key, value.trim() || null);
                setEditing(false);
              }}
            >
              Save
            </button>
            {c && (
              <button
                type="button"
                className="btn btn-ghost text-xs"
                disabled={!!busy}
                onClick={() => {
                  onSet(f.key, null);
                  setEditing(false);
                }}
              >
                Mark unknown
              </button>
            )}
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Stakeholders({ d, canEdit, onAdd, onUpdate, onRemove }: { d: OpportunityDetail; canEdit: boolean; onAdd: (input: Record<string, unknown>) => Promise<boolean>; onUpdate: (id: string, input: Record<string, unknown>) => void; onRemove: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [personId, setPersonId] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [role, setRole] = useState<StakeholderRoleKey>("UNKNOWN");
  const candidates = d.people.filter((p) => !d.stakeholders.some((s) => s.personId === p.id));
  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow flex items-center gap-1.5 text-[11px]">
          <Users className="size-3.5" /> Stakeholders
        </div>
        {canEdit && !adding && (
          <button type="button" className="btn btn-ghost px-2 text-xs" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" /> Add
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-2">
        {d.stakeholders.map((s) => (
          <li key={s.id} className={`rounded-lg border px-3 py-2 text-sm ${s.status === "SUGGESTED" ? "border-dashed border-amber/50 bg-amber-soft/30" : "border-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium">
                  {s.name}
                  {s.title ? <span className="font-normal text-muted"> · {s.title}</span> : null}
                </div>
                <div className="text-xs text-muted">
                  {STAKEHOLDER_ROLE_INFO[s.role]} · influence {s.influence.toLowerCase()} · {s.status === "SUGGESTED" ? "mentioned, not involved yet" : s.status.toLowerCase().replace("_", " ")}
                </div>
                {s.quote && <p className="mt-1 text-[11px] italic text-faint">“{s.quote}”</p>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <label className="sr-only" htmlFor={`role-${s.id}`}>
                    Role
                  </label>
                  <select id={`role-${s.id}`} className="input h-auto py-1 text-xs" value={s.role} onChange={(e) => onUpdate(s.id, { role: e.target.value })}>
                    {STAKEHOLDER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {STAKEHOLDER_ROLE_INFO[r]}
                      </option>
                    ))}
                  </select>
                  {s.status === "SUGGESTED" && (
                    <button type="button" className="btn btn-ghost px-2 text-xs" onClick={() => onUpdate(s.id, { status: "KNOWN" })}>
                      Confirm
                    </button>
                  )}
                  {s.source !== "PRIMARY" && (
                    <button type="button" aria-label={`Remove ${s.name}`} className="rounded p-1 text-faint hover:bg-hover hover:text-danger" onClick={() => onRemove(s.id)}>
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
        {d.stakeholders.length === 0 && <li className="text-sm text-muted">No one yet.</li>}
      </ul>
      {adding && (
        <div className="mt-3 grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
          {candidates.length > 0 && (
            <label className="text-xs sm:col-span-2">
              Someone we know at {d.company.name}
              <select className="input mt-1 w-full" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">— or type a name below —</option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.title ? ` (${p.title})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!personId && (
            <>
              <label className="text-xs">
                Name
                <input className="input mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="text-xs">
                Title
                <input className="input mt-1 w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
            </>
          )}
          <label className="text-xs">
            Role
            <select className="input mt-1 w-full" value={role} onChange={(e) => setRole(e.target.value as StakeholderRoleKey)}>
              {STAKEHOLDER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {STAKEHOLDER_ROLE_INFO[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={async () => {
                if (await onAdd(personId ? { personId, role } : { name, title: title || null, role })) {
                  setAdding(false);
                  setName("");
                  setTitle("");
                  setPersonId("");
                }
              }}
            >
              Add
            </button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StageHistory({ d }: { d: OpportunityDetail }) {
  return (
    <section className="card p-4">
      <div className="eyebrow mb-2 flex items-center gap-1.5 text-[11px]">
        <History className="size-3.5" /> Stage history
      </div>
      <ol className="space-y-2 border-l border-line pl-3">
        {d.history.map((h) => (
          <li key={h.id} className="relative text-sm">
            <span className="absolute -left-[16.5px] top-1.5 size-2 rounded-full border border-line bg-surface" />
            <div>
              <span className="font-medium">{h.from ? `${h.from} → ${h.to}` : h.to}</span> <span className="text-xs text-muted">· {formatAgo(h.at)} · {h.actorName ?? (h.actorType === "SYSTEM" ? "rules" : h.actorType === "AI_AGENT" ? "AI" : "someone")}</span>
            </div>
            {h.reason && <p className="text-xs text-muted">{h.reason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Details({ d, canEdit, busy, onSave }: { d: OpportunityDetail; canEdit: boolean; busy: string | null; onSave: (input: Record<string, unknown>) => void }) {
  const o = d.opportunity;
  const [editing, setEditing] = useState(false);
  const [service, setService] = useState(o.service ?? "");
  const [amount, setAmount] = useState(o.amountMinor != null ? String(o.amountMinor / 100) : "");
  const [owner, setOwner] = useState(d.owner?.id ?? "");
  const [contact, setContact] = useState(o.primaryPersonId ?? "");
  return (
    <section className="card space-y-2 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="eyebrow text-[11px]">Deal</div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-ghost px-2 text-xs" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </button>
        )}
      </div>
      {!editing ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          <dt className="text-muted">Value</dt>
          <dd className="font-semibold">{formatMoney(o.amountMinor, o.currency)}</dd>
          <dt className="text-muted">Service</dt>
          <dd className="break-words">{o.service ?? "—"}</dd>
          <dt className="text-muted">Owner</dt>
          <dd>{d.owner?.name ?? "Unassigned"}</dd>
          <dt className="text-muted">Contact</dt>
          <dd>{d.contact?.name ?? "—"}</dd>
          <dt className="text-muted">In stage</dt>
          <dd>since {formatAgo(o.stageEnteredAt)}</dd>
          <dt className="text-muted">Activity</dt>
          <dd>{formatAgo(o.lastActivityAt)}</dd>
        </dl>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs">
            Estimated value ({o.currency})
            <input className="input mt-1 w-full" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Empty = unknown" />
          </label>
          <label className="block text-xs">
            What they would buy
            <input className="input mt-1 w-full" value={service} onChange={(e) => setService(e.target.value)} />
          </label>
          <label className="block text-xs">
            Owner
            <select className="input mt-1 w-full" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Unassigned</option>
              {d.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Primary contact
            <select className="input mt-1 w-full" value={contact} onChange={(e) => setContact(e.target.value)}>
              <option value="">—</option>
              {d.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary text-xs"
              disabled={!!busy}
              onClick={() => {
                const amountMinor = amount.trim() ? Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100) : null;
                onSave({ service: service.trim() || null, amountMinor, ownerUserId: owner || null, primaryPersonId: contact || null });
                setEditing(false);
              }}
            >
              Save
            </button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Origin({ d }: { d: OpportunityDetail }) {
  const o = d.opportunity;
  return (
    <section className="card space-y-2 p-4 text-sm">
      <div className="eyebrow text-[11px]">Why it exists</div>
      <p>{o.originReason ?? "Created by a person"}</p>
      {o.originQuote && <blockquote className="border-l-2 border-tone/40 pl-2 text-xs italic text-muted">“{o.originQuote}”</blockquote>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line pt-2 text-xs">
        {d.origin.market && (
          <>
            <dt className="text-muted">Market</dt>
            <dd>{d.origin.market.name}</dd>
          </>
        )}
        {d.origin.leadSource && (
          <>
            <dt className="text-muted">Lead source</dt>
            <dd>{d.origin.leadSource}</dd>
          </>
        )}
        {d.origin.campaign && (
          <>
            <dt className="text-muted">Campaign</dt>
            <dd>
              <Link href={`/campaigns/${d.origin.campaign.id}`} className="text-accent hover:underline">
                {d.origin.campaign.name}
              </Link>
            </dd>
          </>
        )}
        <dt className="text-muted">Created</dt>
        <dd>
          {formatAgo(o.createdAt)} · {o.createdByType === "SYSTEM" ? "by the rules (strong evidence)" : o.createdByType === "HUMAN" ? "by a person" : o.createdByType.toLowerCase()}
        </dd>
      </dl>
      {d.conversation && (
        <Link href={`/inbox?c=${d.conversation.id}`} className="btn btn-secondary mt-1 w-full justify-center text-xs">
          <MessageSquare className="size-3.5" /> Open the conversation{d.conversation.waitingOn === "US" ? " (waiting on us)" : ""}
        </Link>
      )}
    </section>
  );
}

function Timeline({ d }: { d: OpportunityDetail }) {
  return (
    <section className="card p-4">
      <div className="eyebrow mb-2 text-[11px]">What happened</div>
      <ol className="space-y-1.5 text-xs">
        {[...d.timeline].reverse().slice(0, 20).map((e) => (
          <li key={e.id}>
            <span className="font-medium">{TIMELINE_LABEL[e.type] ?? e.type}</span>
            <span className="text-muted">
              {e.type === "OpportunityStageChanged" ? ` · ${String(e.payload.from).toLowerCase()} → ${String(e.payload.to).toLowerCase()}` : ""}
              {e.type === "QualificationUpdated" ? ` · ${(e.payload.changedKeys as string[]).map((k) => QUALIFICATION_INFO[k as QualificationKey]?.label ?? k).join(", ")}` : ""} · {formatAgo(e.at)}
              {e.actorName ? ` · ${e.actorName}` : e.actorType === "SYSTEM" ? " · rules" : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WonDialog({ currency, amountMinor, onClose, onSubmit }: { currency: string; amountMinor: number | null; onClose: () => void; onSubmit: (input: { amountMinor: number; currency: string; note: string }) => void }) {
  const [amount, setAmount] = useState(amountMinor != null ? String(amountMinor / 100) : "");
  const [note, setNote] = useState("");
  const minor = Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100);
  return (
    <Dialog title="Mark won" onClose={onClose}>
      <p className="text-xs text-muted">The company becomes a customer and every cold sequence to it stops.</p>
      <label className="block text-sm">
        Won value ({currency})
        <input className="input mt-1 w-full" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      </label>
      <label className="block text-sm">
        What confirmed it
        <input className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Signed proposal, email, call…" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!(minor > 0) || !note.trim()} onClick={() => onSubmit({ amountMinor: minor, currency, note: note.trim() })}>
          <Trophy className="size-4" /> Mark won
        </button>
      </div>
    </Dialog>
  );
}

function LostDialog({ suggestion, onClose, onSubmit }: { suggestion: OpportunityDetail["lossSuggestion"]; onClose: () => void; onSubmit: (input: Record<string, unknown>) => void }) {
  const [reason, setReason] = useState<LossReasonCode | "">(suggestion?.code ?? "");
  const [details, setDetails] = useState("");
  const [revisit, setRevisit] = useState("");
  return (
    <Dialog title="Mark lost" onClose={onClose}>
      {suggestion && (
        <div className="rounded-lg border border-tone-ai/25 bg-tone-ai-soft px-3 py-2 text-xs">
          Likely reason from the conversation: <span className="font-medium">{LOSS_REASON_INFO[suggestion.code]}</span>
          <p className="mt-0.5 italic text-muted">“{suggestion.quote}”</p>
        </div>
      )}
      <label className="block text-sm">
        Reason
        <select className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value as LossReasonCode)}>
          <option value="">Choose…</option>
          {LOSS_REASONS.map((r) => (
            <option key={r} value={r}>
              {LOSS_REASON_INFO[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Details (optional)
        <input className="input mt-1 w-full" value={details} onChange={(e) => setDetails(e.target.value)} />
      </label>
      <label className="block text-sm">
        Revisit after (optional)
        <input type="date" className="input mt-1 w-full" value={revisit} onChange={(e) => setRevisit(e.target.value)} />
        <span className="text-xs text-muted">Lost isn’t dead forever — the conversation comes back to you then.</span>
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!reason}
          onClick={() =>
            onSubmit({
              reason,
              details: details.trim() || null,
              revisitAt: revisit ? new Date(`${revisit}T09:00:00`).toISOString() : null,
              suggested: !!suggestion && suggestion.code === reason,
              evidenceQuote: suggestion && suggestion.code === reason ? suggestion.quote : null,
            })
          }
        >
          <XCircle className="size-4" /> Mark lost
        </button>
      </div>
    </Dialog>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="card w-full max-w-md space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="btn btn-ghost px-2" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
