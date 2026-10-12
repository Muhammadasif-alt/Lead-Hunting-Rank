import { createHash, randomUUID } from 'node:crypto';
import type { KnowledgeSource } from '@revenue-os/database';
import { actorUserId, writeAudit, type ServiceContext } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { describeError, questionKey, textTokens, ValidationError, type KnowledgeContent, type KnowledgeType } from '@revenue-os/shared';
import { createKnowledge } from './knowledge.js';
import { nowOf, systemCtx, TX, type BrainDeps } from './deps.js';

export const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
};
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function typeOf(fileName: string, contentType: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (DOCUMENT_TYPES[ext]) return DOCUMENT_TYPES[ext]!;
  return Object.values(DOCUMENT_TYPES).includes(contentType) ? contentType : null;
}

/**
 * Upload (docs/13 §47-57, screen #13 §18-19): the original goes to private object storage, the database keeps its
 * metadata, and processing starts through the outbox. Uploading "pricing-old-2024.pdf" changes nothing the AI says —
 * it only produces candidates for review. The same file twice is one source.
 */
export async function uploadDocument(deps: BrainDeps, ctx: ServiceContext, input: { fileName: string; contentType: string; data: Buffer }): Promise<{ source: KnowledgeSource; duplicate: boolean }> {
  const fileName = input.fileName.replace(/[\\/]/g, '_').trim().slice(0, 200) || 'document';
  const contentType = typeOf(fileName, input.contentType);
  if (!contentType) throw new ValidationError('Upload a PDF, DOCX, TXT, Markdown or CSV file');
  if (!input.data.length) throw new ValidationError('The file is empty');
  if (input.data.length > MAX_DOCUMENT_BYTES) throw new ValidationError(`Files up to ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`);
  const sha256 = createHash('sha256').update(input.data).digest('hex');
  const existing = await deps.db.knowledgeSource.findUnique({ where: { workspaceId_sha256: { workspaceId: ctx.workspaceId, sha256 } } });
  if (existing) return { source: existing, duplicate: true };

  const safe = fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 120) || 'document';
  const key = `knowledge/${randomUUID()}/${safe}`;
  const stored = await deps.providers.call({ workspaceId: ctx.workspaceId, capability: 'STORAGE', operation: 'knowledge.upload' }, (adapter, options) => adapter.put(key, input.data, contentType, options));
  const source = await deps.db.$transaction(async (tx) => {
    const s = await tx.knowledgeSource.create({
      data: { workspaceId: ctx.workspaceId, fileName, contentType, sizeBytes: input.data.length, sha256, storageKey: stored.value.key, storageIntegrationId: stored.integrationId, uploadedById: actorUserId(ctx) },
    });
    await recordEvent(tx, ctx, 'KnowledgeSourceAdded', s.id, { sourceId: s.id, contentType, sizeBytes: s.sizeBytes });
    await writeAudit(tx, ctx, { action: 'knowledge.document_uploaded', entityType: 'KNOWLEDGE_SOURCE', entityId: s.id, after: { fileName, contentType, sizeBytes: s.sizeBytes } });
    return s;
  }, TX);
  return { source, duplicate: false };
}

/** Plain text of a document. PDF via unpdf, DOCX via mammoth, text formats as UTF-8. */
export async function parseDocument(contentType: string, body: Buffer): Promise<string> {
  if (contentType === DOCUMENT_TYPES.pdf) {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(body));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n') : text;
  }
  if (contentType === DOCUMENT_TYPES.docx) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: body });
    return value;
  }
  return body.toString('utf8');
}

export interface DocumentCandidate {
  type: KnowledgeType;
  title: string;
  content: KnowledgeContent;
}

const PRICE_LINE = /^\s*[-•*]?\s*(.{3,80}?)\s*[:\-–—]\s*(starting at|starts at|from)?\s*([$€£])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(\/\s?(?:mo|month|yr|year|hr|hour)|per (?:month|year|hour)|monthly|yearly|one[- ]time)?/i;
const CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

