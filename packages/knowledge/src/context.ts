import type { MemoryScope } from '@revenue-os/database';
import { brainRules, memoryKeyInfo, type BrainRules, type KnowledgeAnswer, type KnowledgeContent, type KnowledgeControls, type KnowledgeRef } from '@revenue-os/shared';
import { answerQuestions } from './knowledge.js';
import { nowOf, type BrainDeps } from './deps.js';

export interface BrainMemory {
  id: string;
  key: string;
  label: string;
  value: string;
  origin: string;
  confidence: string;
  scope: MemoryScope;
  observedAt: string;
  /** False = internal reasoning only, never quoted to personalise (screen #12 §27). */
  outreach: boolean;
}

export interface BrainCommitment {
  id: string;
  direction: string;
  title: string;
  dueAt: string | null;
  status: string;
  overdue: boolean;
}

export interface BrainContext {
  memories: BrainMemory[];
  commitments: BrainCommitment[];
  memoryConflicts: { key: string; label: string; values: string[] }[];
  knowledge: {
    answers: KnowledgeAnswer[];
    semantic: boolean;
    controls: KnowledgeControls;
    rules: BrainRules;
    profile: { companyName: string; voice: string[]; prefer: string[]; avoid: string[]; always: string[]; never: string[] } | null;
    used: KnowledgeRef[];
    approvedItems: number;
  };
  /** "View AI context" (screen #12 §63): what was deliberately left out, and why. */
  notIncluded: { label: string; reason: string }[];
}

const ORDER = ['ROLE', 'NEED', 'TIMELINE', 'CURRENT_SOLUTION', 'PREFERRED_CHANNEL', 'MEETING_PREFERENCE', 'DECISION_PROCESS', 'BUDGET', 'OBJECTION', 'QUESTION', 'CONTACT_LATER', 'NOTE'];
const MAX_MEMORIES = 15;
const strings = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/**
 * Context Builder V2 (docs/17 §99-105, docs/13 §66-76): the least sufficient package for one conversation — memory
 * scoped to this company, this person, this conversation and THIS deal (never another deal's budget), open promises,
 * approved knowledge answering the questions asked, and the business's communication rules. Stale, conflicting and
 * other-scope memory is listed as not included rather than silently mixed in.
 */
export async function buildBrainContext(
  deps: BrainDeps,
  input: { workspaceId: string; companyId: string; personId: string | null; conversationId: string | null; opportunityId: string | null; questions: string[]; now?: Date },
): Promise<BrainContext> {
  const now = input.now ?? nowOf(deps);
  const scopes: { entityType: MemoryScope; entityId: string }[] = [{ entityType: 'COMPANY', entityId: input.companyId }];
  if (input.personId) scopes.push({ entityType: 'PERSON', entityId: input.personId });
  if (input.conversationId) scopes.push({ entityType: 'CONVERSATION', entityId: input.conversationId });
  if (input.opportunityId) scopes.push({ entityType: 'OPPORTUNITY', entityId: input.opportunityId });

  const [rows, otherDeals, commitments, conflicts, set] = await Promise.all([
    deps.db.memory.findMany({ where: { workspaceId: input.workspaceId, companyId: input.companyId, status: { in: ['ACTIVE', 'STALE', 'CONFLICTED'] }, OR: scopes }, orderBy: { observedAt: 'desc' }, take: 200 }),
    deps.db.memory.count({ where: { workspaceId: input.workspaceId, companyId: input.companyId, status: 'ACTIVE', entityType: 'OPPORTUNITY', ...(input.opportunityId ? { entityId: { not: input.opportunityId } } : {}) } }),
    deps.db.commitment.findMany({
      where: { workspaceId: input.workspaceId, companyId: input.companyId, status: { in: ['OPEN', 'WAITING', 'DUE'] }, ...(input.conversationId ? { OR: [{ conversationId: input.conversationId }, { conversationId: null }] } : {}) },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }],
      take: 10,
    }),
    deps.db.memoryConflict.findMany({ where: { workspaceId: input.workspaceId, companyId: input.companyId, status: 'OPEN' }, take: 10 }),
    answerQuestions(deps, input.workspaceId, input.questions, { now }),
  ]);

  const notIncluded: BrainContext['notIncluded'] = [];
  const active = rows.filter((m) => m.status === 'ACTIVE');
  for (const m of rows.filter((x) => x.status === 'STALE')) notIncluded.push({ label: m.summary, reason: 'Needs revalidation — too old to rely on' });
  for (const m of rows.filter((x) => x.status === 'CONFLICTED')) notIncluded.push({ label: memoryKeyInfo(m.key).label, reason: 'Conflicting values — a person resolves it first' });
  if (otherDeals) notIncluded.push({ label: `${otherDeals} ${otherDeals === 1 ? 'memory' : 'memories'} from other deals of this company`, reason: 'Kept apart — budgets and objections are per deal' });
  const rank = (k: string) => (ORDER.indexOf(k) === -1 ? ORDER.length : ORDER.indexOf(k));
  const chosen = [...active].sort((a, b) => rank(a.key) - rank(b.key) || b.observedAt.getTime() - a.observedAt.getTime());
  if (chosen.length > MAX_MEMORIES) notIncluded.push({ label: `${chosen.length - MAX_MEMORIES} older, lower-priority memories`, reason: 'Least context: low-value context is left out first' });

  const memoryIds = new Set(rows.map((r) => r.id));
  const conflictValues = conflicts
    .filter((c) => memoryIds.has(c.memoryAId) || memoryIds.has(c.memoryBId))
    .map((c) => ({ key: c.key, label: memoryKeyInfo(c.key).label, values: rows.filter((r) => r.id === c.memoryAId || r.id === c.memoryBId).map((r) => r.value) }));

  const profileItem = set.items.find((k) => k.type === 'PROFILE');
  const pc = (profileItem?.content ?? {}) as KnowledgeContent;
  for (const k of set.items.filter((x) => x.stale)) notIncluded.push({ label: `${k.code} ${k.title}`, reason: 'Knowledge past its review date — pricing/policy/integration answers go to a person' });
  const usedMap = new Map<string, KnowledgeRef>();
  for (const a of set.answers) for (const u of a.used) if (a.decision === 'ANSWER') usedMap.set(u.revisionId, u);

  return {
    memories: chosen.slice(0, MAX_MEMORIES).map((m) => ({ id: m.id, key: m.key, label: memoryKeyInfo(m.key).label, value: m.value, origin: m.origin, confidence: m.confidence, scope: m.entityType, observedAt: m.observedAt.toISOString(), outreach: m.useInOutreach })),
    commitments: commitments.map((c) => ({ id: c.id, direction: c.direction, title: c.title, dueAt: c.dueAt?.toISOString() ?? null, status: c.status, overdue: !!c.dueAt && c.dueAt < now })),
    memoryConflicts: conflictValues,
    knowledge: {
      answers: set.answers,
      semantic: set.semantic,
      controls: set.controls,
      rules: brainRules(set.items),
      profile: profileItem
        ? { companyName: String(pc.companyName ?? ''), voice: strings(pc.voiceTone), prefer: strings(pc.voicePrefer), avoid: strings(pc.voiceAvoid), always: strings(pc.communicationDo), never: strings(pc.communicationDont) }
        : null,
      used: [...usedMap.values()],
      approvedItems: set.items.length,
    },
    notIncluded,
  };
}
