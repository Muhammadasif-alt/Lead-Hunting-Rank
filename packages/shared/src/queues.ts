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
  /** One inbound message in a conversation: classify → structured context → draft / reply / escalate. Payload: ConversationJobData. */
  conversationProcess: 'conversation.message.process',
  /** Periodic: snoozed conversations whose time has come are brought back to a person. */
  conversationSweep: 'conversation.sweep',
  /** Periodic: booked meetings reconciled with the calendar (deleted / moved there), briefs prepared before they start. */
  meetingSweep: 'meeting.sweep',
  /** An approved knowledge revision was published → embed its chunks (only chunks whose text changed). Payload: revisionId. */
  knowledgeEmbed: 'knowledge.embed',
  /** An uploaded document: parse → extract candidates → detect conflicts (nothing is approved here). Payload: sourceId. */
  knowledgeDocumentProcess: 'knowledge.document.process',
  /** Periodic: scheduled knowledge goes live, overdue reviews turn STALE, memories expire or need re-checking, promises fall due. */
  brainSweep: 'brain.sweep',
  /** Detect signals for one company from one source event (research diff, classified message, due promise, lost deal, discovery, CRM). Payload: SignalDetectJobData. */
  signalDetect: 'signal.detect',
  /** Periodic: expire old signals, flag missed windows, open lost-deal revisits, keep dynamic watchlists in sync, queue monitoring research for due companies. */
  signalSweep: 'signal.sweep',
  /** The Signal Agent interprets one signal (hedged, evidence-backed). Payload: SignalAnalyzeJobData. */
  signalAnalyze: 'signal.analyze',
  /** Build / refresh a deal's attribution touches (and the WON revenue event once). Payload: AttributionJobData. */
  analyticsAttribute: 'analytics.attribute',
  /** Periodic: rebuild the daily metric projection for recent days (idempotent upsert; derived, never truth). */
  analyticsRollup: 'analytics.rollup',
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
  trigger: 'DISCOVERY' | 'MANUAL' | 'MONITOR';
  missionId?: string;
  schemaVersion: 1;
}

export interface CampaignStepJobData extends JobTracing {
  workspaceId: string;
  enrollmentId: string;
  position: number;
  schemaVersion: 1;
}

export interface ConversationJobData extends JobTracing {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  schemaVersion: 1;
}

export interface AiCompanyJobData extends JobTracing {
  workspaceId: string;
  companyId: string;
  /** What this pass is about (a research run, a person's request); an agent never runs twice on the same key. */
  inputKey: string;
  schemaVersion: 1;
}

export type SignalDetectSource = 'RESEARCH' | 'CONVERSATION' | 'COMMITMENT' | 'PIPELINE' | 'DISCOVERY' | 'CRM';

export interface SignalDetectJobData extends JobTracing {
  workspaceId: string;
  /** Known for most sources; a conversation event carries only the message id (refId) — the job resolves it. */
  companyId?: string;
  source: SignalDetectSource;
  /** The record that triggered detection (research run, conversation, commitment, opportunity, mission, employment). */
  refId: string;
  schemaVersion: 1;
}

export interface SignalAnalyzeJobData extends JobTracing {
  workspaceId: string;
  signalId: string;
  schemaVersion: 1;
}

export interface AttributionJobData extends JobTracing {
  workspaceId: string;
  opportunityId: string;
  schemaVersion: 1;
}
