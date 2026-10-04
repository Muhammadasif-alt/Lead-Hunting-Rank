import { Plus } from "lucide-react";
import SectionHeader from "./SectionHeader";

const FAQS = [
  {
    q: "Is this a GoHighLevel clone?",
    a: "No. Rank High Lead isn’t a bundle of funnels and fixed automations. It’s built around a goal-driven intelligence loop — Goal → Intelligence → Decision → Action → Outcome → Learning — where AI agents research, decide and act on your behalf within rules you set.",
  },
  {
    q: "Will the AI send emails without my approval?",
    a: "Only if you allow it. Autonomy is set per campaign from L0 (manual) to L4 (goal-driven). Even at higher levels, pricing, discounts, proposals, sensitive conversations and low-confidence replies are routed to a human, and a global kill switch stops all outreach instantly.",
  },
  {
    q: "Where does lead data come from?",
    a: "Lead Hunter merges multiple public and permitted sources, then deduplicates them into one record per business. Every fact is stored with its source and the date it was last checked, and AI inference is labelled separately from evidence.",
  },
  {
    q: "How accurate is market coverage?",
    a: "We show it honestly rather than promising 100%. Each search reports sources searched, queries exhausted, duplicates resolved and an estimated coverage level, so you know how complete your market map really is.",
  },
  {
    q: "Which channels are supported?",
    a: "Email comes first, with suppression, consent, frequency caps and mailbox limits enforced. Other channels are added only where the law and the recipient’s consent allow it.",
  },
  {
    q: "Can I see why the AI did something?",
    a: "Yes. Every important action records why it happened — the evidence used, the rules checked and the confidence score — so “why did you send this email?” always has an answer.",
  },
];

export default function FAQ() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-t border-line py-24">
      <div className="mx-auto grid max-w-page gap-12 px-4 sm:px-6 lg:grid-cols-3 lg:px-8">
        <SectionHeader
          id="faq-title"
          align="left"
          eyebrow="FAQ"
          title="Questions, answered"
          lede="Straight answers about how the system works and what it will — and won’t — do."
        />

        <div className="divide-y divide-line border-y border-line lg:col-span-2">
          {FAQS.map(({ q, a }) => (
            <details key={q} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-md py-4 text-left text-[15px] font-medium text-fg transition-colors hover:text-brand [&::-webkit-details-marker]:hidden">
                {q}
                <Plus
                  className="size-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-45"
                  aria-hidden="true"
                />
              </summary>
              <p className="pb-5 pr-10 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
