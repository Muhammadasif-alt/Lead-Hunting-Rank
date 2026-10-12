"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenCheck, CircleAlert, FileUp, Loader, Lock, MessageCircleQuestion, Pencil, Plus, Search, ShieldOff, Sparkles } from "lucide-react";
import { KNOWLEDGE_TYPE_INFO, type KnowledgeType, type PermissionKey } from "@revenue-os/shared";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage, put } from "@/lib/api";
import { agoOf, LEVEL_STYLE, LIBRARY, type DocumentRow, type Gap, type KnowledgeListItem, type KnowledgeOverview, type Level, type ReviewQueue } from "@/lib/knowledge";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";
import { KnowledgeEditor } from "./Editor";
import { ContentView, DocumentsPanel, GapsPanel, ReviewPanel, SimulatorPanel, StatusBadge } from "./parts";

const SERVICE_LINKED: KnowledgeType[] = ["PRICING", "FAQ", "INTEGRATION", "CASE_STUDY", "PROPOSAL_BLOCK"];
const STATUS_LABEL: Record<KnowledgeOverview["status"], string> = { HEALTHY: "Healthy", FAIR: "Fair", NEEDS_ATTENTION: "Needs attention", EMPTY: "Not set up" };

/**
 * Knowledge Base + Business Brain (screen #13): the approved business truth the AI may answer from. Everything starts as
 * a draft; only a person approves. Gaps show what prospects asked that nobody has answered yet; the simulator shows what
 * the AI would say — with which items — before any prospect sees it.
 */
export function Knowledge({ tab }: { tab: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const router = useRouter();
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = (t: string) => router.push(t === "overview" ? "/knowledge" : `/knowledge?tab=${t}`, { scroll: false });

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api<KnowledgeOverview>("/knowledge"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void loadOverview(), [loadOverview]);

  const lib = LIBRARY.find((l) => l.tab === tab);
  const c = overview?.counts;
  const tabs: [string, string][] = [
    ["overview", "Overview"],
    ["profile", "Profile"],
    ...LIBRARY.map((l): [string, string] => [l.tab, KNOWLEDGE_TYPE_INFO[l.type].plural]),
    ["documents", "Documents"],
    ["gaps", `Gaps${c?.gaps ? ` · ${c.gaps}` : ""}`],
    ["review", `Review${c && c.drafts + c.conflicts + c.stale ? ` · ${c.drafts + c.conflicts + c.stale}` : ""}`],
    ["simulator", "Ask as prospect"],
  ];

  return (
    <div className="space-y-5" data-tone="ai">
      <PageHeader
        screen={findScreen("/knowledge")}
        actions={
          <>
            {can("knowledge.manage") && (
              <button type="button" className="btn btn-secondary" onClick={() => go("documents")}>
                <FileUp className="size-4" /> Upload
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => go("simulator")}>
              <MessageCircleQuestion className="size-4" /> Ask as prospect
            </button>
          </>
        }
      />

      <div role="tablist" aria-label="Knowledge sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => go(key)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium ${tab === key ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {tab === "profile" ? (
        <ProfileTab canManage={can("knowledge.manage")} onChange={loadOverview} />
      ) : lib ? (
        <Library key={lib.type} type={lib.type} canManage={can("knowledge.manage")} onChange={loadOverview} />
      ) : tab === "documents" ? (
        <Loaded<DocumentRow[]> path="/knowledge/documents" poll>
          {(docs, reload) => (
            <DocumentsPanel
              docs={docs}
              canManage={can("knowledge.manage")}
              onChange={() => {
                reload();
                void loadOverview();
              }}
            />
          )}
        </Loaded>
      ) : tab === "gaps" ? (
        <Loaded<Gap[]> path="/knowledge/gaps">
          {(gaps, reload) => (
            <GapsPanel
              gaps={gaps}
              canManage={can("knowledge.manage")}
              onChange={() => {
                reload();
                void loadOverview();
              }}
            />
          )}
        </Loaded>
      ) : tab === "review" ? (
        <Loaded<ReviewQueue> path="/knowledge/review">
          {(data, reload) => (
            <ReviewPanel
              data={data}
              canApprove={can("knowledge.approve")}
              canCommercial={can("knowledge.approve_commercial")}
              onChange={() => {
                reload();
                void loadOverview();
              }}
            />
          )}
        </Loaded>
      ) : tab === "simulator" ? (
        <SimulatorPanel />
      ) : !overview ? (
        <Loading />
      ) : (
        <Overview o={overview} canControl={can("knowledge.approve")} onChange={loadOverview} go={go} />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
      <Loader className="size-4 animate-spin" /> Loading…
    </div>
  );
}

/** Fetches one list for a tab; `poll` keeps document processing fresh (parsing runs in the worker). */
function Loaded<T>({ path, poll, children }: { path: string; poll?: boolean; children: (data: T, reload: () => void) => ReactNode }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [path]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!poll) return;
    const t = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(t);
  }, [load, poll]);
  if (error) return <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>;
  if (!data) return <Loading />;
  return <>{children(data, () => void load())}</>;
}

