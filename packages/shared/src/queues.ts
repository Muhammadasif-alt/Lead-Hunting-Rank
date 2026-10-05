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
