import { hostname } from 'node:os';
import { googleOAuthConfig, loadConfig } from '@revenue-os/config';
import { createPrismaClient } from '@revenue-os/database';
import { PromptChangedError, PROMPTS, runCompanyIntelligence, syncPrompts } from '@revenue-os/ai';
import { advanceMission, failMission, failResearch, runResearchJob, sweepDiscoveryMissions } from '@revenue-os/domain';
import type { ActionExecutor } from '@revenue-os/events';
import {
  createQueueWorker,
  DEFAULT_ATTEMPTS,
  externalActionHandlers,
  JOB_RETENTION,
  QueueProducer,
  startHeartbeat,
  startOutboxLoop,
  WorkerMetrics,
  type JobHandler,
} from '@revenue-os/events/runtime';
import { FAKE_SEND_ACTION, FakeSideEffectProvider, RedisFakeProviderStore } from '@revenue-os/events/testing';
import {
  prepareStep,
  processConversationMessage,
  settleCampaignAction,
  settleConversationReply,
  sweepCampaigns,
  syncAllMailboxes,
  wakeSnoozedConversations,
  withCampaignGuard,
  withConversationGuard,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, policySweep } from '@revenue-os/policy';
import { createEmailSendExecutor, EMAIL_REPLY_ACTION, EMAIL_SEND_ACTION } from '@revenue-os/providers';
import { checkAllIntegrations, createProviderRuntime } from '@revenue-os/providers/runtime';
import {
  describeError,
  JOBS,
  PRIORITY,
  QUEUES,
  queuePrefix,
  type DiagnosticsPingResult,
  type AiCompanyJobData,
  type CampaignStepJobData,
  type ConversationJobData,
  type DiscoveryAdvanceJobData,
  type ResearchRunJobData,
} from '@revenue-os/shared';
import { createLogger } from '@revenue-os/shared/server';
import { Redis } from 'ioredis';

