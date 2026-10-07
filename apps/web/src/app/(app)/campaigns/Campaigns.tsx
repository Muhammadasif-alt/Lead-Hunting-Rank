"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, Loader, Plus, RefreshCw, Send } from "lucide-react";
import { PageHeader } from "@/components/app/PageHeader";
import { api, errorMessage } from "@/lib/api";
import { CAMPAIGN_STATUS, OBJECTIVE_LABEL, type CampaignRow } from "@/lib/campaigns";
import { formatAgo } from "@/lib/crm";
import { findScreen } from "@/lib/screens";
import { useMe } from "@/lib/session-context";

/**
 * Campaigns (screen #6, Phase 11): every campaign with what matters — prospects, sent, replies, unsubscribes and what
 * waits for a person. No open rates.
 */
export function Campaigns() {
  const me = useMe();
  const canCreate = me.permissions.includes("campaign.create");
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<CampaignRow[]>("/campaigns"));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <PageHeader
        screen={findScreen("/campaigns")}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => void load()}>
              <RefreshCw className="size-4" /> Refresh
            </button>
            {canCreate && (
              <Link href="/campaigns/new" className="btn btn-primary">
                <Plus className="size-4" /> New campaign
              </Link>
            )}
          </>
        }
      />
      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      {!rows ? (
        <div className="card flex items-center gap-2 px-5 py-4 text-sm text-muted">
          <Loader className="size-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-tone/20 bg-tone-soft">
            <Send className="size-5 text-tone" />
          </div>
          <h2 className="mt-4 font-semibold">No campaigns yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            A campaign picks researched companies with a verified contact, drafts a short evidence-backed email for
            each, and stops by itself on a reply, an unsubscribe or a bounce.
          </p>
          {canCreate && (
            <Link href="/campaigns/new" className="btn btn-primary mt-5 inline-flex">
              <Plus className="size-4" /> New campaign
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-faint">
                <th className="px-5 py-3 font-medium">Campaign</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 text-right font-medium">Prospects</th>
                <th className="px-3 py-3 text-right font-medium">Sent</th>
                <th className="px-3 py-3 text-right font-medium">Replied</th>
                <th className="px-3 py-3 text-right font-medium">Unsubscribed</th>
                <th className="px-5 py-3 text-right font-medium">Needs you</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-hover">
                  <td className="px-5 py-3">
                    <Link href={`/campaigns/${r.id}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-faint">
                      {OBJECTIVE_LABEL[r.objective]} ·{" "}
                      {r.launchedAt ? `launched ${formatAgo(r.launchedAt)}` : `created ${formatAgo(r.createdAt)}`}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`badge ${CAMPAIGN_STATUS[r.status].className}`}>
                      {CAMPAIGN_STATUS[r.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.prospects}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.sent}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.replied}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.unsubscribed}</td>
                  <td className="px-5 py-3 text-right">
                    {r.needsApproval > 0 ? (
                      <Link href="/ai-control" className="badge border-accent/25 bg-accent-soft text-accent">
                        {r.needsApproval} to approve
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
