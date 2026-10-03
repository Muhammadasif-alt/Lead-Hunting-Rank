import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * Typed application config (Tech Spec #13, Phase 1).
 * Every app calls `loadConfig()` at startup; missing/invalid values fail fast with a clear message.
 */
const configSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_URL: z.url().default('http://localhost:4000'),
  DATABASE_URL: z.string().startsWith('postgresql://', 'must be a postgresql:// URL'),
  REDIS_URL: z.string().startsWith('redis://', 'must be a redis:// URL'),
  LLM_PROVIDER: z.enum(['fake', 'anthropic', 'openai']).default('fake'),
  LLM_API_KEY: z.string().optional(),
});

export type AppConfig = z.infer<typeof configSchema>;

/** Walks up from `startDir` to find the repo-root `.env` and loads it (existing env vars win). */
function loadDotEnv(startDir: string): void {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  loadDotEnv(process.cwd());

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nCopy .env.example to .env (or run \`pnpm setup\`) and fill in the values.`,
    );
  }
  cached = result.data;
  return cached;
}