/**
 * Candidates from a document (screen #13 §19): FAQs ("Q:/A:" or a question line followed by its answer), price lines,
 * and the whole text as reference material. Nothing here is approved — a person reviews every candidate; a price is
 * never quotable by the AI until someone turns that on.
 */
export function extractCandidates(text: string, fileName: string): DocumentCandidate[] {
  const out: DocumentCandidate[] = [];
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const q = /^(?:q(?:uestion)?\s*[:.)-]\s*)(.+)$/i.exec(line)?.[1] ?? (line.endsWith('?') && line.length >= 8 && line.length <= 200 ? line.replace(/^[-•*\d.)\s]+/, '') : null);
    if (q) {
      const answer: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j] === '') j++;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (!l || /^(?:q(?:uestion)?\s*[:.)-])/i.test(l) || (l.endsWith('?') && l.length <= 200)) break;
        answer.push(l.replace(/^(?:a(?:nswer)?\s*[:.)-]\s*)/i, ''));
      }
      if (answer.length && answer.join(' ').length >= 10) {
        out.push({ type: 'FAQ', title: q.slice(0, 200), content: { question: q.slice(0, 300), answer: answer.join(' ').slice(0, 4000), category: 'GENERAL' } });
        i = j - 1;
        continue;
      }
    }
    const p = PRICE_LINE.exec(line);
    if (p) {
      const name = p[1]!.replace(/[*_#]/g, '').trim();
      const price = Number(p[4]!.replace(/,/g, '')) + (p[5] ? Number(`0.${p[5]}`) : 0);
      const unit = (p[6] ?? '').toLowerCase();
      const billing = /mo|month/.test(unit) ? 'MONTHLY' : /yr|year/.test(unit) ? 'YEARLY' : /hr|hour/.test(unit) ? 'HOURLY' : 'ONE_TIME';
      if (name && !/^(total|subtotal|tax)$/i.test(name)) {
        out.push({ type: 'PRICING', title: name, content: { name, currency: CURRENCY[p[3]!] ?? 'USD', priceType: p[2] ? 'STARTING_FROM' : 'FIXED', price, billing, aiMayQuote: false, aiMayExplain: true, conditions: [`From ${fileName}: "${line.slice(0, 200)}"`] } });
      }
    }
  }
  const body = text.trim();
  if (body) out.push({ type: 'DOCUMENT', title: fileName.replace(/\.[a-z0-9]+$/i, '').slice(0, 200), content: { summary: `Uploaded document ${fileName}`, body: body.slice(0, 20_000) } });
  return out.slice(0, 40);
}

const norm = (s: string) => textTokens(s).join(' ');

/**
 * Processing job (docs/13 §47-57): parse → extract candidates → compare with approved knowledge. A candidate that
 * disagrees ("Pricing.pdf says $2,000, the approved price is $1,500") is a review item — the approved price keeps
 * answering. Idempotent: an already extracted source is skipped.
 */
