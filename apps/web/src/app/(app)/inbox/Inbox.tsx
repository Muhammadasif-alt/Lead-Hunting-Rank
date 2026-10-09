"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, CircleAlert, Hand, Inbox as InboxIcon, Loader, Search, ShieldCheck, Sparkles } from "lucide-react";
import { CATEGORY_INFO, INTENT_INFO, type InboxCategory } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, post } from "@/lib/api";
import {
  CATEGORY_ORDER,
  CATEGORY_STYLE,
  intentStyle,
  type ConversationDetail,
  type ConversationRow,
  type InboxList,
} from "@/lib/conversations";
import { formatAgo } from "@/lib/crm";
import { findScreen } from "@/lib/screens";
import { Intelligence } from "./Intelligence";
import { Thread } from "./Thread";

type Filter = InboxCategory | "OPEN";

/**
 * AI Inbox (screen #5): which relationships need an action, and who should take it. List by priority (intent, human
 * requirement, risk, waiting time — not unread time) | thread with the AI draft and the policy's answer | intelligence.
 */
export function Inbox({ initialId }: { initialId: string | null }) {
  const [filter, setFilter] = useState<Filter>("OPEN");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState<InboxList | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; key: number } | null>(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const loadList = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== "OPEN") params.set("category", filter);
    if (query) params.set("q", query);
    try {
      setList(await api<InboxList>(`/conversations${params.size ? `?${params}` : ""}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [filter, query]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<ConversationDetail>(`/conversations/${id}`);
      if (selectedRef.current === id) setDetail(d);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([loadList(), selectedRef.current ? loadDetail(selectedRef.current) : null]);
  }, [loadList, loadDetail]);

  useEffect(() => {
    void loadList();
  }, [loadList]);
  useEffect(() => {
    setDetail(null);
    if (!selected) return;
    void loadDetail(selected);
    void post(`/conversations/${selected}/read`).catch(() => undefined);
  }, [selected, loadDetail]);
  // Replies arrive and the AI works in the background — keep the inbox fresh.
  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  function open(id: string | null) {
    setSelected(id);
    window.history.replaceState(null, "", id ? `/inbox?c=${id}` : "/inbox");
  }

  const screen = findScreen("/inbox");
  const openCount = list ? CATEGORY_ORDER.filter((c) => c !== "CLOSED").reduce((n, c) => n + list.counts[c], 0) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        screen={screen}
        actions={
          list ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <span className={`size-2 rounded-full ${list.waitingOnUs ? "bg-amber" : "bg-brand"}`} />
              <span className="font-medium">{list.waitingOnUs}</span>
              <span className="text-muted">waiting on us</span>
            </div>
          ) : null
        }
      />
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
        {/* ── list ── */}
        <aside className={`${selected ? "hidden lg:block" : ""} lg:sticky lg:top-4 min-w-0`}>
          <div className="card overflow-hidden">
            <form
              className="border-b border-line p-3"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
            >
              <label className="relative block">
                <span className="sr-only">Search conversations</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  className="input w-full pl-8"
                  placeholder="Search name, email, words…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onBlur={() => setQuery(search.trim())}
                />
              </label>
            </form>
            <div role="tablist" aria-label="Inbox categories" className="flex gap-1.5 overflow-x-auto border-b border-line p-2">
              {(["OPEN", ...CATEGORY_ORDER] as Filter[]).map((f) => {
                const count = f === "OPEN" ? openCount : (list?.counts[f] ?? 0);
                const active = filter === f;
                return (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    title={f === "OPEN" ? "Everything not closed" : CATEGORY_INFO[f].description}
                    onClick={() => setFilter(f)}
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${active ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
                  >
                    {f === "OPEN" ? "Open" : CATEGORY_INFO[f].label} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="lg:max-h-[calc(100dvh-13rem)] lg:overflow-y-auto">
              {!list ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
                  <Loader className="size-4 animate-spin" /> Loading…
                </div>
              ) : list.items.length === 0 ? (
                <EmptyList filter={filter} searching={!!query} />
              ) : (
                <ul className="divide-y divide-line">
                  {list.items.map((c) => (
                    <Row key={c.id} c={c} active={c.id === selected} onOpen={() => open(c.id)} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        {/* ── thread ── */}
        <section className={`${selected ? "" : "hidden lg:block"} min-w-0`}>
          {!selected ? (
            <div className="card grid place-items-center gap-2 px-6 py-16 text-center">
              <InboxIcon className="size-8 text-tone" />
              <p className="font-medium">Pick a conversation</p>
              <p className="max-w-sm text-sm text-muted">
                The most urgent is at the top: buying signals, questions only a person can answer, and prospects who have
                waited longest.
              </p>
            </div>
          ) : !detail ? (
            <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
              <Loader className="size-4 animate-spin" /> Loading conversation…
            </div>
          ) : (
            <Thread detail={detail} onBack={() => open(null)} onChange={refresh} prefill={prefill} />
          )}
        </section>

        {/* ── intelligence ── */}
        {selected && detail && (
          <aside className="min-w-0 lg:col-start-2 xl:sticky xl:top-4 xl:col-start-auto xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto">
            <Intelligence detail={detail} onChange={refresh} onOffer={(text) => setPrefill({ text, key: Date.now() })} />
          </aside>
        )}
      </div>
    </div>
  );
}

function Row({ c, active, onOpen }: { c: ConversationRow; active: boolean; onOpen: () => void }) {
  const who = c.contactName ?? c.email;
  const waitingSince = c.waitingOn === "US" && c.lastInboundAt ? formatAgo(c.lastInboundAt).replace(" ago", "") : null;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className={`block w-full px-3.5 py-3 text-left hover:bg-hover ${active ? "bg-tone-soft" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {c.unread && <span className="size-2 shrink-0 rounded-full bg-tone" aria-label="Unread" />}
              <span className={`truncate text-sm ${c.unread ? "font-semibold" : "font-medium"}`}>{c.company?.name ?? who}</span>
            </div>
            <div className="truncate text-xs text-muted">{c.company ? who : c.email}</div>
          </div>
          <span className="shrink-0 text-[11px] text-faint">{formatAgo(c.lastMessageAt)}</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">
          {c.snippet ? `${c.snippet.direction === "OUTBOUND" ? "You: " : ""}${c.snippet.text}` : c.subject}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {c.primaryIntent && <span className={`badge text-[10px] ${intentStyle(c.primaryIntent)}`}>{INTENT_INFO[c.primaryIntent].label}</span>}
          <span className={`badge text-[10px] ${CATEGORY_STYLE[c.category]}`}>{CATEGORY_INFO[c.category].label}</span>
          {c.pendingApproval && (
            <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">
              <ShieldCheck className="size-3" /> Approve
            </span>
          )}
          {c.draftReady && !c.pendingApproval && (
            <span className="badge border-tone-ai/25 bg-tone-ai-soft text-[10px] text-tone-ai">
              <Sparkles className="size-3" /> Draft
            </span>
          )}
          {c.mode === "HUMAN" && (
            <span className="badge text-[10px]">
              <Hand className="size-3" /> You
            </span>
          )}
          {c.mode === "AUTO" && (
            <span className="badge text-[10px]">
              <Bot className="size-3" /> Auto
            </span>
          )}
          {waitingSince && <span className="ml-auto text-[10px] font-medium text-amber">waiting {waitingSince}</span>}
        </div>
      </button>
    </li>
  );
}

function EmptyList({ filter, searching }: { filter: Filter; searching: boolean }) {
  return (
    <div className="space-y-1.5 px-4 py-8 text-center text-sm">
      <p className="font-medium">{searching ? "Nothing matches" : filter === "OPEN" ? "No open conversations" : `Nothing in ${CATEGORY_INFO[filter].label}`}</p>
      <p className="text-muted">
        {searching
          ? "Try another word, a name or an email address."
          : "When a prospect replies to a campaign, the conversation appears here — the follow-ups stop on their own."}
      </p>
    </div>
  );
}
