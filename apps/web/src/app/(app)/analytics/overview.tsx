"use client";

import { useEffect } from "react";
import { BarChart3, Lightbulb, Search, TriangleAlert } from "lucide-react";
import type { AnalyticsOverview, FunnelStage, Insight, KpiValue, PipelineAnalytics } from "@revenue-os/shared";
import { money, num, pct, shortDate, withFilters } from "@/lib/analytics";
import { Columns, DrillNumber, Empty, HBars, KpiCard, KpiRow, Loaded, MetricLabel, RecordList, SectionTitle, TableCard, Td, Th, useAnalytics } from "./parts";

const COST_KEYS = new Set(["providerCost", "aiCost", "costPerMeeting"]);

/** Writes the reporting currency into the screen context once a response carries it. */
export function CurrencySync({ currency }: { currency: string | null | undefined }) {
  const { setCurrency } = useAnalytics();
  useEffect(() => {
    if (currency) setCurrency(currency);
  }, [currency, setCurrency]);
  return null;
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

export function OverviewTab({ canCosts }: { canCosts: boolean }) {
  const { filters } = useAnalytics();
  return <Loaded<AnalyticsOverview> path={withFilters("/analytics/overview", filters)}>{(o) => <OverviewBody o={o} canCosts={canCosts} />}</Loaded>;
}

function OverviewBody({ o, canCosts }: { o: AnalyticsOverview; canCosts: boolean }) {
  const visible = (rows: KpiValue[]) => (canCosts ? rows : rows.filter((k) => !COST_KEYS.has(k.key)));
  const c = o.currency;
  return (
    <div className="space-y-6">
      <CurrencySync currency={c} />
      <p className="text-xs text-faint">
        {o.period.label} ({shortDate(o.period.from)} – {shortDate(new Date(new Date(o.period.to).getTime() - 86_400_000).toISOString())}) · compared with {o.previous.label.toLowerCase()}
      </p>

      {o.empty ? (
        <div className="card grid place-items-center gap-2 px-6 py-12 text-center">
          <BarChart3 className="size-9 text-tone" aria-hidden />
          <p className="text-base font-semibold">Nothing to measure yet</p>
          <p className="max-w-lg text-sm text-muted">
            Analytics only reports what really happened. Once companies are discovered, campaigns send, prospects reply and deals move, outcomes appear here — every number linked to the records behind it. No sample data is shown.
          </p>
        </div>
      ) : (
        <>
          <section>
            <SectionTitle hint="What happened to the business — not how many emails were sent.">Business outcomes</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              {o.outcomes.map((k) => (
                <KpiCard
                  key={k.key}
                  k={k}
                  currency={c}
                  big
                  hint={k.key === "openPipeline" && o.openPipelineUnvalued > 0 ? `${o.openPipelineUnvalued} deal${o.openPipelineUnvalued === 1 ? "" : "s"} without a value (not counted)` : undefined}
                />
              ))}
            </div>
          </section>

          {o.insights.length > 0 && (
            <section>
              <SectionTitle hint="Evidence first — each insight opens the records behind it.">What needs attention</SectionTitle>
              <div className="grid gap-3 md:grid-cols-2">
                {o.insights.map((i, n) => (
                  <InsightCard key={`${i.kind}-${n}`} i={i} />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle hint="Share of the previous stage that reached each stage, against the previous period. The biggest leak is marked.">Full funnel</SectionTitle>
            <FunnelView stages={o.funnel} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card min-w-0 p-4">
              <SectionTitle>Won revenue by week</SectionTitle>
              <Columns
                label="Won revenue by week"
                data={o.timeline.map((t) => ({ x: t.week, xLabel: `Week of ${shortDate(t.week)}`, values: { revenue: t.revenueMinor } }))}
                series={[{ key: "revenue", label: "Won revenue", color: "var(--color-tone)" }]}
                format={(n) => money(n, c, true)}
              />
            </div>
            <div className="card min-w-0 p-4">
              <SectionTitle>Meetings booked by week</SectionTitle>
              <Columns
                label="Meetings booked by week"
                data={o.timeline.map((t) => ({ x: t.week, xLabel: `Week of ${shortDate(t.week)}`, values: { meetings: t.meetings } }))}
                series={[{ key: "meetings", label: "Meetings", color: "var(--color-accent)" }]}
                format={(n) => n.toLocaleString()}
              />
            </div>
          </section>

          <KpiRow title="Sales performance" rows={visible(o.sales)} currency={c} />
          <KpiRow title="Outreach performance" rows={visible(o.outreach)} currency={c} />
          <KpiRow title="Operational health" rows={visible(o.operations)} currency={c} />
        </>
      )}
    </div>
  );
}

const INSIGHT_KIND: Record<Insight["kind"], string> = { BOTTLENECK: "Bottleneck", ANOMALY: "Anomaly", STAGE_AGING: "Stage aging", COST: "Cost", DATA: "Data quality" };

function InsightCard({ i }: { i: Insight }) {
  const { drill } = useAnalytics();
  return (
    <article className="card flex min-w-0 flex-col gap-2 border-tone/25 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="badge border-tone/30 bg-tone-soft text-[10px] text-tone">
          <Lightbulb className="size-3" aria-hidden /> {INSIGHT_KIND[i.kind]}
        </span>
        <span className="badge h-4 border-amber/30 bg-amber-soft px-1.5 text-[9px] text-amber">AI insight</span>
      </div>
      {i.evidence.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold tracking-wide text-faint uppercase">Evidence</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-sm">
            {i.evidence.map((e, n) => (
              <li key={n}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold break-words">{i.title}</h3>
        <p className="text-sm text-muted">{i.detail}</p>
      </div>
      {i.records.length > 0 && <RecordList records={i.records} limit={3} />}
      {i.drill && (
        <button type="button" className="btn btn-secondary mt-auto self-start" onClick={() => drill({ metric: i.drill!.metric, filters: i.drill!.filters })}>
          <Search className="size-4" /> Investigate
        </button>
      )}
    </article>
  );
}

function FunnelView({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  if (!stages.length) return <Empty text="No funnel data in this period." />;
  return (
    <div className="card overflow-hidden">
      <ol className="divide-y divide-line">
        {stages.map((s) => {
          const change = s.conversion != null && s.previousConversion != null ? Math.round((s.conversion - s.previousConversion) * 10) / 10 : null;
          return (
            <li key={s.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_9rem] ${s.leak ? "bg-danger-soft" : ""}`}>
              <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <span className="truncate">{s.label}</span>
                {s.leak && (
                  <span className="badge h-5 shrink-0 border-danger/30 bg-danger-soft text-[10px] text-danger">
                    <TriangleAlert className="size-3" aria-hidden /> Biggest leak
                  </span>
                )}
              </span>
              <span className="col-span-2 row-start-2 flex min-w-0 items-center gap-2 sm:col-span-1 sm:row-start-auto">
                <span className="h-3 min-w-0 flex-1 rounded-r-[4px] bg-raised">
                  <span className="block h-3 rounded-r-[4px] bg-tone" style={{ width: `${Math.max(s.count > 0 ? 1.5 : 0, (s.count / max) * 100)}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right text-sm font-semibold">
                  <DrillNumber metric={`funnel.${s.key}`}>{num(s.count)}</DrillNumber>
                </span>
              </span>
              <span className="col-start-2 row-start-1 text-right text-xs sm:col-start-auto sm:row-start-auto">
                {s.conversion == null ? (
                  <span className="text-faint">{s.key === "discovered" ? "Start" : "—"}</span>
                ) : (
                  <>
                    <span className="font-medium tabular-nums">{pct(s.conversion)}</span>
                    <span className="block text-faint">
                      {s.previousConversion == null ? "no previous" : `prev ${pct(s.previousConversion)}`}
                      {change != null && change !== 0 && <span className={change < 0 ? "text-danger" : "text-brand"}>{` (${change > 0 ? "+" : "−"}${Math.abs(change)} pts)`}</span>}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── Pipeline ────────────────────────────────────────────────────────────────────────────────────

export function PipelineTab() {
  const { filters, currency } = useAnalytics();
  return (
    <Loaded<PipelineAnalytics> path={withFilters("/analytics/pipeline", filters)}>
      {(p) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="card p-3.5">
              <MetricLabel metric="salesCycleDays" className="text-xs text-muted" />
              <div className="mt-1 text-xl font-semibold">
                <DrillNumber metric="salesCycleDays">{p.salesCycleDays == null ? "—" : `${Number(p.salesCycleDays.toFixed(1))} days`}</DrillNumber>
              </div>
              <div className="text-[11px] text-faint">Median, creation → won</div>
            </div>
            <div className="card p-3.5">
              <MetricLabel metric="winRate" className="text-xs text-muted" />
              <div className="mt-1 text-xl font-semibold">
                <DrillNumber metric="winRate">{pct(p.winRate)}</DrillNumber>
              </div>
              <div className="text-[11px] text-faint">Closed deals only</div>
            </div>
            <div className="card p-3.5">
              <div className="text-xs text-muted">Open deals</div>
              <div className="mt-1 text-xl font-semibold">
                <DrillNumber metric="openPipeline">{num(p.stages.reduce((a, s) => a + s.open, 0))}</DrillNumber>
              </div>
              <div className="text-[11px] text-faint">{money(p.stages.reduce((a, s) => a + s.valueMinor, 0), currency, true)} estimated</div>
            </div>
            <div className="card p-3.5">
              <div className="text-xs text-muted">Aging deals</div>
              <div className={`mt-1 text-xl font-semibold ${p.aging.length ? "text-amber" : ""}`}>{num(p.stages.reduce((a, s) => a + s.aging, 0))}</div>
              <div className="text-[11px] text-faint">Older than their stage baseline</div>
            </div>
          </div>

          <section>
            <SectionTitle hint="Median age against the stage’s own baseline — a stage that is slower than usual shows here.">Stages</SectionTitle>
            {p.stages.length === 0 ? (
              <Empty text="No open deals." />
            ) : (
              <TableCard caption="Pipeline by stage">
                <thead>
                  <tr>
                    <Th>Stage</Th>
                    <Th right>Open</Th>
                    <Th right>Value</Th>
                    <Th right>Median age</Th>
                    <Th right>Baseline</Th>
                    <Th right>Aging</Th>
                  </tr>
                </thead>
                <tbody>
                  {p.stages.map((s) => {
                    const slow = s.medianAgeDays != null && s.baselineDays != null && s.medianAgeDays > s.baselineDays;
                    return (
                      <tr key={s.semantic}>
                        <Td className="font-medium">{s.label}</Td>
                        <Td right>
                          <DrillNumber metric="openPipeline" filters={{ stage: s.semantic }}>
                            {num(s.open)}
                          </DrillNumber>
                        </Td>
                        <Td right>{money(s.valueMinor, currency, true)}</Td>
                        <Td right className={slow ? "font-semibold text-amber" : ""}>
                          {s.medianAgeDays == null ? "—" : `${Number(s.medianAgeDays.toFixed(1))} d`}
                        </Td>
                        <Td right className="text-muted">
                          {s.baselineDays == null ? "—" : `${Number(s.baselineDays.toFixed(1))} d`}
                        </Td>
                        <Td right className={s.aging ? "text-amber" : "text-muted"}>
                          {num(s.aging)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableCard>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card min-w-0 p-4">
              <SectionTitle hint="Deals lost in the period, by recorded reason.">Lost reasons</SectionTitle>
              <HBars label="Lost reasons" rows={p.lostReasons.map((r) => ({ key: r.reason, label: r.label, value: r.count, sub: r.valueMinor ? money(r.valueMinor, currency, true) : undefined }))} />
            </section>
            <section className="card min-w-0 p-4">
              <SectionTitle hint="Objections raised in conversations and meetings.">Objections</SectionTitle>
              <HBars label="Objections" rows={p.objections.map((r) => ({ key: r.type, label: r.label, value: r.count }))} />
            </section>
          </div>

          <section className="card p-4">
            <SectionTitle hint="Open deals older than their stage baseline — oldest first.">Aging deals</SectionTitle>
            {p.aging.length === 0 ? <p className="text-sm text-muted">No deal is older than its stage baseline.</p> : <RecordList records={p.aging} />}
          </section>
        </div>
      )}
    </Loaded>
  );
}
