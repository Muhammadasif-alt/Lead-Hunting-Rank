"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, Clock, Loader, MessageSquareReply, Plus, Search, Trophy, X } from "lucide-react";
import { DEAL_HEALTH_INFO, QUALIFICATION_KEYS, STAGE_SEMANTIC_INFO, type PermissionKey, type StageSemantic } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import { formatAgo } from "@/lib/crm";
import { formatMoney, formatTotals, HEALTH_STYLE, KEY_SHORT, type Board, type DealCard, type View } from "@/lib/opportunities";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

/**
 * Opportunities (screen #7): a pipeline built from commercial evidence. Each card says why the deal exists, what is
 * known, its health and the one next action. Dragging is a convenience — the server checks each stage's requirements.
 */
export function Opportunities() {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [view, setView] = useState<View>("pipeline");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ view });
    if (query) params.set("q", query);
    try {
      setBoard(await api<Board>(`/opportunities?${params}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [view, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(card: DealCard, to: StageSemantic) {
    if (card.stage === to) return;
    const order: StageSemantic[] = ["NEW", "DISCOVERY", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION"];
    const back = to !== "NURTURE" && card.stage !== "NURTURE" && order.indexOf(to) < order.indexOf(card.stage);
    let reason: string | null = null;
    if (back) {
      reason = window.prompt(`Why does “${card.name}” move back to ${STAGE_SEMANTIC_INFO[to].label}?`);
      if (!reason?.trim()) return;
    }
    setMoving(card.id);
    setError(null);
    setNotice(null);
    try {
      await post(`/opportunities/${card.id}/stage`, { stage: to, reason, version: card.version });
      setNotice(`${card.name} → ${STAGE_SEMANTIC_INFO[to].label}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setMoving(null);
    }
  }

  const screen = findScreen("/opportunities");
  const s = board?.summary;

  return (
    <div className="space-y-5">
      <PageHeader
        screen={screen}
        actions={
          can("opportunity.create") ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New opportunity
            </button>
          ) : null
        }
      />

      {s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open pipeline" value={formatTotals(s.openValue)} hint={`${s.openCount} open${s.unpricedCount ? ` · ${s.unpricedCount} without a value yet` : ""}`} />
          <Stat label="Proposal + negotiation" value={formatTotals(s.proposalValue)} hint="Deals close to a decision" />
          <Stat label="Won this month" value={formatTotals(s.wonThisMonth)} hint={`${s.wonThisMonthCount} deal(s)`} />
          <Stat label="Lost this month" value={String(s.lostThisMonthCount)} hint="Each with a reason" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Views" className="flex gap-1 overflow-x-auto">
          {(
            [
              ["pipeline", "Pipeline"],
              ["priority", "Priority"],
              ["mine", "My deals"],
              ["closed", "Won / lost"],
            ] as [View, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${view === key ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="relative w-full sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(search.trim());
          }}
        >
          <label className="sr-only" htmlFor="deal-search">
            Search deals
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input id="deal-search" className="input w-full pl-8" placeholder="Search deal or company…" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => setQuery(search.trim())} />
        </form>
      </div>

      {notice && <div className="card px-4 py-3 text-sm">{notice}</div>}
      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {!board ? (
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </div>
      ) : board.cards.length === 0 && view !== "pipeline" ? (
        <Empty view={view} />
      ) : view === "pipeline" || view === "mine" ? (
        <Kanban board={board} canMove={can("opportunity.update")} moving={moving} onMove={(c, to) => void move(c, to)} />
      ) : (
        <List cards={board.cards} closed={view === "closed"} />
      )}

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-faint">{hint}</div>
    </div>
  );
}

function Kanban({ board, canMove, moving, onMove }: { board: Board; canMove: boolean; moving: string | null; onMove: (c: DealCard, to: StageSemantic) => void }) {
  const [over, setOver] = useState<StageSemantic | null>(null);
  const filled = board.stages.filter((s) => board.cards.some((c) => c.stage === s.semantic));
  return (
    <>
      {/* Phones: only the stages that have deals, stacked (moving happens on the deal page). */}
      <div className="space-y-4 sm:hidden">
        {filled.length === 0 && <p className="card px-4 py-6 text-center text-sm text-muted">No open deals yet.</p>}
        {filled.map((stage) => (
          <section key={stage.id} aria-label={stage.name}>
            <h2 className="mb-2 text-sm font-semibold">
              {stage.name} <span className="font-normal text-muted">· {board.cards.filter((c) => c.stage === stage.semantic).length}</span>
            </h2>
            <div className="space-y-2">
              {board.cards
                .filter((c) => c.stage === stage.semantic)
                .map((c) => (
                  <Card key={c.id} c={c} draggable={false} busy={moving === c.id} />
                ))}
            </div>
          </section>
        ))}
      </div>
    <div className="hidden overflow-x-auto pb-2 sm:block">
      <div className="flex min-w-max gap-3">
        {board.stages.map((stage) => {
          const cards = board.cards.filter((c) => c.stage === stage.semantic);
          const total = cards.reduce<Record<string, number>>((acc, c) => (c.amountMinor ? { ...acc, [c.currency]: (acc[c.currency] ?? 0) + c.amountMinor } : acc), {});
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              onDragOver={(e) => {
                if (!canMove) return;
                e.preventDefault();
                setOver(stage.semantic);
              }}
              onDragLeave={() => setOver((o) => (o === stage.semantic ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const card = board.cards.find((c) => c.id === e.dataTransfer.getData("text/plain"));
                if (card) onMove(card, stage.semantic);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-xl border bg-raised/60 ${over === stage.semantic ? "border-tone bg-tone-soft" : "border-line"} ${stage.semantic === "NURTURE" ? "opacity-90" : ""}`}
            >
              <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2.5">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
                  <p className="truncate text-[11px] text-faint" title={STAGE_SEMANTIC_INFO[stage.semantic].description}>
                    {STAGE_SEMANTIC_INFO[stage.semantic].description}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted">
                  <div className="font-medium tabular-nums">{cards.length}</div>
                  {Object.keys(total).length > 0 && <div className="tabular-nums">{formatTotals(total)}</div>}
                </div>
              </header>
              <div className="flex min-h-24 flex-col gap-2 p-2">
                {cards.map((c) => (
                  <Card key={c.id} c={c} draggable={canMove} busy={moving === c.id} />
                ))}
                {cards.length === 0 && <p className="px-1 py-3 text-center text-xs text-faint">{canMove ? "Drop a deal here" : "No deals"}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
    </>
  );
}

function Card({ c, draggable, busy }: { c: DealCard; draggable: boolean; busy: boolean }) {
  const h = HEALTH_STYLE[c.health];
  return (
    <article
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`relative rounded-lg border border-line bg-surface p-3 text-sm shadow-sm ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${busy ? "opacity-60" : ""}`}
      data-tone="sales"
    >
      <div className="flex items-start justify-between gap-2">
        <Link href={`/opportunities/${c.id}`} className="min-w-0 font-medium leading-snug after:absolute after:inset-0 hover:underline">
          {c.company?.name ?? c.name}
        </Link>
        <span className={`mt-1 size-2 shrink-0 rounded-full ${h.dot}`} title={DEAL_HEALTH_INFO[c.health].label} />
      </div>
      <p className="truncate text-xs text-muted">{c.service ?? c.name}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className={`font-semibold tabular-nums ${c.amountMinor == null ? "text-faint" : ""}`}>{formatMoney(c.amountMinor, c.currency)}</span>
        <span className="truncate text-muted">{c.contact?.name ?? ""}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {QUALIFICATION_KEYS.slice(0, 4).map((k) => (
          <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${c.known.includes(k) ? "bg-brand-soft text-brand" : "bg-raised text-faint"}`} title={c.known.includes(k) ? "Known" : "Unknown"}>
            {c.known.includes(k) ? "✓" : "?"} {KEY_SHORT[k]}
          </span>
        ))}
      </div>
      <p className="mt-2 border-t border-line pt-2 text-xs">
        <span className="font-medium">Next:</span> {c.nextAction.action}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
        {c.waitingOnUs && (
          <span className="inline-flex items-center gap-0.5 font-medium text-amber">
            <MessageSquareReply className="size-3" /> waiting on us
          </span>
        )}
        <span className="inline-flex items-center gap-0.5">
          <Clock className="size-3" /> {c.daysInStage}d in stage
        </span>
      </div>
      {busy && <Loader className="absolute right-2 top-2 size-3.5 animate-spin text-muted" />}
    </article>
  );
}

function List({ cards, closed }: { cards: DealCard[]; closed: boolean }) {
  return (
    <div className="card divide-y divide-line">
      {cards.map((c) => (
        <Link key={c.id} href={`/opportunities/${c.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-hover sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.company?.name ?? c.name}</span>
              {closed ? (
                <span className={`badge ${c.status === "WON" ? "border-brand/25 bg-brand-soft text-brand" : "border-danger/25 bg-danger-soft text-danger"}`}>
                  {c.status === "WON" ? <Trophy className="size-3" /> : null} {c.status === "WON" ? "Won" : "Lost"}
                </span>
              ) : (
                <>
                  <span className="badge">{STAGE_SEMANTIC_INFO[c.stage].label}</span>
                  <span className={`badge ${HEALTH_STYLE[c.health].badge}`}>{DEAL_HEALTH_INFO[c.health].label}</span>
                </>
              )}
            </div>
            <p className="truncate text-xs text-muted">
              {c.service ?? c.name}
              {c.contact ? ` · ${c.contact.name}` : ""}
            </p>
          </div>
          <div className="min-w-0 text-sm sm:w-80">
            {closed ? (
              <span className="text-muted">{c.closedAt ? `Closed ${formatAgo(c.closedAt)}` : ""}</span>
            ) : (
              <>
                <div className="truncate">
                  <span className="font-medium">Next:</span> {c.nextAction.action}
                </div>
                <div className="truncate text-xs text-muted">{c.topRisk ? `⚠ ${c.topRisk.text}` : c.nextAction.why}</div>
              </>
            )}
          </div>
          <div className="text-sm font-semibold tabular-nums sm:w-28 sm:text-right">{formatMoney(c.status === "WON" ? c.wonAmountMinor : c.amountMinor, c.currency)}</div>
        </Link>
      ))}
    </div>
  );
}

function Empty({ view }: { view: View }) {
  return (
    <div className="card space-y-1.5 px-6 py-10 text-center text-sm">
      <p className="font-medium">{view === "closed" ? "No won or lost deals yet" : "No open deals"}</p>
      <p className="mx-auto max-w-md text-muted">
        Deals start from commercial evidence: a prospect who states a need and a timeline, budget, price question or meeting request. Create one from the AI Inbox, or by hand.
      </p>
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [service, setService] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const r = await api<{ items: { id: string; displayName: string }[] }>(`/companies?search=${encodeURIComponent(term.trim())}&limit=8`);
        setResults(r.items.map((c) => ({ id: c.id, name: c.displayName })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [term]);

  async function create() {
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      const amountMinor = amount.trim() ? Math.round(Number(amount.replace(/[^\d.]/g, "")) * 100) : null;
      const r = await post<{ id: string }>("/opportunities", { companyId: company.id, name: name.trim() || company.name, service: service.trim() || null, amountMinor });
      window.location.href = `/opportunities/${r.id}`;
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="New opportunity" className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="card w-full max-w-md space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New opportunity</h2>
          <button type="button" aria-label="Close" className="btn btn-ghost px-2" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        <p className="text-xs text-muted">Only for a real commercial need. Deals from conversations are created in the AI Inbox, with the prospect’s own words.</p>
        {!company ? (
          <label className="block text-sm">
            Company
            <input className="input mt-1 w-full" placeholder="Type a company name…" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
            {results.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-line">
                {results.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-hover" onClick={() => setCompany(r)}>
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </label>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
            {company.name}
            <button type="button" className="text-xs text-accent" onClick={() => setCompany(null)}>
              Change
            </button>
          </div>
        )}
        <label className="block text-sm">
          Name
          <input className="input mt-1 w-full" placeholder={company ? `${company.name} — …` : "e.g. Website redesign"} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          What they would buy
          <input className="input mt-1 w-full" placeholder="e.g. Website with online booking" value={service} onChange={(e) => setService(e.target.value)} />
        </label>
        <label className="block text-sm">
          Estimated value (optional)
          <input className="input mt-1 w-full" inputMode="decimal" placeholder="Leave empty if unknown" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!company || busy} onClick={() => void create()}>
            {busy ? <Loader className="size-4 animate-spin" /> : <Plus className="size-4" />} Create
          </button>
        </div>
      </div>
    </div>
  );
}
