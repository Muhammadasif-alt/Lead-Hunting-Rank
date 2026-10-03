/**
 * BullMQ queue names (Tech Spec #7 / #13 Phase 4).
 * Only `maintenance` is wired up in Phase 0; the rest are reserved names so every app agrees on them.
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

export const JOBS = {
  diagnosticsPing: 'diagnostics.ping',
} as const;

/**
 * Every job payload carries tracing identity so the worker can continue the same correlation
 * (Tech Spec #7 JobEnvelope). Payloads stay minimal — IDs, not whole records.
 */
export interface JobTracing {
  correlationId: string;
  causationId?: string;
  workspaceId?: string;
}

export interface DiagnosticsPingData extends JobTracing {
  requestedAt: string;
}

export interface DiagnosticsPingResult {
  workerId: string;
  processedAt: string;
  correlationId: string;
}
