/**
 * BullMQ queue names (Tech Spec #7 / #13 Phase 4).
 * Physical queues are few on purpose; a queue hosts several job types. New job types are added per phase.
 */
export const QUEUES = {
  critical: 'critical',
  inbound: 'inbound',
  outbound: 'outbound',
  ai: 'ai',
  research: 'research',
  discovery: 'discovery',
  enrichment: 'enrichment',
  calendar: 'calendar',
  analytics: 'analytics',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Redis key prefix per environment, so staging can never consume production jobs (docs/11 §110-113).
 * Every producer and worker must pass it as BullMQ's `prefix`.
 */
export function queuePrefix(appEnv: string): string {
  return `rhl:${appEnv}`;
}

export const JOBS = {
  diagnosticsPing: 'diagnostics.ping',
  /** Execute one ExternalAction (claim → revalidate → provider → result). Payload: ExternalActionJobData. */
  externalActionExecute: 'external-action.execute',
  /** Periodic sweep: actions stuck in EXECUTING (worker died mid-call) → UNKNOWN_OUTCOME → reconcile. */
  externalActionReconcile: 'external-action.reconcile',
  /** Periodic, side-effect-free health check of every live integration (docs/12 §83). */
  providerHealthCheck: 'provider.health-check',
  /** Advance one discovery mission by (at most) one round from its current DB state. Payload: DiscoveryAdvanceJobData. */
  discoveryAdvance: 'discovery.mission.advance',
  /** Periodic: missions whose worker died mid-round, or whose WAITING retry time has come, get advanced again. */
  discoverySweep: 'discovery.sweep',
  /** Research one company: website, checks, contacts, verification, hypotheses. Payload: ResearchRunJobData. */
  researchRun: 'research.company.run',
  /** Run the company's AI agents (research plan, website interpretation, contact route, assessment). Payload: AiCompanyJobData. */
  aiCompanyIntelligence: 'ai.company.intelligence',
  /** Periodic: expire old approvals; re-queue WAITING actions whose time has come (execution revalidates each one). */
  policySweep: 'policy.sweep',
  /** Periodic: ACTIVE enrollments whose next step is due get a prepare job (Postgres is the schedule, docs/11 §31-34). */
  campaignSweep: 'campaign.sweep',
  /** Re-check one prospect, draft its next message, ask the Policy Engine. Payload: CampaignStepJobData. */
  campaignPrepareStep: 'campaign.step.prepare',
  /** An outbound action of a campaign settled (sent, blocked, cancelled…) → message + enrollment follow. Payload: externalActionId. */
  campaignActionSettled: 'campaign.action.settled',
  /** Periodic: read new inbound mail of connected mailboxes — replies, unsubscribes, bounces. */
  mailboxSync: 'mailbox.sync',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

/** Priority classes (docs/07 §49-52, docs/11 §4). BullMQ: lower number = served first. */
export const PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  BACKGROUND: 4,
} as const;

/**
 * Every job payload carries tracing identity so the worker can continue the same correlation
 * (Tech Spec #7 JobEnvelope). Payloads stay minimal — IDs, not whole records; the worker reloads
 * current state because a queued payload can be stale.
 */
export interface JobTracing {
  correlationId: string;
  causationId?: string;
  workspaceId?: string;
  /** Set when an admin retries a dead-lettered job, so success can resolve the DLQ record. */
  deadLetterId?: string;
}

export interface DiagnosticsPingData extends JobTracing {
  requestedAt: string;
}

export interface DiagnosticsPingResult {
  workerId: string;
  processedAt: string;
  correlationId: string;
}

export interface DiscoveryAdvanceJobData extends JobTracing {
  workspaceId: string;
  missionId: string;
  schemaVersion: 1;
}

export interface ExternalActionJobData extends JobTracing {
  workspaceId: string;
  externalActionId: string;
  schemaVersion: 1;
}

export interface ResearchRunJobData extends JobTracing {
  workspaceId: string;
  companyId: string;
  /** Set when a person asked (the run already exists, QUEUED). Discovery jobs create their run if one is due. */
  runId?: string;
  trigger: 'DISCOVERY' | 'MANUAL';
  missionId?: string;
  schemaVersion: 1;
}

export interface CampaignStepJobData extends JobTracing {
  workspaceId: string;
  enrollmentId: string;
  position: number;
  schemaVersion: 1;
}

export interface AiCompanyJobData extends JobTracing {
  workspaceId: string;
  companyId: string;
  /** What this pass is about (a research run, a person's request); an agent never runs twice on the same key. */
  inputKey: string;
  schemaVersion: 1;
}
