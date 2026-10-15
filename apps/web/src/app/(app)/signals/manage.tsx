"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Archive, Eye, Loader, Pencil, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import {
  RELATIONSHIP_INFO,
  RULE_ACTION_INFO,
  RULE_ACTIONS,
  SIGNAL_CATEGORIES,
  SIGNAL_CATEGORY_INFO,
  SIGNAL_TYPE_KEYS,
  SIGNAL_TYPES,
  WATCHLIST_CADENCE_DAYS,
  WATCHLIST_KIND_INFO,
  WATCHLIST_KINDS,
  describeRule,
  type Level,
  type Relationship,
  type RuleAction,
  type RuleConditions,
  type SignalRuleRow,
  type SignalStrengthKey,
  type WatchlistDetail,
  type WatchlistKind,
  type WatchlistRow,
} from "@revenue-os/shared";
import { api, errorMessage, patch, post } from "@/lib/api";
import { timeAgo, type MarketRef } from "@/lib/signals";
import { Empty, ErrorBox, Loaded, StrengthBadge, useAction } from "./parts";

type Priority = "HIGH" | "NORMAL" | "LOW";
const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "High", NORMAL: "Normal", LOW: "Low" };
const cadence = (p: Priority) => `checked every ${WATCHLIST_CADENCE_DAYS[p]} days`;

// ── Watchlists ──────────────────────────────────────────────────────────────────────────────────

export function WatchlistsTab({ canManage, markets }: { canManage: boolean; markets: MarketRef[] }) {
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Loaded<WatchlistRow[]> path="/signals/watchlists">
      {(rows, reload) => (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted">Watched companies are re-checked on a cadence set by priority — cost and usefulness, not everything hourly.</p>
            {canManage && !creating && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" /> New watchlist
              </button>
            )}
          </div>
          {creating && (
            <CreateWatchlist
              markets={markets}
              onCancel={() => setCreating(false)}
              onDone={(id) => {
                setCreating(false);
                reload();
                setOpen(id);
              }}
            />
          )}
          {rows.length === 0 ? (
            <Empty text="No watchlists yet. Watch a saved market, your open deals, lost deals or a hand-picked set of companies — their changes become signals." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {rows.map((w) => (
                <li key={w.id}>
                  <button type="button" onClick={() => setOpen(w.id)} className="card flex w-full flex-col gap-2 p-4 text-left hover:border-line-strong">
                    <div className="flex w-full flex-wrap items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-semibold">{w.name}</span>
                      <span className={`badge text-[10px] ${w.priority === "HIGH" ? "border-tone/30 bg-tone-soft text-tone" : ""}`}>{PRIORITY_LABEL[w.priority]} priority</span>
                    </div>
                    <p className="text-xs text-muted">
                      {WATCHLIST_KIND_INFO[w.kind].label}
                      {w.market ? ` · ${w.market}` : ""} · {cadence(w.priority)}
                    </p>
                    {w.description && <p className="text-xs text-faint">{w.description}</p>}
                    <p className="text-xs text-faint">
                      {w.members} compan{w.members === 1 ? "y" : "ies"} · {w.openSignals} open signal{w.openSignals === 1 ? "" : "s"} · {w.dueForCheck} due for a check · last sweep {w.lastSweepAt ? timeAgo(w.lastSweepAt) : "not yet"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && <WatchlistDrawer id={open} canManage={canManage} onClose={() => setOpen(null)} onChange={reload} />}
        </div>
      )}
    </Loaded>
  );
}

function CreateWatchlist({ markets, onCancel, onDone }: { markets: MarketRef[]; onCancel: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<WatchlistKind>("MANUAL");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [marketId, setMarketId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim() && (kind !== "MARKET" || marketId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ id: string }>("/signals/watchlists", { name: name.trim(), description: description.trim() || undefined, kind, priority, marketId: kind === "MARKET" ? marketId : undefined });
      onDone(r.id);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card space-y-3 p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <input autoFocus className="input" placeholder="Name (e.g. Top 100 accounts)" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Name" />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as WatchlistKind)} aria-label="Kind">
          {WATCHLIST_KINDS.map((k) => (
            <option key={k} value={k}>
              {WATCHLIST_KIND_INFO[k].label} — {WATCHLIST_KIND_INFO[k].description}
            </option>
          ))}
        </select>
        {kind === "MARKET" && (
          <select className="input" value={marketId} onChange={(e) => setMarketId(e.target.value)} aria-label="Market" required>
            <option value="">Choose a saved market</option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} aria-label="Priority">
          {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]} priority — {cadence(p)}
            </option>
          ))}
        </select>
        <input className="input sm:col-span-2" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} aria-label="Description" />
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary text-xs" disabled={busy || !valid}>
          {busy ? <Loader className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />} Create watchlist
        </button>
      </div>
    </form>
  );
}

