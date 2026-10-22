"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { AiContribution, CampaignAnalyticsRow, ConversationAnalytics, CostAnalytics, DataQuality, MarketEconomicsRow, SourceQualityRow } from "@revenue-os/shared";
import { money, num, pct, shortDate, withFilters } from "@/lib/analytics";
import { Columns, DrillNumber, Empty, HBars, Loaded, MetricLabel, SectionTitle, TableCard, Td, Th, useAnalytics } from "./parts";

function Stat({ label, value, hint, metric, warn }: { label: ReactNode; value: ReactNode; hint?: ReactNode; metric?: string; warn?: boolean }) {
  return (
    <div className="card min-w-0 p-3.5">
      <div className="text-xs text-muted">{typeof label === "string" && metric ? <MetricLabel metric={metric} label={label} /> : label}</div>
      <div className={`mt-1 text-xl font-semibold ${warn ? "text-amber" : ""}`}>{metric ? <DrillNumber metric={metric}>{value}</DrillNumber> : value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

// ── Outreach ────────────────────────────────────────────────────────────────────────────────────

export function OutreachTab() {
  const { filters, currency } = useAnalytics();
  return (
    <div className="space-y-6">
      <Loaded<CampaignAnalyticsRow[]> path={withFilters("/analytics/campaigns", filters)}>
        {(rows) => (
          <>
            <section>
              <SectionTitle hint="Outcomes per campaign — replies and meetings matter more than sends.">Campaigns</SectionTitle>
              {rows.length === 0 ? (
                <Empty text="No campaign activity in this period." />
              ) : (
                <TableCard caption="Campaign performance">
                  <thead>
                    <tr>
                      <Th>Campaign</Th>
                      <Th right>Sent</Th>
                      <Th right>Replies</Th>
                      <Th right>Reply rate</Th>
                      <Th right>Positive</Th>
                      <Th right>Meetings</Th>
                      <Th right>Opps</Th>
                      <Th right>Won revenue</Th>
                      <Th right>Unsubs</Th>
                      <Th right>Bounces</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.campaignId}>
                        <Td className="max-w-[14rem]">
                          <Link href={`/campaigns/${c.campaignId}`} className="block truncate font-medium hover:text-tone">
                            {c.name}
                          </Link>
                          <span className="text-xs text-faint">
                            {c.status.toLowerCase()} · {num(c.enrolled)} enrolled
                          </span>
                        </Td>
                        <Td right>{num(c.sent)}</Td>
                        <Td right>
                          <DrillNumber metric="replies" filters={{ campaignId: c.campaignId }}>
                            {num(c.replies)}
                          </DrillNumber>
                        </Td>
                        <Td right>
                          {pct(c.replyRate)}
                          {c.contacted > 0 && c.contacted < 10 && <span className="block text-[10px] text-faint">low sample</span>}
                        </Td>
                        <Td right>{num(c.positive)}</Td>
                        <Td right>
                          <DrillNumber metric="meetingsBooked" filters={{ campaignId: c.campaignId }}>
                            {num(c.meetings)}
                          </DrillNumber>
                        </Td>
                        <Td right>{num(c.opportunities)}</Td>
                        <Td right className="font-semibold">
                          {money(c.revenueMinor, currency, true)}
                        </Td>
                        <Td right className={c.unsubscribes ? "text-amber" : "text-muted"}>
                          {num(c.unsubscribes)}
                        </Td>
                        <Td right className={c.bounces ? "text-danger" : "text-muted"}>
                          {num(c.bounces)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableCard>
              )}
            </section>

            {rows.some((c) => c.steps.length > 0) && (
              <section>
                <SectionTitle hint="Replies by sequence step — where follow-ups still earn replies and where the sequence drops off.">Follow-up intelligence</SectionTitle>
                <div className="grid gap-3 md:grid-cols-2">
                  {rows
                    .filter((c) => c.steps.length > 0)
                    .map((c) => (
                      <div key={c.campaignId} className="card min-w-0 p-4">
                        <div className="mb-2 truncate text-sm font-semibold">{c.name}</div>
                        <HBars
                          label={`Replies by step for ${c.name}`}
                          rows={[...c.steps]
                            .sort((a, b) => a.position - b.position)
                            .map((s) => ({ key: String(s.position), label: s.position === 1 ? "Step 1 (first touch)" : `Step ${s.position} (follow-up)`, value: s.replies, sub: s.sent ? `${pct(share(s.replies, s.sent))} of ${num(s.sent)}` : "not sent" }))}
                        />
                      </div>
                    ))}
                </div>
              </section>
            )}
          </>
        )}
      </Loaded>

      <Loaded<ConversationAnalytics> path={withFilters("/analytics/conversations", filters)}>
        {(c) => (
          <section className="space-y-4">
            <SectionTitle hint="What prospects say, how fast we answer and where knowledge is missing.">Conversations</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Conversations" value={num(c.total)} metric="replies" />
              <Stat label="Median first response" value={c.medianFirstResponseHours == null ? "—" : `${Number(c.medianFirstResponseHours.toFixed(1))} h`} hint="Prospect reply → our first answer" />
              <Stat label="Needed a human" value={pct(c.needsHumanShare)} hint="Share of conversations escalated" />
              <Stat label="Open knowledge gaps" value={num(c.knowledgeGaps.filter((g) => g.status !== "RESOLVED").length)} warn={c.knowledgeGaps.length > 0} hint="Questions without approved answers" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card min-w-0 p-4">
                <SectionTitle>Reply intents</SectionTitle>
                <HBars label="Reply intents" rows={c.byIntent.map((i) => ({ key: i.intent, label: i.label, value: i.count }))} />
              </div>
              <div className="card min-w-0 p-4">
                <SectionTitle>Top questions</SectionTitle>
                <HBars label="Top questions" rows={c.questions.map((q) => ({ key: q.topic, label: q.topic, value: q.count }))} />
              </div>
              <div className="card min-w-0 p-4">
                <SectionTitle hint="Questions the knowledge base could not answer.">Knowledge gaps</SectionTitle>
                {c.knowledgeGaps.length === 0 ? (
                  <p className="text-xs text-muted">No knowledge gaps in this period.</p>
                ) : (
                  <ul className="divide-y divide-line text-sm">
                    {c.knowledgeGaps.map((g, i) => (
                      <li key={i} className="flex items-start justify-between gap-2 py-2">
                        <span className="min-w-0 break-words">{g.question}</span>
                        <span className="shrink-0 text-xs text-faint">
                          {g.occurrences}× · {g.status.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link href="/knowledge" className="mt-2 inline-block text-xs text-tone hover:underline">
                  Open Knowledge
                </Link>
              </div>
              <div className="card min-w-0 p-4">
                <SectionTitle>AI vs human replies</SectionTitle>
                {c.repliesByAuthor.length === 0 ? (
                  <p className="text-xs text-muted">No replies drafted in this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <Th>Author</Th>
                          <Th right>Drafted</Th>
                          <Th right>Sent</Th>
                          <Th right>Rejected</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.repliesByAuthor.map((r) => (
                          <tr key={r.author}>
                            <Td className="font-medium">{r.author === "AI" ? "AI" : "Human"}</Td>
                            <Td right>{num(r.drafted)}</Td>
                            <Td right>{num(r.sent)}</Td>
                            <Td right>{num(r.rejected)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </Loaded>
    </div>
  );
}

// ── Markets & sources ───────────────────────────────────────────────────────────────────────────

export function MarketsTab({ canCosts }: { canCosts: boolean }) {
  const { filters, currency } = useAnalytics();
  return (
    <div className="space-y-6">
      <Loaded<MarketEconomicsRow[]> path={withFilters("/analytics/markets", filters)}>
        {(rows) => (
          <section>
            <SectionTitle hint="From companies found to revenue, per market. Unknown cost stays unknown.">Market economics</SectionTitle>
            {rows.length === 0 ? (
              <Empty text="No market activity in this period." />
            ) : (
              <TableCard caption="Market economics">
                <thead>
                  <tr>
                    <Th>Market</Th>
                    <Th right>Companies</Th>
                    <Th right>Contactable</Th>
                    <Th right>Contacted</Th>
                    <Th right>Replies</Th>
                    <Th right>Positive</Th>
                    <Th right>Meetings</Th>
                    <Th right>Opps</Th>
                    <Th right>Won</Th>
                    <Th right>Revenue</Th>
                    {canCosts && <Th right>Cost</Th>}
                    {canCosts && <Th right>Cost / meeting</Th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.marketId}>
                      <Td className="max-w-[12rem]">
                        <span className="block truncate font-medium">{m.name}</span>
                      </Td>
                      <Td right>{num(m.companies)}</Td>
                      <Td right>
                        {num(m.contactable)}
                        {m.companies > 0 && <span className="block text-[10px] text-faint">{pct(share(m.contactable, m.companies), 0)}</span>}
                      </Td>
                      <Td right>{num(m.contacted)}</Td>
                      <Td right>{num(m.replies)}</Td>
                      <Td right>{num(m.positive)}</Td>
                      <Td right>
                        <DrillNumber metric="meetingsBooked" filters={{ marketId: m.marketId }}>
                          {num(m.meetings)}
                        </DrillNumber>
                      </Td>
                      <Td right>{num(m.opportunities)}</Td>
                      <Td right>
                        <DrillNumber metric="wonDeals" filters={{ marketId: m.marketId }}>
                          {num(m.won)}
                        </DrillNumber>
                      </Td>
                      <Td right className="font-semibold">
                        {money(m.revenueMinor, currency, true)}
                      </Td>
                      {canCosts && (
                        <Td right>
                          {money(m.costMinor, currency, true)}
                          {m.costUnknownCalls > 0 && <span className="block text-[10px] text-amber">{num(m.costUnknownCalls)} calls with unknown cost</span>}
                        </Td>
                      )}
                      {canCosts && <Td right>{money(m.costPerMeetingMinor, currency, true)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </section>
        )}
      </Loaded>

      <Loaded<{ providers: SourceQualityRow[]; quality: DataQuality }> path={withFilters("/analytics/sources", filters)}>
        {({ providers, quality }) => (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-w-0">
              <SectionTitle hint="Which data providers find companies that become contactable, contacted and won.">Source quality</SectionTitle>
              {providers.length === 0 ? (
                <Empty text="No provider data in this period." />
              ) : (
                <TableCard caption="Source and provider quality">
                  <thead>
                    <tr>
                      <Th>Provider</Th>
                      <Th right>Observations</Th>
                      <Th right>Companies</Th>
                      <Th right>Duplicates</Th>
                      <Th right>Website</Th>
                      <Th right>Verified email</Th>
                      <Th right>Contacted</Th>
                      <Th right>Meetings</Th>
                      <Th right>Won</Th>
                      {canCosts && <Th right>Cost</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {providers.map((p) => (
                      <tr key={p.provider}>
                        <Td className="font-medium whitespace-nowrap">{p.label}</Td>
                        <Td right>{num(p.observations)}</Td>
                        <Td right>{num(p.companies)}</Td>
                        <Td right className="text-muted">
                          {num(p.duplicatesMatched)}
                        </Td>
                        <Td right>
                          {num(p.withWebsite)}
                          {p.companies > 0 && <span className="block text-[10px] text-faint">{pct(share(p.withWebsite, p.companies), 0)}</span>}
                        </Td>
                        <Td right>
                          {num(p.verifiedEmails)}
                          {p.companies > 0 && <span className="block text-[10px] text-faint">{pct(share(p.verifiedEmails, p.companies), 0)}</span>}
                        </Td>
                        <Td right>{num(p.contacted)}</Td>
                        <Td right>{num(p.meetings)}</Td>
                        <Td right>{num(p.won)}</Td>
                        {canCosts && <Td right>{money(p.costMinor, currency, true)}</Td>}
                      </tr>
                    ))}
                  </tbody>
                </TableCard>
              )}
            </section>
            <DataQualityPanel q={quality} />
          </div>
        )}
      </Loaded>
    </div>
  );
}

function Meter({ label, part, whole, bad }: { label: string; part: number; whole: number; bad?: boolean }) {
  const s = share(part, whole);
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">
          {num(part)} <span className="font-normal text-faint">{s == null ? "" : `· ${pct(s, 0)}`}</span>
        </span>
      </div>
      <div className={`mt-1 h-1.5 rounded-full ${bad ? "bg-amber-soft" : "bg-tone-soft"}`}>
        <div className={`h-1.5 rounded-full ${bad ? "bg-amber" : "bg-tone"}`} style={{ width: `${Math.min(100, s ?? 0)}%` }} />
      </div>
    </li>
  );
}

function DataQualityPanel({ q }: { q: DataQuality }) {
  return (
    <section className="card min-w-0 p-4">
      <SectionTitle hint={`${num(q.companies)} companies in scope`}>Data quality</SectionTitle>
      <ul className="space-y-3">
        <Meter label="With a website" part={q.withWebsite} whole={q.companies} />
        <Meter label="Researched" part={q.researched} whole={q.companies} />
        <Meter label="With a verified contact" part={q.withVerifiedContact} whole={q.companies} />
        <Meter label="Research is stale" part={q.staleResearch} whole={q.companies} bad />
      </ul>
      <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-xs text-faint">Open duplicates</dt>
          <dd className={`font-semibold tabular-nums ${q.openDuplicates ? "text-amber" : ""}`}>{num(q.openDuplicates)}</dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Invalid emails</dt>
          <dd className={`font-semibold tabular-nums ${q.invalidEmails ? "text-amber" : ""}`}>{num(q.invalidEmails)}</dd>
        </div>
      </dl>
    </section>
  );
}

// ── Costs ───────────────────────────────────────────────────────────────────────────────────────

export function CostsTab() {
  const { filters, currency } = useAnalytics();
  return (
    <Loaded<CostAnalytics> path={withFilters("/analytics/costs", filters)}>
      {(c) => (
        <div className="space-y-6">
          {c.unknownCostCalls > 0 && (
            <p className="card border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
              {num(c.unknownCostCalls)} call{c.unknownCostCalls === 1 ? "" : "s"} had no reported cost. They are counted as unknown, not as zero — real spend is higher than the total shown.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total cost" value={money(c.totalMinor, currency)} hint={c.totalMinor == null ? "Unknown — some costs not reported" : c.estimatedShare ? `${pct(c.estimatedShare, 0)} estimated` : "Recorded"} />
            <Stat label="Provider cost" metric="providerCost" value={money(c.providerMinor, currency)} />
            <Stat label="AI cost" metric="aiCost" value={money(c.aiMinor, currency)} />
            <Stat label="Unknown-cost calls" value={num(c.unknownCostCalls)} warn={c.unknownCostCalls > 0} />
            <Stat label="Cost per meeting" metric="costPerMeeting" value={money(c.perMeetingMinor, currency)} hint={c.perMeetingMinor == null ? "Needs known cost and ≥1 meeting" : undefined} />
            <Stat label="Cost per won deal" value={money(c.perWonDealMinor, currency)} hint={c.perWonDealMinor == null ? "Needs known cost and ≥1 won deal" : undefined} />
          </div>

          <section className="card min-w-0 p-4">
            <SectionTitle>Daily cost</SectionTitle>
            <Columns
              label="Daily provider and AI cost"
              data={c.daily.map((d) => ({ x: d.day, xLabel: shortDate(d.day), values: { provider: d.providerMinor, ai: d.aiMinor } }))}
              series={[
                { key: "provider", label: "Provider", color: "var(--color-accent)" },
                { key: "ai", label: "AI", color: "var(--color-amber)" },
              ]}
              format={(n) => money(n, currency)}
            />
          </section>

          <section>
            <SectionTitle>By provider and capability</SectionTitle>
            {c.byProvider.length === 0 ? (
              <Empty text="No provider calls in this period." />
            ) : (
              <TableCard caption="Cost by provider">
                <thead>
                  <tr>
                    <Th>Provider</Th>
                    <Th>Capability</Th>
                    <Th right>Calls</Th>
                    <Th right>Cost</Th>
                    <Th right>Unknown cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.byProvider.map((p) => (
                    <tr key={`${p.provider}-${p.capability}`}>
                      <Td className="font-medium">{p.provider}</Td>
                      <Td className="text-muted">{p.capability}</Td>
                      <Td right>{num(p.calls)}</Td>
                      <Td right>{money(p.costMinor, currency)}</Td>
                      <Td right className={p.unknown ? "text-amber" : "text-muted"}>
                        {num(p.unknown)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="min-w-0">
              <SectionTitle>By agent</SectionTitle>
              {c.byAgent.length === 0 ? (
                <Empty text="No AI runs in this period." />
              ) : (
                <TableCard caption="Cost by agent">
                  <thead>
                    <tr>
                      <Th>Agent</Th>
                      <Th right>Runs</Th>
                      <Th right>Cost</Th>
                      <Th right>Unknown</Th>
                      <Th right>Failed</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.byAgent.map((a) => (
                      <tr key={a.agent}>
                        <Td className="font-medium">{a.agent}</Td>
                        <Td right>{num(a.runs)}</Td>
                        <Td right>{money(a.costMinor, currency)}</Td>
                        <Td right className={a.unknown ? "text-amber" : "text-muted"}>
                          {num(a.unknown)}
                        </Td>
                        <Td right className={a.failed ? "text-danger" : "text-muted"}>
                          {num(a.failed)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableCard>
              )}
            </section>
            <section className="card min-w-0 p-4">
              <SectionTitle>By market</SectionTitle>
              <HBars label="Cost by market" rows={c.byMarket.map((m) => ({ key: m.marketId, label: m.name, value: m.costMinor, display: money(m.costMinor, currency) }))} />
            </section>
          </div>
        </div>
      )}
    </Loaded>
  );
}

// ── AI vs human ─────────────────────────────────────────────────────────────────────────────────

export function AiTab() {
  const { filters } = useAnalytics();
  return (
    <Loaded<AiContribution> path={withFilters("/analytics/ai", filters)}>
      {(a) => (
        <div className="space-y-6">
          <section>
            <SectionTitle hint="What the AI did, what people changed, and where people stepped in.">Contribution</SectionTitle>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Replies sent by AI" value={num(a.repliesSentByAi)} />
              <Stat label="Replies sent by people" value={num(a.repliesSentByHuman)} />
              <Stat label="AI drafts edited by a person" value={num(a.draftsEditedByHuman)} />
              <Stat label="AI drafts rejected" value={num(a.draftsRejected)} />
              <Stat label="Human takeovers" value={num(a.takeovers)} />
              <Stat label="Escalations" value={num(a.escalations)} />
              <Stat label="Meetings after an AI reply" value={num(a.meetingsBookedAfterAiReply)} />
            </div>
          </section>

          <section>
            <SectionTitle>Agent runs</SectionTitle>
            {a.agentRuns.length === 0 ? (
              <Empty text="No agent runs in this period." />
            ) : (
              <TableCard caption="Agent runs">
                <thead>
                  <tr>
                    <Th>Agent</Th>
                    <Th right>Runs</Th>
                    <Th right>Succeeded</Th>
                    <Th right>Failed</Th>
                    <Th right>Blocked</Th>
                    <Th right>Success rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.agentRuns.map((r) => (
                    <tr key={r.agent}>
                      <Td className="font-medium">{r.label}</Td>
                      <Td right>{num(r.runs)}</Td>
                      <Td right>{num(r.succeeded)}</Td>
                      <Td right className={r.failed ? "text-danger" : "text-muted"}>
                        {num(r.failed)}
                      </Td>
                      <Td right className={r.blocked ? "text-amber" : "text-muted"}>
                        {num(r.blocked)}
                      </Td>
                      <Td right>{pct(share(r.succeeded, r.runs), 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableCard>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card min-w-0 p-4">
              <SectionTitle hint="AI output stopped by a deterministic validator before it reached anyone.">Validator blocks</SectionTitle>
              <HBars label="Validator blocks" rows={a.validatorBlocks.map((v) => ({ key: v.validator, label: v.validator, value: v.count }))} />
            </section>
            <section className="card min-w-0 p-4">
              <SectionTitle hint="Does stated confidence match what later turned out to be true?">Confidence calibration</SectionTitle>
              {a.calibration.length === 0 ? (
                <p className="text-xs text-muted">No AI decisions in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <Th>Confidence</Th>
                        <Th right>Decisions</Th>
                        <Th right>Later confirmed</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.calibration.map((r) => (
                        <tr key={r.confidence}>
                          <Td className="font-medium">{r.confidence.toLowerCase()}</Td>
                          <Td right>{num(r.decisions)}</Td>
                          <Td right>{r.laterConfirmed == null ? <span className="text-xs text-faint">Not enough outcome data yet</span> : `${num(r.laterConfirmed)} (${pct(share(r.laterConfirmed, r.decisions), 0)})`}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </Loaded>
  );
}
