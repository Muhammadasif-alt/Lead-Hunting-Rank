"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArrowLeft, Check, CircleAlert, History, Loader, Pencil, Power, RotateCcw, Send, ShieldCheck, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { KNOWLEDGE_TYPE_INFO, type PermissionKey } from "@revenue-os/shared";
import { api, errorMessage, post } from "@/lib/api";
import { agoOf, dateOf, LIBRARY, ORIGIN_LABEL, type KnowledgeDetail, type KnowledgeListItem } from "@/lib/knowledge";
import { useMe } from "@/lib/session-context";
import { KnowledgeEditor } from "../Editor";
import { ContentView, StatusBadge } from "../parts";

const FEEDBACK: { kind: "HELPFUL" | "OUTDATED" | "INCORRECT" | "INCOMPLETE"; label: string }[] = [
  { kind: "HELPFUL", label: "Helpful" },
  { kind: "OUTDATED", label: "Outdated" },
  { kind: "INCORRECT", label: "Incorrect" },
  { kind: "INCOMPLETE", label: "Incomplete" },
];

/**
 * One knowledge item (screen #13 §52-60): the approved version the AI answers from, the open draft and who must approve
 * it, every version with restore, conflicts, where the AI used it, feedback and the audit trail.
 */
export function ItemView({ id }: { id: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const [d, setD] = useState<KnowledgeDetail | null>(null);
  const [services, setServices] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState<null | "reject" | "archive" | "disable">(null);
  const [reason, setReason] = useState("");
  const [compare, setCompare] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setD(await api<KnowledgeDetail>(`/knowledge/items/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (!editing || services.length) return;
    void api<KnowledgeListItem[]>("/knowledge/items?type=SERVICE")
      .then((s) => setServices(s.map((x) => ({ id: x.id, title: x.title }))))
      .catch(() => undefined);
  }, [editing, services.length]);

  async function run(name: string, path: string, body: unknown = {}, done?: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await post(path, body);
      if (done) setNotice(done);
      setAsk(null);
      setReason("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!d)
    return error ? (
      <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    ) : (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading…
      </div>
    );

  const it = d.item;
  const commercial = it.typeInfo.commercial;
  const canApprove = can("knowledge.approve") && (!commercial || can("knowledge.approve_commercial"));
  const canManage = can("knowledge.manage") && it.status !== "ARCHIVED";
  const backTab = it.type === "PROFILE" ? "profile" : LIBRARY.find((l) => l.type === it.type)?.tab;
  const compared = compare !== null ? d.revisions.find((r) => r.version === compare) : null;

  return (
    <div className="space-y-5" data-tone="ai">
      <Link href={backTab ? `/knowledge?tab=${backTab}` : "/knowledge"} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> {KNOWLEDGE_TYPE_INFO[it.type].plural}
      </Link>

      <header className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{it.title}</h1>
              <StatusBadge status={it.status} />
              {it.aiDisabled && <span className="badge border-danger/30 bg-danger-soft text-danger">AI off</span>}
            </div>
            <p className="text-sm text-muted">
              {it.code} · {it.typeInfo.label}
              {d.current ? ` · v${d.current.version} approved ${agoOf(d.current.approvedAt)}` : " · never approved"}
              {d.service ? (
                <>
                  {" · "}
                  <Link href={`/knowledge/${d.service.id}`} className="hover:text-tone">
                    {d.service.title}
                  </Link>
                </>
              ) : null}
            </p>
            <p className="text-xs text-faint">
              Reviewed {agoOf(it.lastReviewedAt)}
              {it.nextReviewAt ? ` · next check ${dateOf(it.nextReviewAt)}` : ""} · used in {it.usageCount} answer{it.usageCount === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && !editing && (
              <button type="button" className="btn btn-secondary text-xs" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" /> {d.draft ? "Edit draft" : "Propose change"}
              </button>
            )}
            {canApprove && d.current && !d.draft && (
              <button type="button" className="btn btn-secondary text-xs" disabled={!!busy} onClick={() => void run("reviewed", `/knowledge/items/${id}/reviewed`, {}, "Marked as still correct.")}>
                <ShieldCheck className="size-3.5" /> Still correct
              </button>
            )}
            {can("knowledge.approve") && it.status !== "ARCHIVED" && (
              <button
                type="button"
                className="btn btn-ghost text-xs"
                disabled={!!busy}
                onClick={() => (it.aiDisabled ? void run("disable", `/knowledge/items/${id}/disable`, { disabled: false }, "The AI may use it again.") : setAsk("disable"))}
              >
                <Power className="size-3.5" /> {it.aiDisabled ? "Enable for AI" : "Disable for AI"}
              </button>
            )}
            {can("knowledge.approve") && it.status !== "ARCHIVED" && (
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setAsk("archive")}>
                <Archive className="size-3.5" /> Archive
              </button>
            )}
          </div>
        </div>

        {(it.needsReview || it.aiDisabled) && (
          <div className="mt-3 space-y-1 text-xs">
            {it.needsReview && (
              <p className="flex items-start gap-1.5 text-amber">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" /> Needs revalidation{it.needsReviewReason ? ` — ${it.needsReviewReason}` : ""}.
              </p>
            )}
            {it.aiDisabled && (
              <p className="flex items-start gap-1.5 text-danger">
                <Power className="mt-0.5 size-3.5 shrink-0" /> The AI does not use this{it.aiDisabledReason ? ` — ${it.aiDisabledReason}` : ""}. Its questions go to a person.
              </p>
            )}
          </div>
        )}

        {ask && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) return;
              if (ask === "reject") void run("reject", `/knowledge/items/${id}/reject`, { reason }, "Draft rejected.");
              else if (ask === "archive") void run("archive", `/knowledge/items/${id}/archive`, { reason }, "Archived.");
              else void run("disable", `/knowledge/items/${id}/disable`, { disabled: true, reason }, "Disabled for the AI.");
            }}
          >
            <input autoFocus className="input min-w-0 flex-1" placeholder={ask === "reject" ? "Why is it rejected?" : ask === "archive" ? "Why is it archived?" : "Why disable it?"} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <button type="submit" disabled={!reason.trim() || !!busy} className="btn btn-primary text-xs">
              {busy ? <Loader className="size-3.5 animate-spin" /> : null} {ask === "reject" ? "Reject" : ask === "archive" ? "Archive" : "Disable"}
            </button>
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setAsk(null)}>
              Cancel
            </button>
          </form>
        )}
      </header>

      {error && (
        <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}
      {notice && <div className="card border-tone/30 bg-tone-soft px-4 py-3 text-sm text-tone">{notice}</div>}

      {editing && (
        <KnowledgeEditor
          type={it.type}
          itemId={id}
          title={it.title}
          initial={d.draft?.content ?? d.current?.content}
          services={services}
          serviceItemId={it.serviceItemId}
          onSaved={() => {
            setEditing(false);
            setNotice("Draft saved.");
            void load();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {d.draft && (
            <section className="card border-amber/30 p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">Draft v{d.draft.version}</h2>
                    <StatusBadge status={d.draft.status} />
                    <span className="text-xs text-muted">{ORIGIN_LABEL[d.draft.origin] ?? d.draft.origin}</span>
                  </div>
                  <p className="text-xs text-muted">
                    {d.draft.changeNote ?? "No change note"}
                    {d.draft.effectiveFrom ? ` · takes effect ${dateOf(d.draft.effectiveFrom)}` : ""}
                  </p>
                  <p className="text-[11px] text-faint">Not used by the AI until a person approves it{commercial ? " — owner approval for commercial knowledge" : ""}.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canManage && d.draft.status === "DRAFT" && (
                    <button type="button" className="btn btn-secondary text-xs" disabled={!!busy} onClick={() => void run("submit", `/knowledge/items/${id}/submit`, {}, "Submitted for review.")}>
                      <Send className="size-3.5" /> Submit
                    </button>
                  )}
                  {canApprove && (
                    <>
                      <button type="button" className="btn btn-primary text-xs" disabled={!!busy} onClick={() => void run("approve", `/knowledge/items/${id}/approve`, {}, "Approved — the AI uses this version now (or from its effective date).")}>
                        {busy === "approve" ? <Loader className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
                      </button>
                      <button type="button" className="btn btn-ghost text-xs" onClick={() => setAsk("reject")}>
                        <X className="size-3.5" /> Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-4">
                <ContentView type={it.type} content={d.draft.content} />
              </div>
            </section>
          )}

          <section className="card p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">{d.current ? `Approved — v${d.current.version}` : "Not approved yet"}</h2>
            {d.current ? <ContentView type={it.type} content={d.current.content} /> : <p className="text-sm text-muted">The AI does not use this item until a version is approved.</p>}
            {d.scheduled.length > 0 && (
              <p className="mt-3 text-xs text-muted">
                Scheduled: {d.scheduled.map((s) => `v${s.version} from ${dateOf(s.effectiveFrom)}`).join(", ")}
              </p>
            )}
          </section>

          {d.conflicts.length > 0 && (
            <section className="card border-danger/30 p-4">
              <h2 className="mb-2 text-sm font-semibold">Conflicts</h2>
              <ul className="space-y-2 text-sm">
                {d.conflicts.map((c) => (
                  <li key={c.id} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.topic}</span>
                      <span className={`badge text-[10px] ${c.status === "OPEN" ? "border-danger/30 bg-danger-soft text-danger" : "text-faint"}`}>{c.status === "OPEN" ? "Open" : (c.resolution ?? c.status)}</span>
                    </div>
                    <p className="text-xs text-muted">{c.detail}</p>
                    {c.other && (
                      <Link href={`/knowledge/${c.other.id}`} className="text-xs text-tone hover:underline">
                        vs {c.other.title}
                      </Link>
                    )}
                    {c.status === "OPEN" && can("knowledge.approve") && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" className="btn btn-secondary h-7 text-xs" disabled={!!busy} onClick={() => void run("conflict", `/knowledge/conflicts/${c.id}/resolve`, { resolution: "RESOLVED" }, "Conflict resolved.")}>
                          Resolved
                        </button>
                        <button type="button" className="btn btn-ghost h-7 text-xs" disabled={!!busy} onClick={() => void run("conflict", `/knowledge/conflicts/${c.id}/resolve`, { resolution: "DISMISSED" }, "Conflict dismissed.")}>
                          Not a conflict
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-4">
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <History className="size-4" /> Versions
            </h2>
            <ul className="divide-y divide-line">
              {d.revisions.map((r) => (
                <li key={r.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">v{r.version}</span>
                      <StatusBadge status={r.current ? "APPROVED" : r.status} />
                      {r.current && <span className="text-[11px] text-tone">current</span>}
                      <span className="text-[11px] text-faint">{ORIGIN_LABEL[r.origin] ?? r.origin}</span>
                    </div>
                    <div className="truncate text-xs text-muted">
                      {r.changeNote ?? "—"} · {r.approvedBy ? `approved by ${r.approvedBy} ${dateOf(r.approvedAt)}` : `created ${dateOf(r.createdAt)}${r.createdBy ? ` by ${r.createdBy}` : ""}`}
                      {r.rejectedReason ? ` · rejected: ${r.rejectedReason}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button type="button" className="btn btn-ghost h-7 px-2 text-xs" onClick={() => setCompare(compare === r.version ? null : r.version)}>
                      {compare === r.version ? "Hide" : "View"}
                    </button>
                    {canApprove && !r.current && (r.status === "SUPERSEDED" || r.status === "APPROVED") && !d.draft && (
                      <button type="button" className="btn btn-ghost h-7 px-2 text-xs" disabled={!!busy} onClick={() => void run("restore", `/knowledge/items/${id}/restore`, { version: r.version }, `Restored v${r.version} as a new version.`)}>
                        <RotateCcw className="size-3.5" /> Restore
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {compared && (
              <div className="mt-3 rounded-md border border-line p-3">
                <div className="mb-2 text-xs font-medium text-muted">v{compared.version} content</div>
                <ContentView type={it.type} content={compared.content} />
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4">
          <section className="card p-4">
            <div className="eyebrow mb-2 text-[11px]">Was it right?</div>
            <div className="flex flex-wrap gap-1.5">
              {FEEDBACK.map((f) => (
                <button key={f.kind} type="button" className="btn btn-secondary h-7 px-2 text-xs" disabled={!!busy} onClick={() => void run("feedback", `/knowledge/items/${id}/feedback`, { kind: f.kind }, "Thanks — feedback recorded.")}>
                  {f.kind === "HELPFUL" ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />} {f.label}
                  {d.feedback[f.kind] ? <span className="text-faint"> {d.feedback[f.kind]}</span> : null}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">Outdated or incorrect marks it for revalidation.</p>
          </section>

          <section className="card p-4">
            <div className="eyebrow mb-2 text-[11px]">Used by the AI</div>
            {d.usage.length === 0 ? (
              <p className="text-sm text-muted">Not used in any answer yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {d.usage.slice(0, 10).map((u, i) => (
                  <li key={i}>
                    <div className="text-fg">{u.question ?? "—"}</div>
                    <div className="text-faint">
                      v{u.version} · {u.company ?? "—"} · {agoOf(u.at)}
                      {u.conversationId && (
                        <>
                          {" · "}
                          <Link href={`/inbox?c=${u.conversationId}`} className="text-tone hover:underline">
                            open
                          </Link>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {(d.children.length > 0 || d.sources.length > 0 || d.gaps.length > 0) && (
            <section className="card space-y-3 p-4 text-sm">
              {d.children.length > 0 && (
                <div>
                  <div className="eyebrow mb-1 text-[11px]">Linked knowledge</div>
                  <ul className="space-y-1">
                    {d.children.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <Link href={`/knowledge/${c.id}`} className="truncate hover:text-tone">
                          {c.title}
                        </Link>
                        <span className="shrink-0 text-[11px] text-faint">{KNOWLEDGE_TYPE_INFO[c.type].label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.sources.length > 0 && (
                <div>
                  <div className="eyebrow mb-1 text-[11px]">Source documents</div>
                  <ul className="space-y-1 text-xs text-muted">
                    {d.sources.map((s) => (
                      <li key={s.id}>
                        {s.fileName} · {dateOf(s.uploadedAt)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.gaps.length > 0 && (
                <div>
                  <div className="eyebrow mb-1 text-[11px]">Answers these gaps</div>
                  <ul className="space-y-1 text-xs text-muted">
                    {d.gaps.map((g) => (
                      <li key={g.id}>
                        “{g.question}” · asked {g.occurrences}× · {g.status.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section className="card p-4">
            <div className="eyebrow mb-2 text-[11px]">Audit</div>
            {d.audit.length === 0 ? (
              <p className="text-sm text-muted">No changes recorded.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {d.audit.slice(0, 15).map((a, i) => (
                  <li key={i}>
                    <span className="text-fg">{a.action.replace(/^knowledge\./, "").replace(/_/g, " ")}</span>
                    <span className="text-faint">
                      {" "}
                      · {a.by ?? "system"} · {agoOf(a.at)}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