function WatchlistDrawer({ id, canManage, onClose, onChange }: { id: string; canManage: boolean; onClose: () => void; onChange: () => void }) {
  const [d, setD] = useState<WatchlistDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", priority: "NORMAL" as Priority });
  const load = useCallback(async () => {
    try {
      setD(await api<WatchlistDetail>(`/signals/watchlists/${id}`));
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const { busy, error, run } = useAction(() => {
    onChange();
    void load();
  });
  const manual = d?.kind === "MANUAL";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Watchlist">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-4 shadow-xl sm:p-5" data-tone="leads">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="eyebrow text-[11px]">Watchlist</div>
          <button type="button" onClick={onClose} className="btn btn-ghost h-8 px-2" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {!d ? (
          loadError ? (
            <p className="text-sm text-danger">{loadError}</p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader className="size-4 animate-spin" /> Loading…
            </p>
          )
        ) : (
          <div className="space-y-4">
            {editing ? (
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!form.name.trim()) return;
                  void run("save", () => patch(`/signals/watchlists/${id}`, { name: form.name.trim(), description: form.description.trim() || null, priority: form.priority })).then((ok) => ok && setEditing(false));
                }}
              >
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} aria-label="Name" />
                <input className="input" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={300} aria-label="Description" />
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} aria-label="Priority">
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]} priority — {cadence(p)}
                    </option>
                  ))}
                </select>
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn btn-ghost text-xs" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary text-xs" disabled={!!busy || !form.name.trim()}>
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <h2 className="text-lg font-semibold break-words">{d.name}</h2>
                <p className="text-xs text-muted">
                  {WATCHLIST_KIND_INFO[d.kind].label}
                  {d.market ? ` · ${d.market}` : ""} · {PRIORITY_LABEL[d.priority]} priority, {cadence(d.priority)}
                </p>
                {d.description && <p className="mt-1 text-sm text-muted">{d.description}</p>}
                <p className="mt-1 text-xs text-faint">{WATCHLIST_KIND_INFO[d.kind].description}</p>
              </div>
            )}

            {canManage && !editing && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary text-xs" onClick={() => (setForm({ name: d.name, description: d.description ?? "", priority: d.priority }), setEditing(true))}>
                  <Pencil className="size-3.5" /> Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-xs"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Archive "${d.name}"? Its companies stop being monitored through it; signals are kept.`)) return;
                    void run("archive", () => post(`/signals/watchlists/${id}/archive`)).then((ok) => ok && onClose());
                  }}
                >
                  <Archive className="size-3.5" /> Archive
                </button>
              </div>
            )}
            {error && <p className="text-xs text-danger">{error}</p>}

            {canManage && manual && <AddMembers onAdd={(ids, reason) => run("add", () => post(`/signals/watchlists/${id}/members`, { companyIds: ids, reason: reason || undefined }))} />}
            {!manual && <p className="text-xs text-faint">Members of this watchlist are kept in sync automatically.</p>}

            <section>
              <h3 className="mb-1.5 text-sm font-semibold">
                Companies <span className="text-xs font-normal text-faint">{d.companies.length}</span>
              </h3>
              {d.companies.length === 0 ? (
                <p className="text-sm text-muted">No companies on this watchlist yet.</p>
              ) : (
                <ul className="space-y-2">
                  {d.companies.map((c) => (
                    <li key={c.companyId} className="flex items-start gap-2 rounded-lg border border-line p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/companies/${c.companyId}?tab=signals`} className="min-w-0 truncate text-sm font-medium hover:text-tone">
                            {c.company}
                          </Link>
                          {c.strongest && <StrengthBadge strength={c.strongest} />}
                        </div>
                        <p className="text-xs text-faint">
                          {[c.industry, c.city].filter(Boolean).join(" · ")}
                          {c.industry || c.city ? " · " : ""}
                          {c.openSignals} open · checked {c.lastCheckedAt ? timeAgo(c.lastCheckedAt) : "never"} · next {c.nextCheckAt ? new Date(c.nextCheckAt).toLocaleDateString() : "—"}
                        </p>
                        {c.reason && <p className="text-xs text-muted">{c.reason}</p>}
                      </div>
                      {canManage && manual && (
                        <button type="button" className="btn btn-ghost h-7 shrink-0 px-2" disabled={!!busy} aria-label={`Remove ${c.company}`} onClick={() => void run(`rm-${c.companyId}`, () => post(`/signals/watchlists/${id}/members/remove`, { companyIds: [c.companyId] }))}>
                          <X className="size-3.5" />
                        </button>
                      )}
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

function AddMembers({ onAdd }: { onAdd: (ids: string[], reason: string) => Promise<boolean> }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; meta: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (term.trim().length < 2) return;
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ items: { id: string; displayName: string; city: string | null; industry: string | null }[] }>(`/companies?search=${encodeURIComponent(term.trim())}&limit=8`);
        setResults(r.items.map((c) => ({ id: c.id, name: c.displayName, meta: [c.industry, c.city].filter(Boolean).join(" · ") })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [term]);

  return (
    <section className="space-y-2 rounded-lg border border-line p-3">
      <h3 className="text-sm font-semibold">Add companies</h3>
      <input className="input" placeholder="Search companies by name or website" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search companies" />
      {term.trim().length >= 2 && results.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {results
            .filter((r) => !picked.some((p) => p.id === r.id))
            .map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover" onClick={() => setPicked([...picked, { id: r.id, name: r.name }])}>
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-faint">{r.meta}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
      {picked.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {picked.map((p) => (
              <span key={p.id} className="badge max-w-full">
                <span className="truncate">{p.name}</span>
                <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <input className="input" placeholder="Why watch them? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} aria-label="Reason" />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary h-8 text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await onAdd(
                  picked.map((p) => p.id),
                  reason.trim(),
                );
                setBusy(false);
                if (ok) {
                  setPicked([]);
                  setReason("");
                  setTerm("");
                  setResults([]);
                }
              }}
            >
              <Plus className="size-3.5" /> Add {picked.length}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ── Rules ───────────────────────────────────────────────────────────────────────────────────────

export function RulesTab({ canConfigure, markets }: { canConfigure: boolean; markets: MarketRef[] }) {
  const [editing, setEditing] = useState<SignalRuleRow | "new" | null>(null);
  return (
    <Loaded<SignalRuleRow[]> path="/signals/rules">
      {(rows, reload) => <RulesBody rows={rows} reload={reload} canConfigure={canConfigure} markets={markets} editing={editing} setEditing={setEditing} />}
    </Loaded>
  );
}

function RulesBody({ rows, reload, canConfigure, markets, editing, setEditing }: { rows: SignalRuleRow[]; reload: () => void; canConfigure: boolean; markets: MarketRef[]; editing: SignalRuleRow | "new" | null; setEditing: (r: SignalRuleRow | "new" | null) => void }) {
  const { busy, error, run } = useAction(reload);
  return (
    <div className="space-y-3">
      <div className="card flex items-start gap-2 border-tone/25 bg-tone-soft px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-tone" />
        <span>Rules never send anything — outreach still goes through campaigns and policy. A rule can only record, research, prioritise, notify, mark a campaign candidate or ignore noise.</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Rules run in order on every new signal. {canConfigure ? "" : "You can view rules; changing them needs the signal.configure permission."}</p>
        {canConfigure && editing === null && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
            <Plus className="size-4" /> New rule
          </button>
        )}
      </div>
      {editing !== null && (
        <RuleForm
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          markets={markets}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {error && <ErrorBox text={error} />}
      {rows.length === 0 ? (
        <Empty text="No rules yet. Without rules every signal is still verified, scored and shown — rules only add automatic research, priority or noise suppression." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className={`card space-y-2 p-4 ${r.enabled ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-semibold break-words">{r.name}</span>
                <span className={`badge text-[10px] ${r.enabled ? "border-tone/30 bg-tone-soft text-tone" : "text-faint"}`}>{r.enabled ? "Enabled" : "Off"}</span>
              </div>
              <p className="text-sm break-words">
                <span className="font-mono text-xs text-muted">{r.description || describeRule(r.conditions)}</span>
              </p>
              <p className="text-sm">
                <span className="text-xs font-semibold text-faint">THEN </span>
                {r.actions.length ? r.actions.map((a) => RULE_ACTION_INFO[a]?.label ?? a).join(" + ") : <span className="text-faint">nothing</span>}
              </p>
              <p className="text-xs text-faint">
                Matched {r.matches} time{r.matches === 1 ? "" : "s"}
                {r.lastMatchedAt ? ` · last ${timeAgo(r.lastMatchedAt)}` : ""}
              </p>
              {canConfigure && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary h-7 text-xs" disabled={!!busy} onClick={() => void run(`t-${r.id}`, () => patch(`/signals/rules/${r.id}`, { enabled: !r.enabled }))}>
                    {busy === `t-${r.id}` && <Loader className="size-3.5 animate-spin" />} {r.enabled ? "Turn off" : "Turn on"}
                  </button>
                  <button type="button" className="btn btn-ghost h-7 text-xs" onClick={() => setEditing(r)}>
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost h-7 text-xs"
                    disabled={!!busy}
                    onClick={() => {
                      if (window.confirm(`Delete rule "${r.name}"? Past matches stay in signal history.`)) void run(`d-${r.id}`, () => post(`/signals/rules/${r.id}/delete`));
                    }}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: [T, string][]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map(([v, l]) => {
          const on = value.includes(v);
          return (
            <button key={v} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])} className={`rounded-md border px-2 py-1 text-xs ${on ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}>
              {l}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function RuleForm({ rule, markets, onCancel, onDone }: { rule: SignalRuleRow | null; markets: MarketRef[]; onCancel: () => void; onDone: () => void }) {
  const c0 = rule?.conditions ?? {};
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [types, setTypes] = useState<string[]>(c0.types ?? []);
  const [categories, setCategories] = useState<string[]>(c0.categories ?? []);
  const [minStrength, setMinStrength] = useState<SignalStrengthKey | "">(c0.minStrength ?? "");
  const [icpLevels, setIcpLevels] = useState<Level[]>(c0.icpLevels ?? []);
  const [relationships, setRelationships] = useState<Relationship[]>(c0.relationships ?? []);
  const [marketIds, setMarketIds] = useState<string[]>(c0.marketIds ?? []);
  const [industries, setIndustries] = useState((c0.industries ?? []).join(", "));
  const [actions, setActions] = useState<RuleAction[]>(rule?.actions ?? ["RESEARCH"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conditions: RuleConditions = {
    ...(types.length ? { types } : {}),
    ...(categories.length ? { categories } : {}),
    ...(minStrength ? { minStrength } : {}),
    ...(icpLevels.length ? { icpLevels } : {}),
    ...(relationships.length ? { relationships } : {}),
    ...(marketIds.length ? { marketIds } : {}),
    ...(industries.trim() ? { industries: industries.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
  };
  const ignoreMixed = actions.includes("IGNORE") && actions.length > 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !actions.length) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), enabled, conditions, actions };
      if (rule) await patch(`/signals/rules/${rule.id}`, body);
      else await post("/signals/rules", body);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card space-y-4 p-4">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Rule name">
          <input autoFocus className="input" placeholder="e.g. Research landscapers that open a new location" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </Field>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
        </label>
      </div>

      <div className="space-y-3">
        <div className="eyebrow text-[11px]">If (all must hold)</div>
        <Chips label="Signal type" options={SIGNAL_TYPE_KEYS.map((k): [string, string] => [k, SIGNAL_TYPES[k].label])} value={types} onChange={setTypes} />
        <Chips label="Category" options={SIGNAL_CATEGORIES.map((k): [string, string] => [k, SIGNAL_CATEGORY_INFO[k].label])} value={categories} onChange={setCategories} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Minimum strength">
            <select className="input" value={minStrength} onChange={(e) => setMinStrength(e.target.value as SignalStrengthKey | "")}>
              <option value="">Any</option>
              <option value="MEDIUM">Medium or strong</option>
              <option value="STRONG">Strong only</option>
            </select>
          </Field>
          <Field label="Industry contains (comma-separated)">
            <input className="input" placeholder="landscaping, roofing" value={industries} onChange={(e) => setIndustries(e.target.value)} maxLength={300} />
          </Field>
        </div>
        <Chips<Level> label="ICP fit" options={[["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"]]} value={icpLevels} onChange={setIcpLevels} />
        <Chips<Relationship> label="Relationship" options={(Object.keys(RELATIONSHIP_INFO) as Relationship[]).map((r): [Relationship, string] => [r, RELATIONSHIP_INFO[r].label])} value={relationships} onChange={setRelationships} />
        {markets.length > 0 && <Chips label="Market" options={markets.map((m): [string, string] => [m.id, m.name])} value={marketIds} onChange={setMarketIds} />}
        <p className="rounded-md bg-raised px-2.5 py-1.5 font-mono text-xs break-words text-muted">{describeRule(conditions)}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="eyebrow mb-1 text-[11px]">Then</legend>
        {RULE_ACTIONS.map((a) => (
          <label key={a} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={actions.includes(a)} onChange={(e) => setActions(e.target.checked ? [...actions, a] : actions.filter((x) => x !== a))} />
            <span>
              <span className="font-medium">{RULE_ACTION_INFO[a].label}</span> <span className="text-xs text-muted">— {RULE_ACTION_INFO[a].description}</span>
            </span>
          </label>
        ))}
        {ignoreMixed && <p className="text-xs text-amber">“Ignore” suppresses the signal, so the other actions will not apply to it.</p>}
        <p className="text-xs text-faint">There is no “send” action. Outreach still goes through campaigns and the pre-send policy.</p>
      </fieldset>

      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary text-xs" disabled={busy || !name.trim() || !actions.length}>
          {busy && <Loader className="size-3.5 animate-spin" />} {rule ? "Save rule" : "Create rule"}
        </button>
      </div>
    </form>
  );
}
