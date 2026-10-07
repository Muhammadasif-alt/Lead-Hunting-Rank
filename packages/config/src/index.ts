import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Typed application config (Tech Spec #13, Phase 1).
 * Every app calls `loadConfig()` at startup; missing/invalid values fail fast with a clear message.
 */
const configSchema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_URL: z.url().default('http://localhost:3000'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    API_URL: z.url().default('http://localhost:4000'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    /** Human-readable logs. Defaults to on in development, off elsewhere (JSON for log tooling). */
    LOG_PRETTY: z.stringbool().optional(),
    DATABASE_URL: z.string().startsWith('postgresql://', 'must be a postgresql:// URL'),
    REDIS_URL: z.string().startsWith('redis://', 'must be a redis:// URL'),
    LLM_PROVIDER: z.enum(['fake', 'anthropic', 'openai']).default('fake'),
    LLM_API_KEY: z.string().optional(),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    /** 32-byte key, base64. Encrypts OAuth tokens / provider credentials at rest (Tech Spec #11). */
    ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded')
      .optional(),
    /** Google OAuth client (Gmail now, Calendar later). Without it Gmail can't be connected. */
    GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
    /** Must match the redirect URI registered in Google Cloud; defaults to API_URL + /api/v1/integrations/oauth/google/callback. */
    GOOGLE_OAUTH_REDIRECT_URL: z.url().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.APP_ENV === 'production' && !cfg.ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'required in production' });
    }
    if (cfg.GOOGLE_OAUTH_CLIENT_ID && (!cfg.GOOGLE_OAUTH_CLIENT_SECRET || !cfg.ENCRYPTION_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_OAUTH_CLIENT_ID'], message: 'needs GOOGLE_OAUTH_CLIENT_SECRET and ENCRYPTION_KEY too' });
    }
    if (cfg.LLM_PROVIDER !== 'fake' && !cfg.LLM_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: `required when LLM_PROVIDER=${cfg.LLM_PROVIDER}`,
      });
    }
  })
  .transform((cfg) => ({
    ...cfg,
    LOG_PRETTY: cfg.LOG_PRETTY ?? cfg.APP_ENV === 'development',
    GOOGLE_OAUTH_REDIRECT_URL: cfg.GOOGLE_OAUTH_REDIRECT_URL ?? `${cfg.API_URL.replace(/\/$/, '')}/api/v1/integrations/oauth/google/callback`,
  }));

/** The Google OAuth client, when fully configured. */
export function googleOAuthConfig(cfg: AppConfig): { clientId: string; clientSecret: string; redirectUri: string } | null {
  return cfg.GOOGLE_OAUTH_CLIENT_ID && cfg.GOOGLE_OAUTH_CLIENT_SECRET && cfg.ENCRYPTION_KEY
    ? { clientId: cfg.GOOGLE_OAUTH_CLIENT_ID, clientSecret: cfg.GOOGLE_OAUTH_CLIENT_SECRET, redirectUri: cfg.GOOGLE_OAUTH_REDIRECT_URL }
    : null;
}

export type AppConfig = z.output<typeof configSchema>;

/** Walks up from `startDir` to find the repo-root `.env` and loads it (existing env vars win). Returns its directory. */
function loadDotEnv(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

let cached: AppConfig | undefined;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const envDir = loadDotEnv(process.cwd());
  const parsed = parseConfig(process.env);
  // A relative storage path means "relative to the repo root (.env)", so API and worker share one directory.
  const storagePath = isAbsolute(parsed.STORAGE_LOCAL_PATH) ? parsed.STORAGE_LOCAL_PATH : resolve(envDir ?? process.cwd(), parsed.STORAGE_LOCAL_PATH);
  cached = { ...parsed, STORAGE_LOCAL_PATH: storagePath };
  return cached;
}

/** Validates a raw env object. Exported separately so it can be tested without touching process.env. */
export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  // Treat empty strings (e.g. `LLM_API_KEY=` in .env) as "not set".
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const result = configSchema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\nCopy .env.example to .env (or run \`pnpm setup\`) and fill in the values.`,
    );
  }
  return result.data;
}
