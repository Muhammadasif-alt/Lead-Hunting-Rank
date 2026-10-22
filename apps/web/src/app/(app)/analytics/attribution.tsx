"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ATTRIBUTION_MODEL_INFO, ATTRIBUTION_MODELS, TOUCH_TYPE_LABEL, type AttributionModel, type AttributionReport, type AttributionRow, type DealLineage } from "@revenue-os/shared";
import { money, num, shortDate, withFilters } from "@/lib/analytics";
import { CurrencySync } from "./overview";
import { Empty, Loaded, SectionTitle, TableCard, Td, Th, useAnalytics } from "./parts";

const DIMENSIONS: [keyof AttributionReport["byDimension"], string][] = [
  ["market", "Market"],
  ["source", "Discovery source"],
  ["signalType", "Signal type"],
  ["campaign", "Campaign"],
  ["industry", "Industry"],
  ["persona", "Persona"],
  ["owner", "Owner"],
];

/** Revenue attribution (screen #10 §3-4): the whole acquisition chain is kept — revenue is never credited to one person. */
export function AttributionTab() {
  const { filters } = useAnalytics();
  const [model, setModel] = useState<AttributionModel>("FULL");
  const [dim, setDim] = useState<keyof AttributionReport["byDimension"]>("market");
  return (
    <div className="space-y-5">
      <section className="card space-y-3 p-4">
        <div role="radiogroup" aria-label="Attribution model" className="flex flex-wrap gap-1.5">
          {ATTRIBUTION_MODELS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={model === m}
              onClick={() => setModel(m)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${model === m ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
            >
              {ATTRIBUTION_MODEL_INFO[m].label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{ATTRIBUTION_MODEL_INFO[model].description}.</p>
      </section>

      <Loaded<AttributionReport> path={withFilters("/analytics/attribution", filters, { model })}>
        {(r) => <Report r={r} dim={dim} setDim={setDim} />}
      </Loaded>
    </div>
  );
}

function Report({ r, dim, setDim }: { r: AttributionReport; dim: keyof AttributionReport["byDimension"]; setDim: (d: keyof AttributionReport["byDimension"]) => void }) {
  const ctx = useAnalytics();
  const currency = r.deals[0]?.currency ?? ctx.currency;
  const rows = r.byDimension[dim] ?? [];
  return (
    <div className="space-y-5">
      <CurrencySync currency={r.deals[0]?.currency} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="card p-3.5">
          <div className="text-xs text-muted">Won revenue · {r.period.label}</div>
          <div className="mt-1 text-2xl font-semibold">{money(r.totalRevenueMinor, currency, true)}</div>
        </div>
        <div className="card p-3.5">
          <div className="text-xs text-muted">Won deals with a path</div>
          <div className="mt-1 text-2xl font-semibold">{num(r.deals.length)}</div>
        </div>
        <div className="card col-span-2 p-3.5 md:col-span-1">
          <div className="text-xs text-muted">Unattributed</div>
          <div className={`mt-1 text-2xl font-semibold ${r.unattributed ? "text-amber" : ""}`}>{num(r.unattributed)}</div>
          <div className="text-[11px] text-faint">Won deals with no recorded touches — not guessed.</div>
        </div>
      </div>

      <section>
        <SectionTitle hint={r.model === "FULL" ? "Each row gets the full value of every deal it touched — rows can add up to more than total revenue." : undefined}>Revenue by dimension</SectionTitle>
        <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Dimension">
          {DIMENSIONS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={dim === k}
              onClick={() => setDim(k)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium ${dim === k ? "border-tone bg-tone-soft text-tone" : "border-line text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {rows.length === 0 ? <Empty text="No attributed revenue or pipeline for this dimension yet." /> : <DimensionTable rows={rows} currency={currency} label={DIMENSIONS.find(([k]) => k === dim)?.[1] ?? dim} />}
      </section>

      <section>
        <SectionTitle hint="Open a deal to see its full acquisition path.">Won deals</SectionTitle>
        {r.deals.length === 0 ? (
          <Empty text="No won deals in this period." />
        ) : (
          <div className="space-y-2">
            {r.deals.map((d) => (
              <DealRow key={d.opportunityId} d={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DimensionTable({ rows, currency, label }: { rows: AttributionRow[]; currency: string; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.revenueMinor));
  return (
    <TableCard caption={`Attribution by ${label}`}>
      <thead>
        <tr>
          <Th>{label}</Th>
          <Th right>Revenue</Th>
          <Th right>Won</Th>
          <Th right>Opps</Th>
          <Th right>Pipeline</Th>
          <Th right>Meetings</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td className="max-w-[16rem]">
              {r.href ? (
                <Link href={r.href} className="block truncate font-medium hover:text-tone">
                  {r.label}
                </Link>
              ) : (
                <span className="block truncate font-medium">{r.label}</span>
              )}
              <span className="mt-1 block h-1.5 rounded-r-[4px] bg-raised" aria-hidden>
                <span className="block h-1.5 rounded-r-[4px] bg-tone" style={{ width: `${(r.revenueMinor / max) * 100}%` }} />
              </span>
            </Td>
            <Td right className="font-semibold">
              {money(r.revenueMinor, currency, true)}
            </Td>
            <Td right>{num(r.wonDeals)}</Td>
            <Td right>{num(r.opportunities)}</Td>
            <Td right>{money(r.pipelineMinor, currency, true)}</Td>
            <Td right>{num(r.meetings)}</Td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}

function DealRow({ d }: { d: DealLineage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
        {open ? <ChevronDown className="size-4 shrink-0 text-faint" aria-hidden /> : <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{d.company}</span>
          <span className="block truncate text-xs text-faint">
            {d.name} · won {shortDate(d.closedAt)} · {d.steps.length} touch{d.steps.length === 1 ? "" : "es"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold">{money(d.wonAmountMinor ?? d.amountMinor, d.currency, true)}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <LineageChain d={d} />
        </div>
      )}
    </div>
  );
}

/** Vertical acquisition path (screen #10 §3). Shared with the opportunity page. */
export function LineageChain({ d }: { d: DealLineage }) {
  return (
    <div className="space-y-3">
      {d.steps.length === 0 ? (
        <p className="text-sm text-muted">No touches recorded for this deal.</p>
      ) : (
        <ol className="relative space-y-0">
          {d.steps.map((s, i) => (
            <li key={`${s.touchType}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
                <span className="mt-1.5 size-2.5 rounded-full bg-tone ring-2 ring-surface" />
                {i < d.steps.length - 1 && <span className="absolute top-4 bottom-[-0.25rem] w-px bg-line-strong" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold tracking-wide text-faint uppercase">{TOUCH_TYPE_LABEL[s.touchType] ?? s.touchType}</span>
                {s.href ? (
                  <Link href={s.href} className="block text-sm font-medium break-words hover:text-tone">
                    {s.label}
                  </Link>
                ) : (
                  <span className="block text-sm font-medium break-words">{s.label}</span>
                )}
                <span className="block text-xs text-faint">{shortDate(s.occurredAt)}</span>
              </span>
            </li>
          ))}
          <li className="relative flex gap-3 pt-1">
            <span className="flex w-3 shrink-0 justify-center" aria-hidden>
              <span className={`mt-1.5 size-2.5 rounded-full ring-2 ring-surface ${d.status === "WON" ? "bg-brand" : "bg-faint"}`} />
            </span>
            <span className="text-sm font-semibold">
              {d.status === "WON" ? `Won ${money(d.wonAmountMinor ?? d.amountMinor, d.currency)}` : d.status}
              {d.closedAt && <span className="ml-1 text-xs font-normal text-faint">{shortDate(d.closedAt)}</span>}
            </span>
          </li>
        </ol>
      )}
      <p className="text-xs text-muted">
        {d.owner ? `Owner: ${d.owner} — ` : ""}revenue is credited to the whole chain, never to one salesperson alone.
      </p>
      {d.gaps.length > 0 && (
        <div className="rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
          <span className="font-semibold">Gaps in the record: </span>
          {d.gaps.join(" · ")}
        </div>
      )}
    </div>
  );
}
