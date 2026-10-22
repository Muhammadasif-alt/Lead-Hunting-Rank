"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Loader, Search, Sparkles } from "lucide-react";
import type { RevenueAnswer } from "@revenue-os/shared";
import { post, errorMessage } from "@/lib/api";
import { ErrorBox, RecordList, useAnalytics } from "./parts";

const EXAMPLES = [
  "Revenue kahan se aa raha hai?",
  "Where is revenue coming from?",
  "Compare my markets",
  "Last 90 days mein deals kyun lose hui?",
  "Which signal creates meetings?",
  "Pipeline ka bottleneck kya hai?",
  "Kahan API cost waste ho rahi hai?",
  "Which high-fit prospects are not contactable?",
  "Why are meetings down?",
];

/** Revenue Intelligence AI (screen #10 §43-44): answers are structured — observed, primary change, evidence first. */
export function AskTab() {
  const { filters } = useAnalytics();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<RevenueAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string, e?: FormEvent) {
    e?.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setQ(text);
    setBusy(true);
    setError(null);
    try {
      setAnswer(await post<RevenueAnswer>("/analytics/ask", { q: text, ...filters }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => void ask(q, e)} className="card space-y-3 p-4">
        <label htmlFor="ask-revenue" className="eyebrow block text-[11px]">
          Ask Revenue AI
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" aria-hidden />
            <input id="ask-revenue" className="input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask Revenue AI… e.g. Revenue kahan se aa raha hai?" maxLength={300} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || !q.trim()}>
            {busy ? <Loader className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Ask
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="badge h-auto whitespace-normal py-1 text-left hover:border-tone hover:text-tone" onClick={() => void ask(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
        <p className="text-xs text-faint">Answers use the filters above and only report what the records show — with the records to check it.</p>
      </form>

      {error && <ErrorBox text={error} />}
      {answer && <Answer a={answer} onAsk={(s) => void ask(s)} />}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h3>
      <div className="mt-1 text-sm">{children}</div>
    </section>
  );
}

function Answer({ a, onAsk }: { a: RevenueAnswer; onAsk: (q: string) => void }) {
  if (a.intent === "UNKNOWN")
    return (
      <div className="card space-y-3 p-4">
        <Block title="Question">{a.question}</Block>
        <p className="text-sm text-muted">I can’t answer that from the analytics data yet. These are questions I can answer:</p>
        <div className="flex flex-wrap gap-1.5">
          {a.suggestions.map((s) => (
            <button key={s} type="button" className="badge h-auto whitespace-normal border-tone/30 bg-tone-soft py-1 text-left text-tone hover:border-tone" onClick={() => onAsk(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <article className="card space-y-4 p-4">
      <Block title="Question">
        <span className="font-medium">{a.question}</span>
        <span className="ml-1 text-xs text-faint">· {a.period.label}</span>
      </Block>
      {a.observed.length > 0 && (
        <Block title="Observed">
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {a.observed.map((o, i) => (
              <div key={i} className="rounded-lg border border-line bg-raised px-3 py-2">
                <dt className="text-xs text-muted">{o.label}</dt>
                <dd className="font-semibold">{o.value}</dd>
                {o.change && <dd className="text-xs text-faint">{o.change}</dd>}
              </div>
            ))}
          </dl>
        </Block>
      )}
      {a.primaryChange && (
        <Block title="Primary change">
          <p className="rounded-lg border border-tone/25 bg-tone-soft px-3 py-2">{a.primaryChange}</p>
        </Block>
      )}
      {a.evidence.length > 0 && (
        <Block title="Evidence">
          <ul className="list-disc space-y-0.5 pl-4">
            {a.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Block>
      )}
      {a.recommendation && (
        <Block title="Recommended investigation">
          <p>{a.recommendation}</p>
        </Block>
      )}
      <Block title={`Open records${a.records.length ? ` · ${a.records.length}` : ""}`}>
        <RecordList records={a.records} limit={20} />
      </Block>
      {a.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          <span className="text-xs text-faint">Ask next:</span>
          {a.suggestions.map((s) => (
            <button key={s} type="button" className="badge h-auto whitespace-normal py-1 text-left hover:border-tone hover:text-tone" onClick={() => onAsk(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
