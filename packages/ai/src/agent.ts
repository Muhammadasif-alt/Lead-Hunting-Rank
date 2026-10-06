import type { AgentDefinition, AgentType, ConfidenceLevel } from '@revenue-os/database';
import type { ServiceContext, Tx } from '@revenue-os/domain';
import type { z } from 'zod';
import type { CompanyContext } from './context.js';
import type { PromptTemplate } from './prompts.js';
import type { ValidationResult } from './validators.js';

export type DecisionKind = 'PROPOSE' | 'ACT' | 'ASK' | 'WAIT' | 'BLOCK' | 'ESCALATE';

/** What applying a validated answer did — becomes the AIDecision ("why did the AI do this?"). */
export interface AgentOutcome {
  decision: DecisionKind;
  actionType: string;
  confidence: ConfidenceLevel | null;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasonSummary: string;
  evidenceRefs: string[];
  uncertainties?: string[];
}

export interface ApplyRef {
  def: AgentDefinition;
  taskId: string;
  runId: string;
  now: Date;
}

/**
 * One agent (docs/08 §60-63): what it needs from the context, the shape of its answer, the checks the answer must pass,
 * and what a valid answer is allowed to change — through typed tools only. `simulate` is the rule-based answer used by
 * the test model and as the evaluation baseline.
 */
export interface AgentSpec<I = unknown, O = unknown> {
  type: AgentType;
  taskType: string;
  prompt: PromptTemplate;
  schema: z.ZodType<O>;
  /** null = run; a string = skip with this reason (e.g. no website was read). */
  skipReason(ctx: CompanyContext): string | null;
  objective(ctx: CompanyContext): string;
  input(ctx: CompanyContext): I;
  simulate(input: I, ctx: CompanyContext): O;
  validate(output: O, ctx: CompanyContext): ValidationResult[];
  apply(tx: Tx, sctx: ServiceContext, output: O, ctx: CompanyContext, ref: ApplyRef): Promise<AgentOutcome>;
}

export const LEVEL_RANK = { UNKNOWN: -1, NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

/** Evidence the trusted part of a prompt may show: id, kind, source, trust, date — never page text. */
export const evidenceIndex = (ctx: CompanyContext) => ctx.evidence.map((e) => ({ id: e.id, kind: e.kind, source: e.source, trust: e.trust, observedAt: e.observedAt.slice(0, 10), freshness: e.freshness }));
