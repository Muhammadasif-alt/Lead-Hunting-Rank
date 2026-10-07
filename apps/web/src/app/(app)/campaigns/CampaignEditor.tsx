"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleAlert, Loader, Plus, Trash2, Users } from "lucide-react";
import { api, errorMessage, patch, post } from "@/lib/api";
import {
  ANGLE_LABEL,
  OBJECTIVE_LABEL,
  OPPORTUNITY_KEYS,
  type AudienceFilter,
  type AudiencePreview,
  type Campaign,
  type CampaignDetail,
  type FollowUpAngle,
  type Objective,
} from "@/lib/campaigns";
import type { MarketRow } from "@/lib/discovery";

interface Mailbox {
  id: string;
  name: string;
  provider: string;
  status: string;
  capabilities: string[];
}

interface FormState {
  name: string;
  objective: Objective;
  offer: string;
  cta: string;
  tone: string;
  avoid: string;
  audience: AudienceFilter;
  industries: string;
  mailboxIntegrationId: string;
  senderName: string;
  cohortSize: number;
  dailyNewLimit: number;
  followUps: { delayDays: number; angle: FollowUpAngle }[];
}

const DEFAULT: FormState = {
  name: "",
  objective: "START_CONVERSATIONS",
  offer: "",
  cta: "",
  tone: "",
  avoid: "",
  audience: {},
  industries: "",
  mailboxIntegrationId: "",
  senderName: "",
  cohortSize: 25,
  dailyNewLimit: 20,
  followUps: [
    { delayDays: 3, angle: "CLARIFY_VALUE" },
    { delayDays: 4, angle: "CLOSE_THE_LOOP" },
  ],
};

function fromCampaign(d: CampaignDetail): FormState {
  const c: Campaign = d.campaign;
  return {
    name: c.name,
    objective: c.objective,
    offer: c.offer,
    cta: c.strategy.cta ?? "",
    tone: c.strategy.tone ?? "",
    avoid: (c.strategy.avoid ?? []).join("\n"),
    audience: c.audience,
    industries: (c.audience.industries ?? []).join(", "),
    mailboxIntegrationId: c.mailboxIntegrationId ?? "",
    senderName: c.senderName,
    cohortSize: c.cohortSize,
    dailyNewLimit: c.dailyNewLimit,
    followUps: d.steps
      .filter((s) => s.kind === "FOLLOW_UP")
      .map((s) => ({ delayDays: s.delayDays, angle: s.angle as FollowUpAngle })),
  };
}

function toBody(f: FormState) {
  const industries = f.industries
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const audience: AudienceFilter = {
    marketId: f.audience.marketId || null,
    industries: industries.length ? industries : undefined,
    opportunityKeys: f.audience.opportunityKeys?.length ? f.audience.opportunityKeys : undefined,
    priorities: f.audience.priorities?.length ? f.audience.priorities : undefined,
  };
  return {
    name: f.name.trim(),
    objective: f.objective,
    offer: f.offer.trim(),
    strategy: {
      cta: f.cta.trim() || undefined,
      tone: f.tone.trim() || undefined,
      avoid: f.avoid
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 10),
    },
    audience,
    mailboxIntegrationId: f.mailboxIntegrationId || null,
    senderName: f.senderName.trim(),
    cohortSize: f.cohortSize,
    dailyNewLimit: f.dailyNewLimit,
    followUps: f.followUps,
  };
}

/**
 * Campaign setup (screen #6 §2-12): objective, offer, audience with a live count of who can actually be contacted,
 * mailbox and limits, and the follow-up sequence. Saving keeps it a draft — launching is a separate, checked step.
 */
