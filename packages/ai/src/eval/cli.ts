/**
 * `pnpm --filter @revenue-os/ai eval` — runs the AI evaluation harness.
 * Test model by default; with LLM_PROVIDER=anthropic and LLM_API_KEY set, against Claude (costs tokens).
 */
import { existsSync } from 'node:fs';
import { AnthropicProvider, FakeLLMProvider, type LLMProvider } from '@revenue-os/providers';
import { evaluateAgents, formatReport } from './run.js';

const rootEnv = new URL('../../../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const real = process.env.LLM_PROVIDER === 'anthropic' && process.env.LLM_API_KEY;
const llm: LLMProvider = real ? new AnthropicProvider({ apiKey: process.env.LLM_API_KEY! }) : new FakeLLMProvider();
console.log(`AI evaluation — model: ${real ? 'Anthropic Claude' : 'test model (rule-based answers)'}\n`);
const checks = await evaluateAgents(llm);
console.log(formatReport(checks));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
