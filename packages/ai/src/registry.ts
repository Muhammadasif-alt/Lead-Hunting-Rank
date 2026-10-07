import type { AgentDefinition, AgentType, PrismaClient } from '@revenue-os/database';
import type { ModelClass } from '@revenue-os/providers';
import type { Tx } from '@revenue-os/domain';

/**
 * Typed tools (docs/08 §69-72). Agents never touch the database, providers or the network: whatever they want done is a
 * tool — READ/ANALYSIS gather, PROPOSAL records a suggestion, COMMAND asks a domain service. Server-side checks decide
 * whether an agent may use a tool; the prompt never does.
 */
export const TOOLS = {
  readCompanyContext: { category: 'READ', description: 'Company facts, evidence, website checks, people and contacts (scoped to the workspace)' },
  proposeHypothesis: { category: 'PROPOSAL', description: 'Suggest an opportunity hypothesis that cites evidence (stored as an unverified candidate)' },
  proposeAssessment: { category: 'PROPOSAL', description: 'Assess a company per dimension with reasons' },
  proposeContactRoute: { category: 'PROPOSAL', description: 'Recommend who to reach first and through which contact point' },
  proposeNextStep: { category: 'PROPOSAL', description: 'Recommend the next research step (recorded, not executed)' },
  draftEmail: { category: 'PROPOSAL', description: 'Draft one outreach email for a prospect — sent only if the Policy Engine allows it' },
  requestResearch: { category: 'COMMAND', description: 'Ask for the company to be researched again' },
} as const;
export type ToolName = keyof typeof TOOLS;

/** Bump when a tool's contract changes; recorded on every AI run (docs/08 §119). */
export const TOOLSET_VERSION = 1;

export interface AgentDefaults {
  version: number;
  modelClass: ModelClass;
  allowedTools: ToolName[];
  dailyRunLimit: number | null;
  dailyCostLimitMinor: number | null;
  timeoutMs: number;
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH';
  label: string;
  purpose: string;
}

/**
 * Agent registry (docs/08 §12-13, §132). Agents only read and propose: no agent has a tool that sends, books or prices.
 * The Campaign Agent drafts emails; whether one is sent is an external action the Policy Engine decides on.
 */
export const AGENTS: Record<AgentType, AgentDefaults> = {
  RESEARCH: {
    version: 1,
    modelClass: 'STANDARD',
    allowedTools: ['readCompanyContext', 'proposeNextStep'],
    dailyRunLimit: 2000,
    dailyCostLimitMinor: null,
    timeoutMs: 90_000,
    riskClass: 'LOW',
    label: 'Research Agent',
    purpose: 'Summarises what we know, what is missing, and the next research step',
  },
  WEB_AUDIT: {
    version: 1,
    modelClass: 'STANDARD',
    allowedTools: ['readCompanyContext', 'proposeHypothesis'],
    dailyRunLimit: 2000,
    dailyCostLimitMinor: null,
    timeoutMs: 90_000,
    riskClass: 'LOW',
    label: 'Website Audit Agent',
    purpose: 'Interprets the deterministic website checks and suggests evidence-backed opportunity hypotheses',
  },
  CONTACT: {
    version: 1,
    modelClass: 'FAST',
    allowedTools: ['readCompanyContext', 'proposeContactRoute'],
    dailyRunLimit: 2000,
    dailyCostLimitMinor: null,
    timeoutMs: 60_000,
    riskClass: 'LOW',
    label: 'Contact Agent',
    purpose: 'Ranks the people we found by role fit and picks the best first contact route — never guesses an email',
  },
  SCORING: {
    version: 1,
    modelClass: 'FAST',
    allowedTools: ['readCompanyContext', 'proposeAssessment'],
    dailyRunLimit: 2000,
    dailyCostLimitMinor: null,
    timeoutMs: 60_000,
    riskClass: 'LOW',
    label: 'Scoring Agent',
    purpose: 'Explains opportunity, contactability, data confidence and priority with reasons — not a magic number',
  },
  CAMPAIGN: {
    version: 1,
    modelClass: 'STANDARD',
    allowedTools: ['readCompanyContext', 'draftEmail'],
    dailyRunLimit: 500,
    dailyCostLimitMinor: null,
    timeoutMs: 90_000,
    riskClass: 'MEDIUM',
    label: 'Campaign Agent',
    purpose: 'Writes short, evidence-backed outreach emails per prospect — it drafts; the Policy Engine decides whether they are sent',
  },
};

export const AGENT_ORDER: AgentType[] = ['RESEARCH', 'WEB_AUDIT', 'CONTACT', 'SCORING'];

/** Model class → provider capability. */
export const capabilityFor = (modelClass: string) => (modelClass === 'FAST' || modelClass === 'EXTRACTION' ? 'LLM_EXTRACTION' : 'LLM_REASONING') as 'LLM_EXTRACTION' | 'LLM_REASONING';

/** The workspace's configuration for an agent, created from the registry defaults on first use. */
export async function agentDefinition(db: PrismaClient | Tx, workspaceId: string, agentType: AgentType): Promise<AgentDefinition> {
  const d = AGENTS[agentType];
  return db.agentDefinition.upsert({
    where: { workspaceId_agentType: { workspaceId, agentType } },
    create: {
      workspaceId,
      agentType,
      version: d.version,
      modelClass: d.modelClass,
      allowedTools: d.allowedTools,
      dailyRunLimit: d.dailyRunLimit,
      dailyCostLimitMinor: d.dailyCostLimitMinor,
      timeoutMs: d.timeoutMs,
      riskClass: d.riskClass,
    },
    update: {},
  });
}

export class ToolNotAllowedError extends Error {
  constructor(agentType: AgentType, tool: ToolName) {
    super(`${agentType} may not use ${tool}`);
  }
}

/** Server-side least privilege: the agent's definition must allow the tool. */
export function assertToolAllowed(def: Pick<AgentDefinition, 'agentType' | 'allowedTools'>, tool: ToolName) {
  if (!def.allowedTools.includes(tool)) throw new ToolNotAllowedError(def.agentType, tool);
}