const config = loadConfig();
const logger = createLogger({ service: 'worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });
const workerId = `${hostname()}:${process.pid}`;
const prefix = queuePrefix(config.APP_ENV);

const db = createPrismaClient(config.DATABASE_URL);
// Workers block on Redis, so BullMQ requires maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', () => undefined); // logged once per distinct error by the workers below
const producer = new QueueProducer(config.REDIS_URL, prefix);
const metrics = new WorkerMetrics();

// Provider Gateway (Phase 5): every provider call goes through it — routing, limits, circuit breaker, usage, health.
const providers = createProviderRuntime(db, {
  appEnv: config.APP_ENV,
  storagePath: config.STORAGE_LOCAL_PATH,
  redis: connection,
  prefix,
  llm: { provider: config.LLM_PROVIDER, apiKey: config.LLM_API_KEY },
  credentials: { db, encryptionKey: config.ENCRYPTION_KEY, google: googleOAuthConfig(config) ?? undefined },
  logger: { warn: (obj, msg) => logger.warn(obj, msg) },
});

// Side-effect adapters by action type. Each one calls its capability through the gateway, never a vendor directly.
// The diagnostics fake backs the pipeline self-test and never runs in production.
const emailExecutor = createEmailSendExecutor(providers.gateway);
const executors: Record<string, ActionExecutor> = {
  [EMAIL_SEND_ACTION]: emailExecutor,
  [EMAIL_REPLY_ACTION]: emailExecutor,
};
if (config.APP_ENV !== 'production') {
  executors[FAKE_SEND_ACTION] = new FakeSideEffectProvider(new RedisFakeProviderStore(connection, prefix), 150);
}
// Policy Engine (Phase 10): right before every provider call the action is decided again on current truth — kill switch,
// suppression, the requester's permission/autonomy, the approval. Anything but ACT stops the call.
// Campaign emails also check their campaign (active? prospect still in the sequence?) first; conversation replies check
// the conversation (taken over? a newer message? unsubscribed?).
const actions = externalActionHandlers(db, { executors, revalidate: withConversationGuard(withCampaignGuard(createPolicyRevalidator())) });

const policySweepJob: JobHandler = {
  timeoutMs: 60_000,
  handle: async () => policySweep(db),
};

// Campaigns (Phase 11): Postgres holds the schedule; the sweep makes sure each due step has a prepare job.
const outreach = { db, providers: providers.gateway, publicUrl: config.APP_URL };
const campaignSweep: JobHandler = {
  timeoutMs: 60_000,
  handle: async (data) =>
    sweepCampaigns(db, async ({ workspaceId, enrollmentId, position }) => {
      const job: CampaignStepJobData = { workspaceId, enrollmentId, position, schemaVersion: 1, correlationId: data.correlationId };
      await producer.queue(QUEUES.ai).add(JOBS.campaignPrepareStep, job, {
        jobId: `campaign-step-${enrollmentId}-${position}`,
        priority: PRIORITY.NORMAL,
        attempts: DEFAULT_ATTEMPTS,
        backoff: { type: 'custom' },
        ...JOB_RETENTION,
      });
    }),
};
const campaignPrepare: JobHandler = {
  timeoutMs: 3 * 60_000,
  handle: async (data) => ({ outcome: await prepareStep(outreach, data as unknown as CampaignStepJobData) }),
};
// Every outbound action that changes state: campaign messages and conversation replies follow (others are ignored).
const campaignSettled: JobHandler = {
  timeoutMs: 30_000,
  handle: async (data) => {
    const { externalActionId } = data as unknown as { externalActionId: string };
    return { outcome: await settleCampaignAction(db, externalActionId), reply: await settleConversationReply(db, externalActionId) };
  },
};
// Replies, unsubscribes and bounces stop the sequence; polling the mailbox is how we notice them.
const mailboxSync: JobHandler = {
  timeoutMs: 3 * 60_000,
  handle: async () => ({ mailboxes: await syncAllMailboxes(db, providers.gateway) }),
};

// Conversations (Phase 12): a prospect is waiting — read the message, update the context, draft / reply / escalate.
const conversationProcess: JobHandler = {
  timeoutMs: 4 * 60_000,
  handle: async (data) => ({ outcome: await processConversationMessage(outreach, data as unknown as ConversationJobData) }),
};
const conversationSweep: JobHandler = {
  timeoutMs: 60_000,
  handle: async () => wakeSnoozedConversations(db),
};

const providerHealthCheck: JobHandler = {
  timeoutMs: 120_000,
  handle: async () => ({ checked: await checkAllIntegrations(db, providers) }),
};

// Lead Hunter (Phase 7): one bounded round per job; the mission's DB state says where to continue.
const discoveryAdvance: JobHandler = {
  timeoutMs: 10 * 60_000,
  handle: async (data, ctx) => {
    const { missionId } = data as unknown as DiscoveryAdvanceJobData;
    try {
      return await advanceMission({ db, gateway: providers.gateway, workerId }, missionId);
    } catch (err) {
      // Out of retries on something unexpected: settle the mission so it doesn't look busy forever.
      if (ctx.finalAttempt) await failMission(db, missionId, `Unexpected error: ${describeError(err)}`);
      throw err;
    }
  },
};

const discoverySweep: JobHandler = {
  timeoutMs: 60_000,
  handle: async (data) =>
    sweepDiscoveryMissions(db, async ({ workspaceId, missionId, jobId }) => {
      const job: DiscoveryAdvanceJobData = { workspaceId, missionId, schemaVersion: 1, correlationId: data.correlationId };
      await producer.queue(QUEUES.discovery).add(JOBS.discoveryAdvance, job, {
        jobId,
        priority: PRIORITY.BACKGROUND,
        attempts: DEFAULT_ATTEMPTS,
        backoff: { type: 'custom' },
        ...JOB_RETENTION,
      });
    }),
};

// Research (Phase 8): one company per job. The run's DB state decides whether research is due — many listings of one
// business start one run, and a recently researched company is skipped.
const researchRun: JobHandler = {
  timeoutMs: 3 * 60_000,
  handle: async (data, ctx) => {
    const job = data as unknown as ResearchRunJobData;
    try {
      return await runResearchJob({ db, gateway: providers.gateway, workerId }, job);
    } catch (err) {
      if (ctx.finalAttempt) await failResearch(db, job, `Unexpected error: ${describeError(err)}`);
      throw err;
    }
  },
};

// AI runtime (Phase 9): the company's agents after research or on request. Each agent's task is idempotent per input key.
const aiCompanyIntelligence: JobHandler = {
  timeoutMs: 8 * 60_000,
  handle: async (data) => runCompanyIntelligence({ db, providers: providers.gateway }, data as unknown as AiCompanyJobData),
};

const ping: JobHandler = {
  timeoutMs: 5_000,
  handle: async (data): Promise<DiagnosticsPingResult> => ({
    workerId,
    processedAt: new Date().toISOString(),
    correlationId: data.correlationId,
  }),
};

// One BullMQ Worker per queue family; more queues are added as their phases land (docs/11 §55-57).
const workers = [
  createQueueWorker({
    queue: QUEUES.maintenance,
    prefix,
    connection,
    db,
    logger,
    metrics,
    handlers: {
      [JOBS.diagnosticsPing]: ping,
      [JOBS.externalActionReconcile]: actions[JOBS.externalActionReconcile],
      [JOBS.providerHealthCheck]: providerHealthCheck,
      [JOBS.discoverySweep]: discoverySweep,
      [JOBS.policySweep]: policySweepJob,
      [JOBS.campaignSweep]: campaignSweep,
      [JOBS.conversationSweep]: conversationSweep,
    },
  }),
  createQueueWorker({
    queue: QUEUES.discovery,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 2,
    handlers: { [JOBS.discoveryAdvance]: discoveryAdvance },
  }),
  createQueueWorker({
    queue: QUEUES.research,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 4,
    handlers: { [JOBS.researchRun]: researchRun },
  }),
  createQueueWorker({
    queue: QUEUES.ai,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 2,
    handlers: { [JOBS.aiCompanyIntelligence]: aiCompanyIntelligence, [JOBS.campaignPrepareStep]: campaignPrepare, [JOBS.conversationProcess]: conversationProcess },
  }),
  createQueueWorker({
    queue: QUEUES.outbound,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 2,
    handlers: { [JOBS.externalActionExecute]: actions[JOBS.externalActionExecute], [JOBS.campaignActionSettled]: campaignSettled },
  }),
  createQueueWorker({
    queue: QUEUES.inbound,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 1,
    handlers: { [JOBS.mailboxSync]: mailboxSync },
  }),
];

// Prompt registry: record each prompt version's exact text; an edited prompt without a version bump stops the worker
// (docs/08 §68 — no silent production prompt changes).
// A database that is still starting (or recovering after a crash) is waited for instead of crashing the worker.
for (let attempt = 1; ; attempt++) {
  try {
    await syncPrompts(db, PROMPTS);
    break;
  } catch (err) {
    if (err instanceof PromptChangedError || attempt >= 30) throw err;
    logger.warn({ attempt, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }, 'database not ready, retrying');
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

// Redis reconnects every few seconds while down — log each distinct error once, not on every retry.
for (const worker of workers) {
  let lastError = '';
  worker.on('ready', () => {
    lastError = '';
    logger.info({ workerId, queue: worker.name }, 'worker listening');
  });
  worker.on('error', (err) => {
    const message = describeError(err);
    if (message !== lastError) logger.error({ queue: worker.name, error: message }, 'worker connection error');
    lastError = message;
  });
}

const outbox = startOutboxLoop(db, producer.publish, logger);
const heartbeat = startHeartbeat(connection, prefix, { workerId, queues: workers.map((w) => w.name) }, metrics);

// Crash-recovery sweep for external actions whose worker died mid-call. Idempotent; one schedule per environment.
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('external-action-reconcile', { every: 60_000 }, { name: JOBS.externalActionReconcile, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register reconcile schedule'));
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('provider-health-check', { every: 5 * 60_000 }, { name: JOBS.providerHealthCheck, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register provider health schedule'));
// Discovery: wakes WAITING missions whose retry time has come and re-queues missions whose worker died mid-round.
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('discovery-sweep', { every: 60_000 }, { name: JOBS.discoverySweep, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register discovery sweep schedule'));
// Policy: expires undecided approvals and re-queues WAITING actions whose time has come (each is revalidated).
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('policy-sweep', { every: 60_000 }, { name: JOBS.policySweep, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register policy sweep schedule'));
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('campaign-sweep', { every: 60_000 }, { name: JOBS.campaignSweep, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register campaign sweep schedule'));
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('conversation-sweep', { every: 5 * 60_000 }, { name: JOBS.conversationSweep, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register conversation sweep schedule'));
producer
  .queue(QUEUES.inbound)
  .upsertJobScheduler('mailbox-sync', { every: 2 * 60_000 }, { name: JOBS.mailboxSync, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register mailbox sync schedule'));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  // Stop claiming new work first, let in-flight jobs finish, then release connections (docs/11 §104).
  await outbox.stop();
  await Promise.all(workers.map((w) => w.close()));
  await heartbeat.stop();
  await producer.close();
  connection.disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
