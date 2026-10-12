"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CircleAlert, Loader, NotebookPen, Plus } from "lucide-react";
import type { PermissionKey } from "@revenue-os/shared";
import { api, errorMessage } from "@/lib/api";
import type { CompanyMemory } from "@/lib/memory";
import { useMe } from "@/lib/session-context";
import { AddCommitment, AddNote, CandidatesPanel, CommitmentsPanel, ConflictsPanel, MemoryDrawer, MemoryList, RelationshipsPanel } from "../../memory/parts";

/** Company 360 "What does the AI currently know?" (screen #12 §20-29): facts, notes and guesses kept apart, with promises. */
export function MemoryTab({ companyId }: { companyId: string }) {
  const me = useMe();
  const can = (p: PermissionKey) => me.permissions.includes(p);
  const canManage = can("memory.manage");
  const [d, setD] = useState<CompanyMemory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "note" | "commitment">(null);

  const load = useCallback(async () => {
    try {
      setD(await api<CompanyMemory>(`/memory/companies/${companyId}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [companyId]);
  useEffect(() => void load(), [load]);

  if (!can("memory.read")) return <p className="card px-4 py-8 text-center text-sm text-muted">You don’t have permission to view AI memory.</p>;
  if (error)
    return (
      <div className="card flex items-start gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" /> {error}
      </div>
    );
  if (!d)
    return (
      <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
        <Loader className="size-4 animate-spin" /> Loading memory…
      </div>
    );

  const h = d.health;
  const nothing = !d.statements.length && !d.notes.length && !d.inferences.length && !d.candidates.length && !d.commitments.length && !d.relationships.length;
  return (
    <div className="space-y-4" data-tone="ai">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {d.layers.facts} fact{d.layers.facts === 1 ? "" : "s"} · {d.layers.hypotheses} AI guess{d.layers.hypotheses === 1 ? "" : "es"}
          {h.stale ? ` · ${h.stale} stale` : ""}
          {h.conflicts ? ` · ${h.conflicts} conflicting` : ""}
          {h.openCommitments ? ` · ${h.openCommitments} open promise${h.openCommitments === 1 ? "" : "s"}` : ""}
          {h.overdue ? ` (${h.overdue} overdue)` : ""}
        </p>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setAdding("note")}>
              <NotebookPen className="size-3.5" /> Add note
            </button>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => setAdding("commitment")}>
              <Plus className="size-3.5" /> Add commitment
            </button>
          </div>
        )}
      </div>

      {adding === "note" && <AddNote companyId={companyId} people={d.people} onDone={() => (setAdding(null), void load())} onCancel={() => setAdding(null)} />}
      {adding === "commitment" && <AddCommitment companyId={companyId} opportunities={d.opportunities} onDone={() => (setAdding(null), void load())} onCancel={() => setAdding(null)} />}

      {nothing && !adding && (
        <p className="card px-4 py-8 text-center text-sm text-muted">The AI hasn’t learned anything about this company yet. What they say in replies and meetings shows up here, with the quote.</p>
      )}

      {d.conflicts.length > 0 && (
        <Block title="Conflicting — the AI uses neither side">
          <ConflictsPanel rows={d.conflicts} canManage={canManage} onChange={load} />
        </Block>
      )}
      {d.candidates.length > 0 && (
        <Block title="Waiting for a person">
          <CandidatesPanel rows={d.candidates} canManage={canManage} onChange={load} />
        </Block>
      )}
      {d.statements.length > 0 && (
        <Block title="What they told us">
          <MemoryList rows={d.statements} onOpen={setOpen} showCompany={false} />
        </Block>
      )}
      {d.commitments.length > 0 && (
        <Block title="Promises">
          <CommitmentsPanel rows={d.commitments} canManage={canManage} onChange={load} showCompany={false} />
        </Block>
      )}
      {d.notes.length > 0 && (
        <Block title="Team notes">
          <MemoryList rows={d.notes} onOpen={setOpen} showCompany={false} />
        </Block>
      )}
      {d.inferences.length > 0 && (
        <Block title="AI guesses — not facts, never quoted to them">
          <MemoryList rows={d.inferences} onOpen={setOpen} showCompany={false} />
        </Block>
      )}
      {d.relationships.length > 0 && (
        <Block title="Relationships">
          <RelationshipsPanel rows={d.relationships} canManage={canManage} onChange={load} />
        </Block>
      )}

      {open && <MemoryDrawer id={open} canManage={canManage} onClose={() => setOpen(null)} onChange={() => void load()} />}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}
