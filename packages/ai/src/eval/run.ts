import type { LLMProvider } from '@revenue-os/providers';
import { z } from 'zod';
import { LEVEL_RANK, type AgentSpec } from '../agent.js';
import type { ContactOutput } from '../agents/contact.js';
import type { ScoringOutput } from '../agents/scoring.js';
import { renderPrompt } from '../prompts.js';
import { AGENTS } from '../registry.js';
import { COMPANY_AGENTS } from '../runtime.js';
import { blockingFailures } from '../validators.js';
import { EVAL_CASES, type EvalCase } from './cases.js';

export interface EvalCheck {
  case: string;
  agent: string;
  ok: boolean;
  detail: string;
}

/**
 * AI evaluation harness (docs/08 §119-121, docs/17 §58-61): every agent on every synthetic case through the given model,
 * then the same validators production uses plus each case's expectations (grounding, no invented contacts, never
 * following page instructions, never choosing an INVALID email, never inflating contactability). Run it before a new
 * agent or prompt version goes live — with the test model in CI, with a real model by hand.
 */
export async function evaluateAgents(llm: LLMProvider, cases: EvalCase[] = EVAL_CASES, agents: AgentSpec<any, any>[] = COMPANY_AGENTS): Promise<EvalCheck[]> {
  const checks: EvalCheck[] = [];
  for (const c of cases) {
    for (const spec of agents) {
      const check = (ok: boolean, detail: string) => checks.push({ case: c.name, agent: spec.type, ok, detail });
      const skip = spec.skipReason(c.ctx);
      if (spec.type === 'WEB_AUDIT' && c.expect.webAuditSkipped !== undefined) check(!!skip === c.expect.webAuditSkipped, skip ? `skipped: ${skip}` : 'ran');
      if (skip) continue;
      const input = spec.input(c.ctx);
      const prompt = renderPrompt(spec.prompt, input, spec.type === 'WEB_AUDIT' ? c.ctx.untrusted : []);
      let output: unknown;
      try {
        const r = await llm.generateStructured(
          {
            modelClass: AGENTS[spec.type].modelClass,
            system: spec.prompt.system,
            prompt,
            schema: spec.schema,
            schemaName: spec.prompt.schemaName,
            jsonSchema: z.toJSONSchema(spec.schema) as Record<string, unknown>,
            simulated: () => spec.simulate(input, c.ctx),
          },
          { signal: AbortSignal.timeout(120_000) },
        );
        output = r.data;
      } catch (err) {
        check(false, `model call failed: ${(err as Error).message}`);
        continue;
      }
      const failures = blockingFailures(spec.validate(output, c.ctx));
      check(failures.length === 0, failures.length ? failures.map((f) => f.detail).join('; ') : 'validators passed');
      const text = JSON.stringify(output).toLowerCase();
      for (const bad of c.forbidden) check(!text.includes(bad.toLowerCase()), `must not repeat "${bad}"`);
      if (spec.type === 'CONTACT' && c.expect.contactRoute) {
        const route = (output as ContactOutput).bestRoute.type;
        check(c.expect.contactRoute.includes(route), `contact route ${route} (expected ${c.expect.contactRoute.join(' or ')})`);
      }
      if (spec.type === 'SCORING') {
        const dims = (output as ScoringOutput).dimensions;
        const level = (d: string) => dims.find((x) => x.dimension === d)?.level ?? 'UNKNOWN';
        if (c.expect.contactabilityAtMost) check(LEVEL_RANK[level('CONTACTABILITY')] <= LEVEL_RANK[c.expect.contactabilityAtMost], `contactability ${level('CONTACTABILITY')} ≤ ${c.expect.contactabilityAtMost}`);
        if (c.expect.opportunityAtLeast) check(LEVEL_RANK[level('OPPORTUNITY')] >= LEVEL_RANK[c.expect.opportunityAtLeast], `opportunity ${level('OPPORTUNITY')} ≥ ${c.expect.opportunityAtLeast}`);
      }
    }
  }
  return checks;
}

export function formatReport(checks: EvalCheck[]): string {
  const failed = checks.filter((c) => !c.ok);
  const lines = checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.agent.padEnd(9)} ${c.case} — ${c.detail}`);
  return [...lines, '', `${checks.length - failed.length}/${checks.length} checks passed`].join('\n');
}
