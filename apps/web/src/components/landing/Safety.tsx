import { Ban, Hand, Hourglass, OctagonX, Play, Power, ScrollText, ShieldCheck } from "lucide-react";
import { MediaSplit } from "@/components/ui/MediaSplit";
import SectionHeader from "./SectionHeader";

const DECISIONS = [
  {
    label: "ACT",
    icon: Play,
    tone: "border-brand/30 bg-brand-soft text-brand",
    body: "Within policy and confidence — runs automatically.",
  },
  {
    label: "ASK",
    icon: Hand,
    tone: "border-accent/30 bg-accent-soft text-accent",
    body: "Needs a human — pricing, sensitive or low-confidence.",
  },
  {
    label: "WAIT",
    icon: Hourglass,
    tone: "border-amber/30 bg-amber-soft text-amber",
    body: "Not now — working hours, frequency caps, mailbox limits.",
  },
  {
    label: "BLOCK",
    icon: OctagonX,
    tone: "border-danger/30 bg-danger-soft text-danger",
    body: "Never — suppressed, unsubscribed or not permitted.",
  },
];

const LEVELS = [
  { code: "L0", name: "Manual" },
  { code: "L1", name: "Assisted" },
  { code: "L2", name: "Semi-auto" },
  { code: "L3", name: "Autonomous" },
  { code: "L4", name: "Goal-driven" },
];

const GUARDRAILS = [
  {
    icon: Ban,
    title: "Suppression & do-not-contact",
    body: "Unsubscribes, suppression lists, duplicates, consent and regional rules are enforced — the AI cannot override them.",
  },
  {
    icon: ShieldCheck,
    title: "Approval for what matters",
    body: "Pricing, discounts, custom proposals, contracts and sensitive replies wait for a human by default.",
  },
  {
    icon: Power,
    title: "Global kill switch",
    body: "Stop every external action instantly. Each side effect is idempotent, so nothing double-sends on retry.",
  },
  {
    icon: ScrollText,
    title: "Full audit trail",
    body: "Ask “why did you send this email?” and get the evidence, rules and confidence behind the decision.",
  },
];

export default function Safety() {
  return (
    <section id="safety" aria-labelledby="safety-title" className="scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8">
        <SectionHeader
          id="safety-title"
          eyebrow="Safety & control"
          title={
            <>
              AI proposes. <span className="text-gradient">Policy decides.</span>
            </>
          }
          lede="Language models suggest; a deterministic policy engine makes the call. LLM output never writes straight to your data or your prospects’ inboxes."
        />

        <div className="mt-16 space-y-6">
          {/* decision engine */}
          <div className="card p-6 sm:p-8">
            <p className="text-sm font-semibold text-fg">Every proposed action gets one of four decisions</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DECISIONS.map(({ label, icon: Icon, tone, body }) => (
                <li key={label} className="rounded-xl border border-line bg-canvas p-4">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs font-semibold tracking-wider ${tone}`}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </span>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ul>

            <div className="mt-8 border-t border-line pt-6">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-semibold text-fg">Autonomy levels</p>
                <p className="text-xs text-faint">Configurable per campaign</p>
              </div>
              <ol
                className="mt-5 grid grid-cols-5 items-end gap-2"
                aria-label="Autonomy levels from manual to goal-driven"
              >
                {LEVELS.map((l, i) => (
                  <li key={l.code} className="flex flex-col items-center gap-2 text-center">
                    <span
                      aria-hidden="true"
                      className="w-full rounded-md border border-line-strong bg-linear-to-t from-brand/25 to-brand/5"
                      style={{ height: `${16 + i * 14}px` }}
                    />
                    <span className="font-mono text-xs font-semibold text-fg">{l.code}</span>
                    <span className="text-[11px] leading-tight text-muted">{l.name}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* guardrails, beside a photo */}
          <MediaSplit src="/images/safety-dashboard.jpg" alt="Someone reviewing a dashboard of results on a laptop">
            <ul className="grid gap-4">
              {GUARDRAILS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="card flex gap-4 p-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised text-brand">
                    <Icon className="size-[18px]" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </MediaSplit>
        </div>
      </div>
    </section>
  );
}
