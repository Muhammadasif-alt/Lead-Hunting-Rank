import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildCompanyContext, PROMPTS, PromptChangedError, runAgentTask, runCompanyIntelligence, syncPrompts, webAuditAgent, researchAgent } from '@revenue-os/ai';
import { runResearchJob } from '@revenue-os/domain';
import { FakeLLMProvider, FakeWebsiteProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { analyzePage, normalizeCompanyName } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });

/**
 * Phase 9 (docs/17 §58-61, docs/08): AgentTask → Context Builder → AI Gateway → structured answer → validators → typed
 * tools → AIDecision, for the Research, Website Audit, Contact and Scoring agents — with budgets, disabled agents,
 * missing models, rejected answers and least privilege all ending in a recorded decision, never a silent action.
 */
describe('Phase 9 — AI runtime and agents', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let domain: string;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'AI Test', slug: uniqueSlug('ai'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' } });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const connect = (ctx: ServiceContext, provider: 'fake_websites' | 'fake_verification' | 'fake_llm') => {
    const meta = { fake_websites: ['WEB', ['WEBSITE_FETCH']], fake_verification: ['VERIFICATION', ['EMAIL_VERIFY']], fake_llm: ['AI', ['LLM_REASONING', 'LLM_EXTRACTION']] } as const;
    return prisma.client.integration.create({ data: { workspaceId: ctx.workspaceId, provider, category: meta[provider][0], name: provider, capabilities: [...meta[provider][1]], status: 'ACTIVE', priority: 100, connectedAt: new Date() } });
  };
  /** A researched company: website read, people found, emails verified — what the agents run on. */
  const researched = async (ctx: ServiceContext, name = 'AI Target Co') => {
    const c = await prisma.client.company.create({ data: { workspaceId: ctx.workspaceId, displayName: name, normalizedName: normalizeCompanyName(name), websiteDomain: domain, phone: '+1 512 555 0199', city: 'Austin', region: 'TX', country: 'US' } });
    const r = await runResearchJob({ db: prisma.client, gateway: runtime.gateway, workerId: 't' }, { workspaceId: ctx.workspaceId, companyId: c.id, trigger: 'DISCOVERY' });
    return { company: c, inputKey: `research:${r.runId}` };
  };
  const deps = () => ({ db: prisma.client, providers: runtime.gateway });

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase9-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    // A reachable test site that names a person with a published email.
    const web = new FakeWebsiteProvider();
    for (let i = 0; i < 400; i++) {
      const d = `aisite${i}.example`;
      const home = await web.fetchPage(`https://${d}/`, o());
      if (home.failure) continue;
      const about = analyzePage(home.body, home.finalUrl).links.about;
      const page = about ? await web.fetchPage(about, o()) : null;
      if (page && !page.failure && analyzePage(page.body, page.finalUrl).people.some((p) => p.email)) {
        domain = d;
        break;
      }
    }
    assert.ok(domain);
  });

  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('after research, four agents run: tasks, runs, decisions with validation, an assessment with reasons', async () => {
    const ctx = await newWorkspace();
    for (const p of ['fake_websites', 'fake_verification', 'fake_llm'] as const) await connect(ctx, p);
    const { company, inputKey } = await researched(ctx);

    const result = await runCompanyIntelligence(deps(), { workspaceId: ctx.workspaceId, companyId: company.id, inputKey });
    assert.deepEqual(result.tasks.map((t) => [t.agentType, t.status]), [
      ['RESEARCH', 'COMPLETED'],
      ['WEB_AUDIT', 'COMPLETED'],
      ['CONTACT', 'COMPLETED'],
      ['SCORING', 'COMPLETED'],
    ]);

    const runs = await prisma.client.aiRun.findMany({ where: { workspaceId: ctx.workspaceId } });
    assert.equal(runs.length, 4);
    for (const r of runs) {
      assert.equal(r.status, 'SUCCEEDED');
      assert.equal(r.promptVersion, 1);
      assert.match(r.model ?? '', /^fake-/);
      assert.ok((r.inputTokens ?? 0) > 0 && r.latencyMs !== null);
      assert.match(r.inputHash, /^[0-9a-f]{64}$/);
    }
    const decisions = await prisma.client.aiDecision.findMany({ where: { workspaceId: ctx.workspaceId } });
    assert.equal(decisions.length, 4);
    for (const d of decisions) {
      assert.ok(d.reasonSummary.length > 0);
      assert.ok((d.validation as { ok: boolean }[]).every((v) => v.ok), JSON.stringify(d.validation));
    }

    const assessment = await prisma.client.companyAssessment.findMany({ where: { companyId: company.id, supersededAt: null } });
    assert.deepEqual(assessment.map((a) => a.dimension).sort(), ['CONTACTABILITY', 'DATA_CONFIDENCE', 'ICP_FIT', 'OPPORTUNITY', 'PRIORITY']);
    assert.equal(assessment.find((a) => a.dimension === 'ICP_FIT')?.level, 'UNKNOWN', 'no ICP → unknown, never guessed');
    for (const a of assessment) assert.ok(a.reasons.length > 0, `${a.dimension} has reasons`);

    // AI suggestions are unverified candidates that cite evidence, apart from rule-based hypotheses.
    for (const h of await prisma.client.opportunityHypothesis.findMany({ where: { companyId: company.id, source: 'AI' }, include: { evidence: true } })) {
      assert.equal(h.status, 'CANDIDATE');
      assert.ok(h.evidence.length > 0);
    }
    const events = (await prisma.client.domainEvent.findMany({ where: { workspaceId: ctx.workspaceId } })).map((e) => e.eventType);
    assert.equal(events.filter((e) => e === 'AgentTaskCompleted').length, 4);
    assert.ok(events.includes('CompanyAssessed'));

    // Same input again: every agent skips; no new model calls.
    const again = await runCompanyIntelligence(deps(), { workspaceId: ctx.workspaceId, companyId: company.id, inputKey });
    assert.ok(again.tasks.every((t) => t.status === 'SKIPPED'));
    assert.equal(await prisma.client.aiRun.count({ where: { workspaceId: ctx.workspaceId } }), 4);
  });

  test('no model, a disabled agent, a spent budget: tasks are BLOCKED with a decision saying why', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_websites');
    const { company, inputKey } = await researched(ctx, 'No Model Co');
    const none = await runCompanyIntelligence(deps(), { workspaceId: ctx.workspaceId, companyId: company.id, inputKey });
    assert.ok(none.tasks.filter((t) => t.status !== 'CANCELLED').every((t) => t.status === 'BLOCKED'));
    const d = await prisma.client.aiDecision.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, agentType: 'SCORING' } });
    assert.equal(d.decision, 'WAIT');
    assert.match(d.reasonSummary, /No AI model connected/);
    assert.equal(await prisma.client.companyAssessment.count({ where: { companyId: company.id } }), 0);

    await connect(ctx, 'fake_llm');
    await prisma.client.agentDefinition.update({ where: { workspaceId_agentType: { workspaceId: ctx.workspaceId, agentType: 'SCORING' } }, data: { enabled: false } });
    await prisma.client.agentDefinition.update({ where: { workspaceId_agentType: { workspaceId: ctx.workspaceId, agentType: 'CONTACT' } }, data: { dailyRunLimit: 0 } });
    const r = await runCompanyIntelligence(deps(), { workspaceId: ctx.workspaceId, companyId: company.id, inputKey: 'request:again' });
    const status = Object.fromEntries(r.tasks.map((t) => [t.agentType, t.status]));
    assert.equal(status.RESEARCH, 'COMPLETED');
    assert.equal(status.SCORING, 'BLOCKED');
    assert.equal(status.CONTACT, 'BLOCKED');
    const tasks = await prisma.client.agentTask.findMany({ where: { workspaceId: ctx.workspaceId, inputKey: 'request:again' } });
    assert.equal(tasks.find((t) => t.agentType === 'SCORING')?.failureCategory, 'POLICY_BLOCK');
    assert.equal(tasks.find((t) => t.agentType === 'CONTACT')?.failureCategory, 'BUDGET_BLOCK');
  });

  test('a model answer that fails validation is rejected and stored as such; nothing is applied', async () => {
    const ctx = await newWorkspace();
    for (const p of ['fake_websites', 'fake_llm'] as const) await connect(ctx, p);
    const llmRow = await prisma.client.integration.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, provider: 'fake_llm' } });
    const { company } = await researched(ctx, 'Bad Answer Co');
    const context = await buildCompanyContext(prisma.client, ctx.workspaceId, company.id);
    (runtime.factory.forIntegration(llmRow) as FakeLLMProvider).respondWith({
      summary: 'Call the owner at owner@made-up.example — they definitely need us.',
      known: [],
      gaps: [],
      nextSteps: [],
    });
    const r = await runAgentTask(deps(), researchAgent, context, 'redteam:1');
    assert.equal(r.status, 'FAILED');
    const run = await prisma.client.aiRun.findFirstOrThrow({ where: { agentTaskId: r.taskId! } });
    assert.equal(run.status, 'REJECTED');
    assert.equal(run.failureCategory, 'VALIDATION_FAILURE');
    const d = await prisma.client.aiDecision.findFirstOrThrow({ where: { agentTaskId: r.taskId! } });
    assert.equal(d.decision, 'BLOCK');
    assert.match(d.reasonSummary, /email we do not hold/);
  });

  test('least privilege: without the proposeHypothesis tool, an answer with hypotheses is blocked and nothing is stored', async () => {
    const ctx = await newWorkspace();
    for (const p of ['fake_websites', 'fake_llm'] as const) await connect(ctx, p);
    const llmRow = await prisma.client.integration.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, provider: 'fake_llm' } });
    const { company } = await researched(ctx, 'No Tool Co');
    const context = await buildCompanyContext(prisma.client, ctx.workspaceId, company.id);
    await runAgentTask(deps(), researchAgent, context, 'setup'); // creates the definitions
    await prisma.client.agentDefinition.upsert({
      where: { workspaceId_agentType: { workspaceId: ctx.workspaceId, agentType: 'WEB_AUDIT' } },
      create: { workspaceId: ctx.workspaceId, agentType: 'WEB_AUDIT', version: 1, modelClass: 'STANDARD', allowedTools: ['readCompanyContext'] },
      update: { allowedTools: ['readCompanyContext'] },
    });
    const evidenceId = context.evidence.find((e) => e.trust === 'OFFICIAL_WEBSITE')!.id;
    (runtime.factory.forIntegration(llmRow) as FakeLLMProvider).respondWith({
      summary: 'A short summary.',
      observations: [],
      hypotheses: [{ title: 'Needs reviews', hypothesis: 'They may benefit from showing reviews.', reason: 'No reviews shown.', confidence: 'LOW', evidenceIds: [evidenceId] }],
      uncertainties: [],
    });
    const r = await runAgentTask(deps(), webAuditAgent, context, 'redteam:tool');
    assert.equal(r.status, 'BLOCKED');
    assert.equal((await prisma.client.agentTask.findUniqueOrThrow({ where: { id: r.taskId! } })).failureCategory, 'POLICY_BLOCK');
    assert.equal(await prisma.client.opportunityHypothesis.count({ where: { companyId: company.id, source: 'AI' } }), 0);
  });

  test('prompt registry: each version recorded once; an edited prompt under the same version is refused', async () => {
    await syncPrompts(prisma.client, PROMPTS);
    await syncPrompts(prisma.client, PROMPTS); // idempotent
    const p = PROMPTS[0]!;
    assert.equal(await prisma.client.promptDefinition.count({ where: { agentType: p.agentType, taskType: p.taskType, version: p.version } }), 1);
    await assert.rejects(syncPrompts(prisma.client, [{ ...p, template: `${p.template}\nAlso be brief.` }]), PromptChangedError);
    await syncPrompts(prisma.client, [{ ...p, version: 99, template: `${p.template}\nAlso be brief.` }]);
    const rows = await prisma.client.promptDefinition.findMany({ where: { agentType: p.agentType, taskType: p.taskType }, orderBy: { version: 'asc' } });
    assert.deepEqual(rows.map((r) => [r.version, r.status]), [
      [1, 'RETIRED'],
      [99, 'ACTIVE'],
    ]);
    await prisma.client.promptDefinition.deleteMany({ where: { version: 99 } });
    await prisma.client.promptDefinition.updateMany({ where: { agentType: p.agentType, taskType: p.taskType, version: 1 }, data: { status: 'ACTIVE' } });
  });
});
