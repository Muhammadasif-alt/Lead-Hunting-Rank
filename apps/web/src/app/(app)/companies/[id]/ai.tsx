"use client";

import { useState } from "react";
import { Bot, CircleCheck, CircleX, Loader, RefreshCw, Sparkles } from "lucide-react";
import { errorMessage, post } from "@/lib/api";
import { formatAgo, type AgentSummary, type Overview } from "@/lib/crm";
import { Section } from "./sections";

const DIMENSION_LABEL: Record<string, string> = {
  PRIORITY: "Priority",
  OPPORTUNITY: "Opportunity",
  CONTACTABILITY: "Contactability",
  DATA_CONFIDENCE: "Data confidence",
  ICP_FIT: "ICP fit",
};

const LEVEL_CLASS: Record<string, string> = {
  HIGH: "text-brand",
  MEDIUM: "text-amber",
  LOW: "text-muted",
  UNKNOWN: "text-faint",
};

const STEP_LABEL: Record<string, string> = {
  REFRESH_RESEARCH: "Research again",
  VERIFY_EMAILS: "Verify emails",
  FIND_DECISION_MAKER: "Find the decision maker",
  REVIEW_CONFLICTS: "Review conflicting facts",
  NONE: "Nothing needed now",
};

/** "fake-standard" → the rule-based test model; anything else is a real model name. */
export const isTestModel = (model: string | null | undefined) => !!model && model.startsWith("fake-");

export function agent(data: Overview, type: AgentSummary["agentType"]) {
  return data.ai.agents.find((a) => a.agentType === type && a.status === "COMPLETED") ?? null;
}

function ModelNote({ agents }: { agents: AgentSummary[] }) {
  const model = agents.find((a) => a.decision?.model)?.decision?.model;
  if (!model) return null;
  return isTestModel(model) ? (
    <span
      className="badge border-line bg-raised text-muted"
      title="No real AI model is connected: answers come from rules, checked by the same validators"
    >
      Test model
    </span>
  ) : (
    <span className="badge">{model}</span>
  );
}

/**
 * AI assessment (Phase 9): the Scoring Agent's levels with reasons, the Research Agent's next steps, and — under "How
 * the AI got here" — each agent's decision record: model, prompt version, validators. Proposals only; nothing external.
 */
export function AiAssessment({ data, onChange }: { data: Overview; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { assessment, agents, running } = data.ai;
  const research = agent(data, "RESEARCH");
  const steps = ((research?.output?.nextSteps as { action: string; reason: string }[] | undefined) ?? []).filter(
    (s) => s.action !== "NONE",
  );
  const blocked = agents.filter((a) => a.status === "BLOCKED" || a.status === "FAILED");

  async function assess() {
    setBusy(true);
    setError(null);
    try {
      await post(`/companies/${data.company.id}/assess`);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="AI assessment"
      hint="Levels with reasons, not a score. AI proposes; nothing is sent or changed outside."
      action={
        data.allowedActions.assess && (
          <button
            type="button"
            className="btn btn-ghost h-8 px-3"
            disabled={busy || running}
            onClick={() => void assess()}
          >
            {busy || running ? <Loader className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {running ? "Working" : "Assess again"}
          </button>
        )
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-faint">
        <Bot className="size-3.5" />
        {assessment[0]
          ? `Assessed ${formatAgo(assessment[0].assessedAt)}`
          : running
            ? "The agents are working…"
            : "Not assessed yet"}
        <ModelNote agents={agents} />
      </div>
      {assessment.length > 0 ? (
        <dl className="space-y-3">
          {assessment.map((a) => (
            <div key={a.dimension}>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm">{DIMENSION_LABEL[a.dimension]}</dt>
                <dd className={`text-sm font-semibold ${LEVEL_CLASS[a.level]}`}>
                  {a.level === "UNKNOWN" ? "Unknown" : a.level.charAt(0) + a.level.slice(1).toLowerCase()}
                </dd>
              </div>
              <ul className="mt-0.5 space-y-0.5 text-xs text-muted">
                {a.reasons.slice(0, 2).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ))}
        </dl>
      ) : (
        blocked.length > 0 && <p className="text-sm text-muted">{blocked[0]!.reasonSummary}</p>
      )}

      {steps.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-faint">Suggested next steps (Research Agent)</div>
          <ul className="mt-1 space-y-1 text-sm">
            {steps.map((s) => (
              <li key={s.action}>
                <span className="font-medium">{STEP_LABEL[s.action] ?? s.action}</span>{" "}
                <span className="text-muted">— {s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      {agents.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted">How the AI got here</summary>
          <ul className="mt-2 space-y-3">
            {agents.map((a) => {
              const failed = a.decision?.validation.filter((v) => !v.ok) ?? [];
              return (
                <li key={a.taskId} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.label}</span>
                    <span
                      className={`text-xs ${a.status === "COMPLETED" ? "text-brand" : a.status === "CANCELLED" ? "text-faint" : "text-amber"}`}
                    >
                      {a.status === "CANCELLED" ? "skipped" : a.status.toLowerCase().replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{a.decision?.reasonSummary ?? a.reasonSummary}</p>
                  {a.decision && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                      <span>{a.decision.decision.toLowerCase()}</span>
                      {a.decision.promptVersion && <span>prompt v{a.decision.promptVersion}</span>}
                      {a.run?.model && <span>{isTestModel(a.run.model) ? "test model" : a.run.model}</span>}
                      {a.run?.inputTokens != null && (
                        <span>{(a.run.inputTokens ?? 0) + (a.run.outputTokens ?? 0)} tokens</span>
                      )}
                      {a.run?.latencyMs != null && <span>{a.run.latencyMs} ms</span>}
                      {a.decision.validation.length > 0 &&
                        (failed.length ? (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <CircleX className="size-3" /> {failed[0]!.detail}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <CircleCheck className="size-3" /> {a.decision.validation.length} checks passed
                          </span>
                        ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </Section>
  );
}

/** Website Audit Agent's reading of the deterministic checks, shown next to them — interpretation, not new facts. */
export function AiWebsiteReading({ data }: { data: Overview }) {
  const a = agent(data, "WEB_AUDIT");
  if (!a?.output) return null;
  const out = a.output as { summary: string; observations: { statement: string }[]; uncertainties: string[] };
  return (
    <Section title="AI reading of the website" hint="The Website Audit Agent's interpretation of the checks above.">
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-tone-ai" />
        <p>{out.summary}</p>
      </div>
      {out.uncertainties?.length > 0 && (
        <ul className="mt-2 list-inside list-disc text-xs text-muted">
          {out.uncertainties.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">
        {isTestModel(a.decision?.model) ? "Test model" : a.decision?.model} · prompt v{a.decision?.promptVersion} ·{" "}
        {a.completedAt ? formatAgo(a.completedAt) : ""}
      </p>
    </Section>
  );
}
