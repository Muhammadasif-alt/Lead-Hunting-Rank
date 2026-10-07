import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@revenue-os/database';

type Db = PrismaClient | Prisma.TransactionClient;

/** Key version written with each secret, so a future key rotation can tell old ciphertexts apart (docs/12 §19-30). */
export const CREDENTIAL_KEY_VERSION = 1;

export class CredentialKeyMissingError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not set — provider credentials cannot be stored or read');
  }
}

function key(base64: string | undefined): Buffer {
  if (!base64) throw new CredentialKeyMissingError();
  const k = Buffer.from(base64, 'base64');
  if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (base64)');
  return k;
}

/** AES-256-GCM: confidentiality and integrity — a tampered ciphertext fails to decrypt instead of yielding garbage. */
export function encryptSecret(value: unknown, encryptionKey: string | undefined): { ciphertext: string; iv: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

export function decryptSecret<T>(row: { ciphertext: string; iv: string; authTag: string }, encryptionKey: string | undefined): T {
  const decipher = createDecipheriv('aes-256-gcm', key(encryptionKey), Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.authTag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

/**
 * Encrypted credentials per integration. The plaintext exists only in memory while a provider call is made — never in
 * the API response, logs or AI context.
 */
export class CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly encryptionKey: string | undefined,
  ) {}

  async save(workspaceId: string, integrationId: string, value: unknown): Promise<void> {
    const enc = encryptSecret(value, this.encryptionKey);
    await this.db.integrationCredential.upsert({
      where: { integrationId },
      create: { workspaceId, integrationId, ...enc, keyVersion: CREDENTIAL_KEY_VERSION },
      update: { ...enc, keyVersion: CREDENTIAL_KEY_VERSION },
    });
  }

  async load<T>(integrationId: string): Promise<T | null> {
    const row = await this.db.integrationCredential.findUnique({ where: { integrationId } });
    return row ? decryptSecret<T>(row, this.encryptionKey) : null;
  }

  async remove(integrationId: string): Promise<void> {
    await this.db.integrationCredential.deleteMany({ where: { integrationId } });
  }
}