export function CampaignEditor({ detail, onSaved }: { detail?: CampaignDetail; onSaved?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState<FormState>(detail ? fromCampaign(detail) : DEFAULT);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    api<{ items: MarketRow[] }>("/markets")
      .then((r) => setMarkets(r.items))
      .catch(() => undefined);
    api<Mailbox[]>("/integrations")
      .then((rows) => {
        const usable = rows.filter((m) => m.capabilities.includes("EMAIL_SEND") && m.status !== "DISCONNECTED");
        setMailboxes(usable);
        if (!detail && usable.length === 1)
          setF((prev) => ({ ...prev, mailboxIntegrationId: prev.mailboxIntegrationId || usable[0]!.id }));
      })
      .catch(() => undefined);
  }, [detail]);

  // Live audience: who the filter reaches and why others are left out.
  const audienceKey = JSON.stringify(toBody(f).audience);
  useEffect(() => {
    const t = window.setTimeout(() => {
      post<AudiencePreview>("/campaigns/audience-preview", JSON.parse(audienceKey))
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 400);
    return () => window.clearTimeout(t);
  }, [audienceKey]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (detail) {
        await patch(`/campaigns/${detail.campaign.id}`, toBody(f));
        onSaved?.();
      } else {
        const c = await post<Campaign>("/campaigns", toBody(f));
        router.push(`/campaigns/${c.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (list: string[] | undefined, value: string) =>
    list?.includes(value) ? list.filter((x) => x !== value) : [...(list ?? []), value];
  const mailbox = mailboxes.find((m) => m.id === f.mailboxIntegrationId);

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Goal and offer</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Name</span>
            <input
              className="input mt-1 w-full"
              value={f.name}
              maxLength={120}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Austin plumbers — online booking"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Objective</span>
            <select
              className="input mt-1 w-full"
              value={f.objective}
              onChange={(e) => set("objective", e.target.value as Objective)}
            >
              {(Object.keys(OBJECTIVE_LABEL) as Objective[]).map((o) => (
                <option key={o} value={o}>
                  {OBJECTIVE_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-medium">What you offer</span>
          <span className="block text-muted">
            A short phrase — the AI only uses what you write here, e.g. “websites with online booking for local service
            businesses”.
          </span>
          <input
            className="input mt-1 w-full"
            value={f.offer}
            maxLength={300}
            onChange={(e) => set("offer", e.target.value)}
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Question to end with (optional)</span>
            <input
              className="input mt-1 w-full"
              value={f.cta}
              maxLength={200}
              onChange={(e) => set("cta", e.target.value)}
              placeholder="Would a 15-minute call next week be useful?"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Tone (optional)</span>
            <input
              className="input mt-1 w-full"
              value={f.tone}
              maxLength={200}
              onChange={(e) => set("tone", e.target.value)}
              placeholder="Friendly, plain, no jargon"
            />
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-medium">Never say (optional, one per line)</span>
          <textarea
            className="input mt-1 h-20 w-full py-2"
            value={f.avoid}
            onChange={(e) => set("avoid", e.target.value)}
            placeholder="Competitor names"
          />
          <span className="text-xs text-faint">
            Always enforced anyway: no links, no prices, no fake compliments or urgency, one question, at most 90 words.
          </span>
        </label>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Who</h2>
          <span className="text-xs text-faint">
            Only people with a verified email, not on the do-not-contact list, not in another campaign, not emailed in
            the last 30 days.
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Market (from Lead Hunter)</span>
            <select
              className="input mt-1 w-full"
              value={f.audience.marketId ?? ""}
              onChange={(e) => set("audience", { ...f.audience, marketId: e.target.value || null })}
            >
              <option value="">Any market</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium">Industry contains (comma-separated)</span>
            <input
              className="input mt-1 w-full"
              value={f.industries}
              onChange={(e) => set("industries", e.target.value)}
              placeholder="plumb, landscap"
            />
          </label>
        </div>
        <div className="text-sm">
          <div className="font-medium">Opportunity found by research (any of)</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {OPPORTUNITY_KEYS.map((o) => {
              const on = f.audience.opportunityKeys?.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={on}
                  className={`badge cursor-pointer ${on ? "border-tone/30 bg-tone-soft text-tone" : ""}`}
                  onClick={() =>
                    set("audience", { ...f.audience, opportunityKeys: toggle(f.audience.opportunityKeys, o.key) })
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="text-sm">
          <div className="font-medium">AI priority</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(["HIGH", "MEDIUM", "LOW"] as const).map((p) => {
              const on = f.audience.priorities?.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  className={`badge cursor-pointer ${on ? "border-tone/30 bg-tone-soft text-tone" : ""}`}
                  onClick={() =>
                    set("audience", {
                      ...f.audience,
                      priorities: toggle(f.audience.priorities, p) as ("HIGH" | "MEDIUM" | "LOW")[],
                    })
                  }
                >
                  {p.toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-raised p-4 text-sm">
          {!preview ? (
            <span className="inline-flex items-center gap-2 text-muted">
              <Loader className="size-4 animate-spin" /> Counting…
            </span>
          ) : (
            <>
              <div className="flex items-center gap-2 font-medium">
                <Users className="size-4 text-tone" /> {preview.eligible} can be contacted
                <span className="font-normal text-muted">of {preview.matched} matching companies</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                Left out: {preview.excluded.noVerifiedEmail} no verified email · {preview.excluded.suppressed}{" "}
                do-not-contact · {preview.excluded.inOtherCampaign} in another campaign ·{" "}
                {preview.excluded.recentlyContacted} emailed recently
              </div>
              {preview.sample.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {preview.sample.slice(0, 5).map((s) => (
                    <li key={s.companyId} className="truncate">
                      <span className="font-medium">{s.companyName}</span> — {s.name}
                      {s.title ? `, ${s.title}` : ""} <span className="text-faint">({s.email})</span>
                    </li>
                  ))}
                </ul>
              )}
              {preview.eligible === 0 && (
                <p className="mt-2 text-xs text-muted">
                  Nobody yet? Research companies first (Companies → Research) so verified contacts exist, or widen the
                  filter.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Sending</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium">Mailbox</span>
            <select
              className="input mt-1 w-full"
              value={f.mailboxIntegrationId}
              onChange={(e) => set("mailboxIntegrationId", e.target.value)}
            >
              <option value="">Pick a mailbox</option>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.provider === "fake_email" ? " (test mailbox — nothing really sent)" : ""}
                </option>
              ))}
            </select>
            {mailboxes.length === 0 && (
              <span className="mt-1 block text-xs text-muted">
                No mailbox yet —{" "}
                <Link href="/integrations" className="text-accent hover:underline">
                  connect Gmail or the test mailbox
                </Link>
                .
              </span>
            )}
            {mailbox && !mailbox.capabilities.includes("EMAIL_READ") && (
              <span className="mt-1 block text-xs text-danger">
                This mailbox can’t read — replies couldn’t stop follow-ups.
              </span>
            )}
          </label>
          <label className="block text-sm">
            <span className="font-medium">Sender name</span>
            <input
              className="input mt-1 w-full"
              value={f.senderName}
              maxLength={100}
              onChange={(e) => set("senderName", e.target.value)}
              placeholder="Sam Taylor"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">First cohort (prospects)</span>
            <span className="block text-xs text-muted">Start small, learn, then add more.</span>
            <input
              type="number"
              min={1}
              max={500}
              className="input mt-1 w-32"
              value={f.cohortSize}
              onChange={(e) => set("cohortSize", Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">New emails per day</span>
            <span className="block text-xs text-muted">
              Follow-ups aren’t counted; the workspace daily limit still applies.
            </span>
            <input
              type="number"
              min={1}
              max={200}
              className="input mt-1 w-32"
              value={f.dailyNewLimit}
              onChange={(e) =>
                set("dailyNewLimit", Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))))
              }
            />
          </label>
        </div>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Sequence</h2>
        <p className="text-sm text-muted">
          Before every follow-up the prospect is checked again: a reply, an unsubscribe, a bounce or a paused campaign
          stops it.
        </p>
        <ol className="space-y-2 text-sm">
          <li className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
            <span className="badge">1</span> First email <span className="text-faint">— day 0</span>
          </li>
          {f.followUps.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
              <span className="badge">{i + 2}</span>
              <label className="flex items-center gap-2">
                Wait
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="input h-8 w-20"
                  value={s.delayDays}
                  onChange={(e) =>
                    set(
                      "followUps",
                      f.followUps.map((x, j) =>
                        j === i
                          ? { ...x, delayDays: Math.max(1, Math.min(30, Math.floor(Number(e.target.value) || 1))) }
                          : x,
                      ),
                    )
                  }
                />
                days, then
              </label>
              <select
                className="input h-8"
                value={s.angle}
                onChange={(e) =>
                  set(
                    "followUps",
                    f.followUps.map((x, j) => (j === i ? { ...x, angle: e.target.value as FollowUpAngle } : x)),
                  )
                }
              >
                {(["CLARIFY_VALUE", "NEW_OBSERVATION", "CLOSE_THE_LOOP"] as FollowUpAngle[]).map((a) => (
                  <option key={a} value={a}>
                    {ANGLE_LABEL[a]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost ml-auto h-8 px-2"
                aria-label="Remove follow-up"
                onClick={() =>
                  set(
                    "followUps",
                    f.followUps.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        {f.followUps.length < 3 && (
          <button
            type="button"
            className="btn btn-secondary h-8"
            onClick={() => set("followUps", [...f.followUps, { delayDays: 4, angle: "NEW_OBSERVATION" }])}
          >
            <Plus className="size-4" /> Add follow-up
          </button>
        )}
      </section>

      {error && (
        <div className="card flex items-center gap-2 border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          <CircleAlert className="size-4 shrink-0" /> {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={() => void save()}>
          {busy && <Loader className="size-4 animate-spin" />} {detail ? "Save changes" : "Save draft"}
        </button>
        {!detail && (
          <Link href="/campaigns" className="btn btn-ghost">
            Cancel
          </Link>
        )}
        <span className="self-center text-xs text-faint">
          Saving never sends anything. Launching is a separate step after the checks pass.
        </span>
      </div>
    </div>
  );
}