export async function processDocument(deps: BrainDeps, job: { sourceId: string }) {
  const source = await deps.db.knowledgeSource.findUnique({ where: { id: job.sourceId } });
  if (!source) return { status: 'NOT_FOUND' };
  if (source.status === 'EXTRACTED' || source.status === 'ARCHIVED') return { status: source.status };
  const ctx = systemCtx(source.workspaceId);
  await deps.db.knowledgeSource.update({ where: { id: source.id }, data: { status: 'PROCESSING', statusReason: null } });
  const file = await deps.providers.call({ workspaceId: source.workspaceId, capability: 'STORAGE', operation: 'knowledge.read', ...(source.storageIntegrationId ? { integrationId: source.storageIntegrationId } : {}) }, (adapter, options) => adapter.get(source.storageKey, options));
  if (!file.value) return fail(deps, source, 'The stored file is missing');
  let text: string;
  try {
    text = (await parseDocument(source.contentType, file.value.body)).replace(/\u0000/g, '');
  } catch (err) {
    return fail(deps, source, `Could not read the file: ${describeError(err).slice(0, 200)}`);
  }
  if (!text.trim()) return fail(deps, source, 'No text found (a scanned PDF needs OCR, which is not supported yet)');

  const candidates = extractCandidates(text, source.fileName);
  const approved = await deps.db.knowledgeItem.findMany({ where: { workspaceId: source.workspaceId, archivedAt: null, currentRevisionId: { not: null }, type: { in: ['PRICING', 'FAQ'] } } });
  const approvedRevs = await deps.db.knowledgeRevision.findMany({ where: { id: { in: approved.map((a) => a.currentRevisionId!) } } });
  const revOf = new Map(approvedRevs.map((r) => [r.itemId, r]));
  const owner = source.uploadedById ? { ownerUserId: source.uploadedById } : {};
  let conflicts = 0;
  for (const c of candidates) {
    const { item, revision } = await createKnowledge(deps.db, ctx, { type: c.type, title: c.title, content: c.content, origin: 'DOCUMENT', sourceIds: [source.id], changeNote: `Extracted from ${source.fileName}`, ...owner });
    const clash = approved.find((a) => {
      const r = revOf.get(a.id);
      if (!r || a.type !== c.type) return false;
      const ac = r.content as KnowledgeContent;
      if (c.type === 'PRICING') return norm(String(ac.name)) === norm(String(c.content.name)) && ac.price !== c.content.price;
      if (c.type === 'FAQ') return questionKey(String(ac.question)) === questionKey(String(c.content.question)) && String(ac.answer).trim() !== String(c.content.answer).trim();
      return false;
    });
    if (clash) {
      conflicts++;
      await deps.db.$transaction(async (tx) => {
        const r = revOf.get(clash.id)!;
        const conflict = await tx.knowledgeConflict.create({
          data: {
            workspaceId: source.workspaceId,
            itemId: item.id,
            revisionId: revision.id,
            otherItemId: clash.id,
            otherRevisionId: r.id,
            sourceId: source.id,
            topic: c.type === 'PRICING' ? `${String(c.content.name)} pricing` : String(c.content.question).slice(0, 200),
            conflictType: c.type === 'PRICING' ? 'VALUE_CONFLICT' : 'DUPLICATE',
            detail: c.type === 'PRICING' ? `${source.fileName} says ${String(c.content.price)}; the approved ${clash.code} v${r.version} says ${String((r.content as KnowledgeContent).price)} — the approved price keeps answering until you decide` : `${source.fileName} answers "${String(c.content.question).slice(0, 80)}" differently from ${clash.code}`,
          },
        });
        await recordEvent(tx, ctx, 'KnowledgeConflictDetected', item.id, { conflictId: conflict.id, itemId: item.id, conflictType: conflict.conflictType });
      }, TX);
    }
  }
  const done = await deps.db.$transaction(async (tx) => {
    const s = await tx.knowledgeSource.update({ where: { id: source.id }, data: { status: 'EXTRACTED', textLength: text.length, candidates: candidates.length, conflicts, processedAt: nowOf(deps) } });
    await recordEvent(tx, ctx, 'KnowledgeSourceProcessed', source.id, { sourceId: source.id, status: 'EXTRACTED', candidates: candidates.length, conflicts });
    return s;
  }, TX);
  return { status: done.status, candidates: candidates.length, conflicts };
}

async function fail(deps: BrainDeps, source: KnowledgeSource, reason: string) {
  await deps.db.$transaction(async (tx) => {
    await tx.knowledgeSource.update({ where: { id: source.id }, data: { status: 'FAILED', statusReason: reason.slice(0, 300), processedAt: nowOf(deps) } });
    await recordEvent(tx, systemCtx(source.workspaceId), 'KnowledgeSourceProcessed', source.id, { sourceId: source.id, status: 'FAILED', candidates: 0, conflicts: 0 });
  }, TX);
  return { status: 'FAILED', reason };
}