function Overview({ o, canControl, onChange, go }: { o: KnowledgeOverview; canControl: boolean; onChange: () => void; go: (t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const h = o.health;

  async function toggle(key: "pricingAnswers" | "technicalClaims") {
    setBusy(key);
    setError(null);
    try {
      await put("/knowledge/controls", { [key]: !o.controls[key] });
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (o.status === "EMPTY")
    return (
      <div className="card grid place-items-center gap-3 px-6 py-12 text-center">
        <BookOpenCheck className="size-9 text-tone" />
        <p className="text-base font-semibold">The AI does not know your business yet</p>
        <p className="max-w-md text-sm text-muted">
          Start with the business profile and your services. Until something is approved, the AI answers nothing about you — it hands every business question to a person.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => go("profile")}>
            <Plus className="size-4" /> Business profile
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => go("services")}>
            Add a service
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => go("documents")}>
            <FileUp className="size-4" /> Upload a document
          </button>
        </div>
      </div>
    );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        <section className="card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="eyebrow text-[11px]">Knowledge health</div>
              <p className="text-lg font-semibold">{STATUS_LABEL[o.status]}</p>
            </div>
            {o.readiness ? (
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums">{o.readiness.percent}%</div>
                <div className="text-xs text-muted">
                  of {o.readiness.questions} prospect questions answered from approved knowledge (30 days)
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">Answer readiness appears once prospects ask questions.</p>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Health label="Coverage" level={h.coverage.level} detail={h.coverage.detail} />
            <Health label="Freshness" level={h.freshness.level} detail={h.freshness.detail} />
            <Health label="Pricing readiness" level={h.pricingReadiness.level} detail={h.pricingReadiness.detail} />
            <Health label="Integrations" level={h.integrationCoverage.level} detail={h.integrationCoverage.detail} />
            <Health label="Conflicts" level={h.conflicts.count ? "WEAK" : "GOOD"} detail={h.conflicts.count ? `${h.conflicts.count} open` : "None"} onClick={() => go("review")} />
            <Health label="Gaps" level={h.gaps.count > 5 ? "WEAK" : h.gaps.count ? "MEDIUM" : "GOOD"} detail={h.gaps.count ? `${h.gaps.count} unanswered` : "None"} onClick={() => go("gaps")} />
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Needs attention</h2>
          {o.attention.length === 0 ? (
            <p className="text-sm text-muted">Nothing waiting.</p>
          ) : (
            <ul className="divide-y divide-line">
              {o.attention.map((a, i) => (
                <li key={i}>
                  <Link href={a.href} className="flex items-start gap-2 py-2 text-sm hover:text-tone">
                    <CircleAlert className={`mt-0.5 size-4 shrink-0 ${a.kind === "CONFLICT" || a.kind === "DISABLED" ? "text-danger" : "text-amber"}`} />
                    <span>{a.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Library</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {o.perType
              .filter((t) => t.type !== "DOCUMENT")
              .map((t) => {
                const tabKey = t.type === "PROFILE" ? "profile" : LIBRARY.find((l) => l.type === t.type)?.tab;
                return (
                  <button key={t.type} type="button" disabled={!tabKey} onClick={() => tabKey && go(tabKey)} className="rounded-md border border-line p-3 text-left hover:border-line-strong">
                    <div className="text-xs text-muted">{t.label}</div>
                    <div className="mt-0.5 text-lg font-semibold tabular-nums">{t.approved}</div>
                    <div className="text-[11px] text-faint">{t.total > t.approved ? `${t.total - t.approved} not approved` : "approved"}</div>
                  </button>
                );
              })}
          </div>
        </section>
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
        <section className="card p-4">
          <div className="eyebrow mb-2 flex items-center gap-1.5 text-[11px]">
            <ShieldOff className="size-3.5" /> Kill rules
          </div>
          <Toggle
            label="AI may answer pricing"
            hint="Off: every price question goes to a person, even with approved pricing."
            on={o.controls.pricingAnswers}
            busy={busy === "pricingAnswers"}
            disabled={!canControl}
            onClick={() => void toggle("pricingAnswers")}
          />
          <Toggle
            label="AI may make technical claims"
            hint="Off: integration and capability questions go to a person."
            on={o.controls.technicalClaims}
            busy={busy === "technicalClaims"}
            disabled={!canControl}
            onClick={() => void toggle("technicalClaims")}
          />
          {!canControl && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-faint">
              <Lock className="size-3" /> Only approvers can change these.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </section>

        <section className="card p-4">
          <div className="eyebrow mb-2 text-[11px]">Most used (30 days)</div>
          {o.mostUsed.length === 0 ? (
            <p className="text-sm text-muted">No AI answers used knowledge yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {o.mostUsed.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <Link href={`/knowledge/${m.id}`} className="truncate hover:text-tone">
                    {m.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{m.answers}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {o.lowConfidenceTopics.length > 0 && (
          <section className="card p-4">
            <div className="eyebrow mb-2 text-[11px]">Asked but not known</div>
            <ul className="space-y-1.5 text-sm">
              {o.lowConfidenceTopics.map((t) => (
                <li key={t.topic} className="flex items-center justify-between gap-2">
                  <span>{t.label}</span>
                  <span className="text-xs text-muted tabular-nums">{t.asked}×</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card p-4 text-xs text-muted">
          <div className="eyebrow mb-1.5 text-[11px]">How the AI uses this</div>
          <p>Only approved, current versions are used. Structured records (pricing, policies, integrations) win over loose text.</p>
          <p className="mt-1.5">Conflicts, stale high-risk items, legal questions, discounts and custom prices always go to a person.</p>
        </section>
      </aside>
    </div>
  );
}

function Health({ label, level, detail, onClick }: { label: string; level: Level; detail: string; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs text-muted">{label}</span>
        <span className={`badge text-[10px] ${LEVEL_STYLE[level]}`}>{level === "GOOD" ? "Good" : level === "MEDIUM" ? "Medium" : "Weak"}</span>
      </div>
      <div className="mt-1 text-xs text-faint">{detail}</div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-md border border-line p-3 text-left hover:border-line-strong">
      {body}
    </button>
  ) : (
    <div className="rounded-md border border-line p-3">{body}</div>
  );
}

function Toggle({ label, hint, on, busy, disabled, onClick }: { label: string; hint: string; on: boolean; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line py-2 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-faint">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled || busy}
        onClick={onClick}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${on ? "border-tone bg-tone" : "border-line bg-hover"}`}
      >
        <span className={`absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

function useItems(type: KnowledgeType) {
  const [items, setItems] = useState<KnowledgeListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setItems(await api<KnowledgeListItem[]>(`/knowledge/items?type=${type}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [type]);
  useEffect(() => void load(), [load]);
  return { items, error, load };
}

function ProfileTab({ canManage, onChange }: { canManage: boolean; onChange: () => void }) {
  const { items, error, load } = useItems("PROFILE");
  const [editing, setEditing] = useState(false);
  const router = useRouter();
  if (error) return <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>;
  if (!items) return <Loading />;
  const profile = items[0];
  if (editing || (!profile && canManage))
    return (
      <KnowledgeEditor
        type="PROFILE"
        itemId={profile?.id}
        initial={profile?.content}
        onSaved={(r) => {
          setEditing(false);
          onChange();
          void load();
          router.push(`/knowledge/${r.itemId}`);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  if (!profile) return <p className="card px-4 py-8 text-center text-sm text-muted">No business profile yet. Someone with knowledge access can write it.</p>;
  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">Business profile</h2>
            <StatusBadge status={profile.status} />
            {profile.version && <span className="text-xs text-muted">v{profile.version}</span>}
            {profile.draft && <span className="badge text-[10px]">Draft v{profile.draft.version} · {profile.draft.status === "IN_REVIEW" ? "in review" : "not submitted"}</span>}
          </div>
          <p className="text-xs text-muted">Who you are, who you help, how you speak. Reviewed {agoOf(profile.lastReviewedAt)}.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/knowledge/${profile.id}`} className="btn btn-secondary text-xs">
            History
          </Link>
          {canManage && (
            <button type="button" className="btn btn-primary text-xs" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> Edit
            </button>
          )}
        </div>
      </div>
      <ContentView type="PROFILE" content={profile.content} />
    </section>
  );
}

function Library({ type, canManage, onChange }: { type: KnowledgeType; canManage: boolean; onChange: () => void }) {
  const { items, error, load } = useItems(type);
  const services = useItems("SERVICE");
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const info = KNOWLEDGE_TYPE_INFO[type];
  const linked = SERVICE_LINKED.includes(type);
  const serviceName = (id: string | null) => (id ? services.items?.find((s) => s.id === id)?.title : null);
  const shown = (items ?? []).filter((i) => (!q.trim() || i.title.toLowerCase().includes(q.trim().toLowerCase()) || i.code.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-muted">{info.description}.</p>
          {info.commercial && <p className="text-[11px] text-faint">Commercial knowledge — only the owner can approve changes.</p>}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <label className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
            <input className="input w-full pl-8" placeholder={`Search ${info.plural.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {canManage && (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New
            </button>
          )}
        </div>
      </div>

      {creating && (
        <KnowledgeEditor
          type={type}
          services={linked ? (services.items ?? []).filter((s) => s.status !== "ARCHIVED").map((s) => ({ id: s.id, title: s.title })) : undefined}
          onSaved={() => {
            setCreating(false);
            void load();
            onChange();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error ? (
        <p className="card border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      ) : !items ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="card grid place-items-center gap-2 px-6 py-10 text-center">
          <Sparkles className="size-7 text-tone" />
          <p className="font-medium">{q ? "Nothing matches" : `No ${info.plural.toLowerCase()} yet`}</p>
          <p className="max-w-sm text-sm text-muted">Without approved {info.plural.toLowerCase()}, the AI hands these questions to a person and records them as gaps.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {shown.map((i) => (
            <li key={i.id}>
              <Link href={`/knowledge/${i.id}`} className={`card flex flex-col gap-2 p-3.5 hover:border-line-strong sm:flex-row sm:items-center ${i.conflicts ? "border-danger/30" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{i.title}</span>
                    <StatusBadge status={i.status} />
                    {i.version && <span className="text-[11px] text-faint">v{i.version}</span>}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {i.code}
                    {linked ? ` · ${serviceName(i.serviceItemId) ?? "All services"}` : ""}
                    {i.lastReviewedAt ? ` · reviewed ${agoOf(i.lastReviewedAt)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px]">
                  {i.draft && <span className="badge text-[10px]">{i.draft.status === "IN_REVIEW" ? "In review" : "Draft"} v{i.draft.version}</span>}
                  {i.scheduled.map((s) => (
                    <span key={s.version} className="badge text-[10px]">
                      v{s.version} from {s.effectiveFrom ? new Date(s.effectiveFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                    </span>
                  ))}
                  {i.aiDisabled && <span className="badge border-danger/30 bg-danger-soft text-[10px] text-danger">AI off</span>}
                  {i.needsReview && <span className="badge border-amber/30 bg-amber-soft text-[10px] text-amber">Revalidate</span>}
                  {i.conflicts > 0 && <span className="badge border-danger/30 bg-danger-soft text-[10px] text-danger">{i.conflicts} conflict{i.conflicts === 1 ? "" : "s"}</span>}
                  {i.usageCount > 0 && <span className="badge text-[10px]">Used {i.usageCount}×</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
