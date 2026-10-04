import { Brain, ChartLine, Repeat, Scale, Send, Target } from 'lucide-react';
import type { Tone } from '@/lib/screens';
import { MediaSplit } from '@/components/ui/MediaSplit';
import SectionHeader from './SectionHeader';

/** Each step is coloured by the product area that owns it (lib/screens.ts TONES). */
const STEPS: { icon: typeof Target; title: string; tone: Tone; body: string }[] = [
  {
    icon: Target,
    title: 'Goal',
    tone: 'ai',
    body: 'You set the objective, ICP, offer and rules — e.g. “Book 20 meetings with Austin landscapers.”',
  },
  {
    icon: Brain,
    title: 'Intelligence',
    tone: 'leads',
    body: 'Agents discover companies, research them and capture buying signals — facts kept separate from inference.',
  },
  {
    icon: Scale,
    title: 'Decision',
    tone: 'system',
    body: 'AI proposes the next best action; the deterministic policy engine decides to act, ask, wait or block.',
  },
  {
    icon: Send,
    title: 'Action',
    tone: 'email',
    body: 'Approved outreach runs with idempotency, suppression checks and send limits on every side effect.',
  },
  {
    icon: ChartLine,
    title: 'Outcome',
    tone: 'sales',
    body: 'Replies are classified, conversations qualified and meetings booked with full context for your team.',
  },
  {
    icon: Repeat,
    title: 'Learning',
    tone: 'insight',
    body: 'Results feed back into memory — which ICP, signal, message and timing actually work, and who not to contact.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="scroll-mt-16 border-t border-line py-24"
    >
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-8">
        <SectionHeader
          id="how-title"
          eyebrow="How it works"
          title="One closed loop, from goal to learning"
          lede="Not a pile of automations. Every lead moves through the same accountable loop — and the system gets sharper with each outcome."
        />

        <div className="mt-16">
          <MediaSplit
            src="/images/how-it-works-planning.jpg"
            alt="Two colleagues mapping a sales plan on a whiteboard"
            minHeight={420}
          >
            <ol className="grid gap-4 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, tone, body }, i) => (
                <li key={title} data-tone={tone} className="card p-5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-tone/25 bg-[color-mix(in_oklab,var(--color-tone)_8%,white)] text-tone">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div>
                      <span className="font-mono text-[11px] text-faint">0{i + 1}</span>
                      <h3 className="text-base font-semibold text-fg">{title}</h3>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{body}</p>
                </li>
              ))}
            </ol>
          </MediaSplit>
        </div>
      </div>
    </section>
  );
}
