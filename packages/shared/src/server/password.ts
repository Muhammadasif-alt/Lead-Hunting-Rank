import * as crypto from 'node:crypto';

/**
 * Password hashing with Argon2id (docs/15 §4-14) using Node's built-in implementation (Node ≥ 24.7) — no native
 * add-on to compile. Hashes are stored as PHC strings so parameters can be raised later without breaking old hashes.
 */

// @types/node doesn't describe crypto.argon2 yet.
type Argon2 = (
  algorithm: 'argon2id',
  params: { message: Buffer | string; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number },
  callback: (err: Error | null, derivedKey: Buffer) => void,
) => void;
const argon2 = (crypto as unknown as { argon2?: Argon2 }).argon2;

/** OWASP minimum for Argon2id: 19 MiB memory, 2 iterations, 1 lane. */
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 };

function derive(password: string, nonce: Buffer, p: typeof PARAMS): Promise<Buffer> {
  if (!argon2) return Promise.reject(new Error('This Node.js build has no crypto.argon2 — Node 24.7+ is required'));
  return new Promise((resolve, reject) =>
    argon2('argon2id', { message: password, nonce, ...p }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt, PARAMS);
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, 'base64');
  const actual = await derive(password, Buffer.from(m[4]!, 'base64'), {
    memory: Number(m[1]),
    passes: Number(m[2]),
    parallelism: Number(m[3]),
    tagLength: expected.length,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Pre-computed hash used to keep login timing the same when the email doesn't exist (no account enumeration). */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
}

const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'iloveyou',
  'letmein123', 'welcome123', 'admin12345', 'passw0rd', 'changeme', 'changeme123', 'football', 'baseball',
]);

/**
 * Length-based policy (docs/15): 10–256 chars, passphrases welcome, no composition rules. Rejects very common
 * passwords and ones that contain the email's name part. Returns a problem description, or null if acceptable.
 */
export function checkPasswordPolicy(password: string, email?: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters — a short phrase works well.';
  if (password.length > 256) return 'Use at most 256 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'This password is too common — choose something less guessable.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'Don’t include your email name in the password.';
  return null;
}
