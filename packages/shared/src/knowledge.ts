/**
 * Knowledge Base + Business Brain (docs/13 §30-65, screen #13). Browser-safe: the structured shape of every knowledge
 * type (one field spec drives validation and the edit form), the plain-text rendering, semantic chunking, and the
 * deterministic Answer Engine — what the AI may say from approved knowledge, and what it must hand to a person.
 *
 * The LLM is not a knowledge source (screen #13 §95): business truth comes from approved, current, enabled revisions.
 * Structured authority beats similarity; a conflict, a stale price or a missing answer means a person decides.
 */

export const KNOWLEDGE_TYPES = ['PROFILE', 'SERVICE', 'PRICING', 'FAQ', 'POLICY', 'INTEGRATION', 'CASE_STUDY', 'COMPETITOR', 'CLAIM', 'DOCUMENT', 'PROPOSAL_BLOCK'] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export interface KnowledgeTypeInfo {
  label: string;
  plural: string;
  /** KB-{code}-001 */
  code: string;
  /** 1 = approved policy … 6 = historical response (screen #13 §21). */
  authority: number;
  /** Default revalidation interval (docs/13 §58-65): pricing tighter than an evergreen description. */
  reviewDays: number;
  /** Pricing, policies and claims need commercial approval (screen #13 §59). */
  commercial: boolean;
  description: string;
}

export const KNOWLEDGE_TYPE_INFO: Record<KnowledgeType, KnowledgeTypeInfo> = {
  PROFILE: { label: 'Business profile', plural: 'Business profile', code: 'PRO', authority: 2, reviewDays: 365, commercial: false, description: 'Who we are, what we do, who we help, brand voice and communication rules' },
  SERVICE: { label: 'Service', plural: 'Services', code: 'SVC', authority: 2, reviewDays: 180, commercial: false, description: 'What we sell: ideal customer, capabilities, requirements, limitations, approved and prohibited claims' },
  PRICING: { label: 'Pricing', plural: 'Pricing', code: 'PRICE', authority: 2, reviewDays: 90, commercial: true, description: 'Structured prices with what the AI may explain, quote or never discount' },
  FAQ: { label: 'FAQ', plural: 'FAQs', code: 'FAQ', authority: 2, reviewDays: 180, commercial: false, description: 'Canonical question + approved answer, and when to escalate' },
  POLICY: { label: 'Policy', plural: 'Policies', code: 'POL', authority: 1, reviewDays: 180, commercial: true, description: 'Refunds, cancellation, payment, contracts, guarantees — exceptions go to a person' },
  INTEGRATION: { label: 'Integration', plural: 'Integrations', code: 'INT', authority: 2, reviewDays: 90, commercial: false, description: 'Exact support status (native … planned … not supported), conditions and limitations' },
  CASE_STUDY: { label: 'Case study', plural: 'Case studies', code: 'CS', authority: 2, reviewDays: 365, commercial: false, description: 'Documented outcomes with evidence and usage rights' },
  COMPETITOR: { label: 'Competitor', plural: 'Competitors', code: 'COMP', authority: 2, reviewDays: 90, commercial: false, description: 'Approved comparison points and what never to say' },
  CLAIM: { label: 'Claim', plural: 'Claims', code: 'CLAIM', authority: 2, reviewDays: 180, commercial: true, description: 'Approved claims with evidence — and prohibited claims the reply checker blocks' },
  DOCUMENT: { label: 'Document', plural: 'Documents', code: 'DOC', authority: 3, reviewDays: 365, commercial: false, description: 'Reference material (supporting, lower authority than structured knowledge)' },
  PROPOSAL_BLOCK: { label: 'Proposal block', plural: 'Proposal blocks', code: 'PB', authority: 3, reviewDays: 180, commercial: false, description: 'Reusable approved proposal sections' },
};

export const KNOWLEDGE_STATUS_INFO: Record<string, { label: string; description: string }> = {
  DRAFT: { label: 'Draft', description: 'Not used by the AI' },
  IN_REVIEW: { label: 'In review', description: 'Waiting for approval — not used by the AI' },
  APPROVED: { label: 'Approved', description: 'Current business truth the AI may use' },
  STALE: { label: 'Needs revalidation', description: 'Past its review date — pricing and policies go to a person until re-approved' },
  CONFLICT: { label: 'Conflict', description: 'Disagrees with other knowledge — the AI does not answer from it' },
  REJECTED: { label: 'Rejected', description: 'Not approved' },
  ARCHIVED: { label: 'Archived', description: 'No longer offered; history keeps its references' },
};

export const INTEGRATION_STATUSES = ['NATIVE', 'SUPPORTED', 'SUPPORTED_WITH_CONDITIONS', 'CUSTOM', 'PLANNED', 'NOT_SUPPORTED', 'UNKNOWN'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  NATIVE: 'Native',
  SUPPORTED: 'Supported',
  SUPPORTED_WITH_CONDITIONS: 'Supported with conditions',
  CUSTOM: 'Custom',
  PLANNED: 'Planned (not available yet)',
  NOT_SUPPORTED: 'Not supported',
  UNKNOWN: 'Unknown',
};

export const POLICY_TOPICS = ['REFUND', 'CANCELLATION', 'IMPLEMENTATION', 'SUPPORT', 'SERVICE_LEVELS', 'DATA_HANDLING', 'SECURITY', 'DISCOUNTS', 'PAYMENT', 'CONTRACT', 'TRIALS', 'GUARANTEES', 'OTHER'] as const;
export const POLICY_TOPIC_LABEL: Record<(typeof POLICY_TOPICS)[number], string> = {
  REFUND: 'Refunds',
  CANCELLATION: 'Cancellation',
  IMPLEMENTATION: 'Implementation',
  SUPPORT: 'Support',
  SERVICE_LEVELS: 'Service levels',
  DATA_HANDLING: 'Data handling',
  SECURITY: 'Security',
  DISCOUNTS: 'Discounts',
  PAYMENT: 'Payment terms',
  CONTRACT: 'Contract',
  TRIALS: 'Trials',
  GUARANTEES: 'Guarantees',
  OTHER: 'Other',
};

export const FAQ_CATEGORIES = ['GENERAL', 'PRICING', 'IMPLEMENTATION', 'INTEGRATIONS', 'SUPPORT', 'SECURITY', 'BILLING', 'TECHNICAL'] as const;
export const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'PKR', 'AED'] as const;
export const PRICE_TYPES = ['FIXED', 'STARTING_FROM', 'RANGE', 'CUSTOM'] as const;
export const BILLING = ['ONE_TIME', 'MONTHLY', 'YEARLY', 'HOURLY'] as const;
export const PROPOSAL_SECTIONS = ['OVERVIEW', 'SERVICE', 'SCOPE', 'DELIVERABLES', 'IMPLEMENTATION', 'SUPPORT', 'PRICING', 'TERMS', 'CASE_STUDIES', 'FAQ', 'NEXT_STEPS'] as const;

// ───────────────────────────── structure: one field spec per type ─────────────────────────────

export type FieldKind = 'text' | 'textarea' | 'list' | 'boolean' | 'select' | 'money' | 'number' | 'date' | 'rows';
export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  options?: readonly string[];
  help?: string;
  /** For `boolean`: the value a new item starts with. */
  default?: boolean | string;
  /** For `rows`: the columns of each row. */
  fields?: FieldSpec[];
}

const t = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind: 'text', ...extra });
const area = (key: string, label: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind: 'textarea', ...extra });
const list = (key: string, label: string, help?: string): FieldSpec => ({ key, label, kind: 'list', help });
const bool = (key: string, label: string, value: boolean, help?: string): FieldSpec => ({ key, label, kind: 'boolean', default: value, help });
const select = (key: string, label: string, options: readonly string[], extra: Partial<FieldSpec> = {}): FieldSpec => ({ key, label, kind: 'select', options, ...extra });

/** Structured knowledge, not one huge Markdown (docs/13 §30-42). The web form and the validator both read this. */
export const KNOWLEDGE_FIELDS: Record<KnowledgeType, FieldSpec[]> = {
  PROFILE: [
    t('companyName', 'Company name', { required: true }),
    list('whatWeDo', 'What we do'),
    list('markets', 'Primary markets'),
    list('regions', 'Regions served'),
    t('businessModel', 'Business model'),
    t('weHelp', 'We help', { help: 'Who, in a few words' }),
    list('with', 'With', 'The outcomes we help with'),
    list('weAreNot', 'We are NOT'),
    list('voiceTone', 'Brand voice'),
    list('voicePrefer', 'Preferred style'),
    list('voiceAvoid', 'Avoid'),
    list('communicationDo', 'Always do'),
    list('communicationDont', 'Never do'),
  ],
  SERVICE: [
    t('name', 'Service name', { required: true }),
    t('category', 'Category'),
    area('description', 'Overview', { required: true }),
    list('idealFor', 'Ideal for (strong fit)'),
    list('problems', 'Problems it addresses'),
    list('capabilities', 'Capabilities'),
    list('deliverables', 'Deliverables / included'),
    list('excluded', 'Not included'),
    list('requirements', 'Requirements'),
    list('optionalRequirements', 'Optional'),
    list('limitations', 'Limitations (what we cannot promise)'),
    area('process', 'Typical process'),
    list('markets', 'Available in', 'Leave empty for everywhere we serve'),
    bool('newSales', 'Open for new sales', true),
    list('approvedClaims', 'Approved claims'),
    list('prohibitedClaims', 'Prohibited claims', 'The reply checker blocks these'),
  ],
  PRICING: [
    t('name', 'Package / price name', { required: true }),
    select('currency', 'Currency', CURRENCIES, { required: true, default: 'USD' }),
    select('priceType', 'Price type', PRICE_TYPES, { required: true, default: 'FIXED' }),
    { key: 'price', label: 'Price (or minimum)', kind: 'money' },
    { key: 'maxPrice', label: 'Maximum (range only)', kind: 'money' },
    select('billing', 'Billing', BILLING, { default: 'ONE_TIME' }),
    t('quantityUnit', 'Priced per', { help: 'e.g. locations, pages, users — leave empty if not quantity-based' }),
    { key: 'includedQuantity', label: 'Included quantity', kind: 'number', help: 'How many the price covers' },
    { key: 'perExtraUnit', label: 'Price per extra unit', kind: 'money', help: 'Empty = more than included needs a person' },
    { key: 'maxQuantity', label: 'Above this: custom pricing', kind: 'number' },
    { key: 'addOns', label: 'Add-ons', kind: 'rows', fields: [t('name', 'Add-on', { required: true }), { key: 'price', label: 'Price (empty = custom)', kind: 'money' }, t('condition', 'Condition')] },
    list('conditions', 'Conditions'),
    t('customWhen', 'Needs a custom quote when'),
    list('paymentTerms', 'Payment terms'),
    t('market', 'Market', { help: 'e.g. USA — leave empty for all' }),
    bool('publiclyShareable', 'Publicly shareable', true),
    bool('aiMayExplain', 'AI may explain how pricing works', true),
    bool('aiMayQuote', 'AI may quote this price', false, 'Off = a person sends every quote'),
    { key: 'discounts', label: 'Approved discounts', kind: 'rows', fields: [t('name', 'Discount', { required: true }), { key: 'percent', label: '%', kind: 'number', required: true }, t('condition', 'Condition'), bool('aiMayMention', 'AI may mention', false)] },
  ],
  FAQ: [
    t('question', 'Question', { required: true }),
    area('answer', 'Approved answer', { required: true }),
    select('category', 'Category', FAQ_CATEGORIES, { default: 'GENERAL' }),
    list('alsoAskedAs', 'Also asked as', 'Other ways prospects ask it'),
    list('escalateIf', 'Escalate if'),
    list('allowedClaims', 'Allowed claims'),
  ],
  POLICY: [
    select('topic', 'Topic', POLICY_TOPICS, { required: true }),
    area('statement', 'Policy', { required: true }),
    bool('aiMayExplain', 'AI may explain this policy', true),
    bool('exceptionsNeedHuman', 'Exceptions need a person', true),
    list('escalateIf', 'Escalate if'),
  ],
  INTEGRATION: [
    t('name', 'System', { required: true }),
    select('status', 'Status', INTEGRATION_STATUSES, { required: true, default: 'UNKNOWN' }),
    select('integrationType', 'Integration type', ['API', 'WORKFLOW', 'ZAPIER', 'CUSTOM', 'OTHER']),
    list('aliases', 'Also known as'),
    list('capabilities', 'Capabilities'),
    list('conditions', 'Conditions'),
    list('limitations', 'Limitations'),
    list('setupRequirements', 'Setup requirements'),
  ],
  CASE_STUDY: [
    t('client', 'Client', { required: true }),
    t('anonymousName', 'Anonymous description', { help: 'e.g. "a landscaping company in Texas"' }),
    t('industry', 'Industry'),
    t('market', 'Market'),
    area('problem', 'Problem', { required: true }),
    area('solution', 'What we did'),
    area('outcome', 'Documented outcome', { required: true }),
    { key: 'metrics', label: 'Metrics', kind: 'rows', fields: [t('label', 'Metric', { required: true }), t('value', 'Value', { required: true }), t('evidence', 'Evidence / source')] },
    list('services', 'Services'),
    bool('internalUse', 'Internal sales use', true),
    bool('namedExternally', 'May be named externally', false),
    bool('anonymousReference', 'Anonymous reference allowed', true),
    bool('website', 'Website use', false),
  ],
  COMPETITOR: [
    t('name', 'Competitor', { required: true }),
    area('positioning', 'Known positioning'),
    list('knownCapabilities', 'Known capabilities'),
    list('differences', 'Our documented differences'),
    list('strongerAt', 'Where we are stronger'),
    list('theyAreStrongerAt', 'Where they are stronger'),
    list('notAFitWhen', 'When we are not a fit'),
    list('approvedStatements', 'Approved comparison statements', 'The only things the AI may say about them'),
    list('doNotSay', 'Do NOT say'),
    list('unknowns', 'Unknowns'),
  ],
  CLAIM: [
    select('kind', 'Kind', ['APPROVED', 'PROHIBITED'], { required: true, default: 'APPROVED' }),
    t('claim', 'Claim', { required: true }),
    area('evidence', 'Evidence', { help: 'Required for an approved claim' }),
    t('scope', 'Scope'),
    bool('salesUse', 'Sales conversations', true),
    bool('marketingUse', 'Website / marketing', false),
    bool('anonymousUse', 'Anonymous usage', true),
    { key: 'expiresAt', label: 'Expires', kind: 'date' },
  ],
  DOCUMENT: [t('summary', 'Summary'), area('body', 'Content', { required: true })],
  PROPOSAL_BLOCK: [select('section', 'Section', PROPOSAL_SECTIONS, { required: true }), area('body', 'Text', { required: true, help: 'Variables like {{company_name}} are filled from the deal and approved pricing' })],
};

export type KnowledgeContent = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(/[,\s$]/g, '')))) return Number(v.replace(/[,\s$]/g, ''));
  return null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []).map(str).filter(Boolean).slice(0, 50);

function normalizeField(f: FieldSpec, v: unknown): unknown {
  switch (f.kind) {
    case 'text':
    case 'textarea':
      return str(v).slice(0, f.kind === 'text' ? 300 : 20_000);
    case 'select':
      return f.options?.includes(str(v)) ? str(v) : typeof f.default === 'string' ? f.default : '';
    case 'list':
      return strings(v).map((s) => s.slice(0, 300));
    case 'boolean':
      return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : (f.default ?? false);
    case 'money': {
      const n = num(v);
      return n === null || n < 0 ? null : Math.round(n * 100) / 100;
    }
    case 'number': {
      const n = num(v);
      return n === null || n < 0 ? null : Math.round(n);
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null;
    case 'rows':
      return (Array.isArray(v) ? v : [])
        .slice(0, 30)
        .map((row) => Object.fromEntries((f.fields ?? []).map((c) => [c.key, normalizeField(c, (row as Record<string, unknown>)?.[c.key])])))
        .filter((row) => (f.fields ?? []).filter((c) => c.required).every((c) => row[c.key] !== '' && row[c.key] !== null));
  }
}

const empty = (v: unknown) => v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0);

/** Cleans the content to its type's shape and lists what is missing — the same rules in the form and on the server. */
export function validateKnowledge(type: KnowledgeType, input: KnowledgeContent): { content: KnowledgeContent; errors: string[] } {
  const content: KnowledgeContent = {};
  const errors: string[] = [];
  for (const f of KNOWLEDGE_FIELDS[type]) {
    content[f.key] = normalizeField(f, input?.[f.key]);
    if (f.required && empty(content[f.key])) errors.push(`${f.label} is required`);
  }
  if (type === 'PRICING') {
    const p = content as { priceType: string; price: number | null; maxPrice: number | null };
    if (p.priceType !== 'CUSTOM' && p.price === null) errors.push('Price is required unless the price type is custom');
    if (p.priceType === 'RANGE' && (p.maxPrice === null || (p.price !== null && p.maxPrice < p.price))) errors.push('A range needs a maximum above the minimum');
  }
  if (type === 'CLAIM' && content.kind === 'APPROVED' && empty(content.evidence)) errors.push('An approved claim needs its evidence');
  return { content, errors };
}

/** What an item is called (the title of its card), from its content. */
export function knowledgeTitle(type: KnowledgeType, c: KnowledgeContent, fallback = ''): string {
  const s = (k: string) => str(c[k]);
  switch (type) {
    case 'PROFILE':
      return s('companyName') || 'Business profile';
    case 'FAQ':
      return s('question');
    case 'POLICY':
      return POLICY_TOPIC_LABEL[s('topic') as keyof typeof POLICY_TOPIC_LABEL] ? `${POLICY_TOPIC_LABEL[s('topic') as keyof typeof POLICY_TOPIC_LABEL]} policy` : fallback || 'Policy';
    case 'CASE_STUDY':
      return s('client');
    case 'CLAIM':
      return s('claim');
    case 'PROPOSAL_BLOCK':
      return fallback || `${s('section').toLowerCase().replace(/_/g, ' ')} block`;
    case 'DOCUMENT':
      return fallback || s('summary').slice(0, 120) || 'Document';
    default:
      return s('name') || fallback;
  }
}

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: amount % 1 ? 2 : 0, minimumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

const BILLING_SUFFIX: Record<string, string> = { ONE_TIME: '', MONTHLY: ' per month', YEARLY: ' per year', HOURLY: ' per hour' };

/** Plain-text rendering: what search, chunks and the AI's context read. Field labels keep the meaning attached. */
export function renderKnowledgeText(type: KnowledgeType, c: KnowledgeContent): string {
  const lines: string[] = [];
  for (const f of KNOWLEDGE_FIELDS[type]) {
    const v = c[f.key];
    if (empty(v)) continue;
    if (f.kind === 'list') lines.push(`${f.label}: ${(v as string[]).join('; ')}`);
    else if (f.kind === 'boolean') lines.push(`${f.label}: ${v ? 'yes' : 'no'}`);
    else if (f.kind === 'money') lines.push(`${f.label}: ${formatMoney(v as number, str(c.currency) || 'USD')}`);
    else if (f.kind === 'rows') lines.push(`${f.label}: ${(v as Record<string, unknown>[]).map((r) => (f.fields ?? []).map((x) => (empty(r[x.key]) ? '' : x.kind === 'money' ? formatMoney(r[x.key] as number, str(c.currency) || 'USD') : x.kind === 'boolean' ? (r[x.key] ? x.label : '') : str(r[x.key]))).filter(Boolean).join(' — ')).join('; ')}`);
    else if (f.kind === 'select') lines.push(`${f.label}: ${str(v).replace(/_/g, ' ').toLowerCase()}`);
    else lines.push(`${f.label}: ${str(v)}`);
  }
  return lines.join('\n');
}

export interface KnowledgeChunkDraft {
  index: number;
  heading: string | null;
  content: string;
}

const MAX_CHUNK = 1200;

/** Long reference text cut at headings and paragraphs, packed up to ~1200 characters — never mid-sentence by count. */
function splitDocument(body: string): { heading: string | null; text: string }[] {
  const out: { heading: string | null; text: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ heading, text });
    buf = [];
  };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const h = /^#{1,4}\s+(.+)$/.exec(line) ?? (/^[A-Z][A-Z0-9 &/,'-]{3,60}$/.test(line.trim()) ? [line, line.trim()] : null);
    if (h) {
      flush();
      heading = h[1]!.trim();
      continue;
    }
    if (buf.join('\n').length + line.length > MAX_CHUNK && line.trim() === '') flush();
    else if (buf.join('\n').length + line.length > MAX_CHUNK * 1.5) flush();
    buf.push(line);
  }
  flush();
  return out;
}

/**
 * Semantic chunking (docs/13 §58-65): an FAQ is one chunk, a service is cut into overview / what's included / limits,
 * a document at its headings and paragraphs. Each chunk carries its item's title so it stands on its own.
 */
export function chunkKnowledge(type: KnowledgeType, title: string, c: KnowledgeContent): KnowledgeChunkDraft[] {
  const pick = (keys: string[]) =>
    renderKnowledgeText(type, Object.fromEntries(keys.map((k) => [k, c[k]])))
      .split('\n')
      .filter(Boolean)
      .join('\n');
  let parts: { heading: string | null; text: string }[];
  if (type === 'FAQ') parts = [{ heading: null, text: `Q: ${str(c.question)}${strings(c.alsoAskedAs).length ? ` (also: ${strings(c.alsoAskedAs).join('; ')})` : ''}\nA: ${str(c.answer)}` }];
  else if (type === 'SERVICE')
    parts = [
      { heading: 'Overview', text: pick(['name', 'category', 'description', 'idealFor', 'problems', 'process']) },
      { heading: 'What is included', text: pick(['capabilities', 'deliverables', 'requirements', 'optionalRequirements']) },
      { heading: 'Limits', text: pick(['excluded', 'limitations', 'markets', 'newSales']) },
    ];
  else if (type === 'DOCUMENT') parts = splitDocument(str(c.body));
  else parts = [{ heading: null, text: renderKnowledgeText(type, c) }];
  return parts
    .filter((p) => p.text.trim())
    .map((p, index) => ({ index, heading: p.heading, content: `${title}${p.heading ? ` — ${p.heading}` : ''}\n${p.text}`.slice(0, MAX_CHUNK * 2) }));
}

// ───────────────────────────── text features (keyword retrieval + the test embedder) ─────────────────────────────

const STOP = new Set(
  'a an the and or but if of to in on at by for with from about into over after before is are was were be been being do does did doing have has had having i me my we our ours us you your yours he she it its they them their this that these those there here what which who whom whose when where why how can could would should will shall may might must just so than then too very also any some all each both few more most other such only own same not no nor up down out off again further once am let get got please thanks thank hi hello hey really quite much many'.split(' '),
);

/** Same idea, different words (docs/13 screen §14: "How soon could we get this running?" finds "How long does setup take?"). */
const PHRASES: [RegExp, string][] = [
  [/\b(how (soon|long|quickly|fast)|turnaround|time ?frame|timeline|lead time)\b/g, ' time '],
  [/\b(set ?up|up and running|get (it|this|things|us) (running|going|live|started)|go live|onboard(ing)?|implement(ation|ed|ing)?|launch|get started|getting started)\b/g, ' setup '],
  [/\b(how much|cost|costs|price|prices|pricing|fees?|rates?|quote|charge|charges)\b/g, ' price '],
  [/\b(money back|refunds?|reimburse)\b/g, ' refund '],
  [/\b(cancel(lation|led|ing)?|terminate|end the contract)\b/g, ' cancel '],
  [/\b(integrat(e|es|ion|ions|ed|ing)|connect(s|ed|ing|ion)?|sync(s|ing|ed)?|plug ?in|compatible|work(s)? with)\b/g, ' integration '],
  [/\b(secure|security|safe|protect(ed|ion)?|encrypt(ed|ion)?)\b/g, ' security '],
  [/\b(support|help ?desk|assistance)\b/g, ' support '],
  [/\b(contract|agreement|terms)\b/g, ' contract '],
  [/\b(guarantee[ds]?|promise[ds]?|warranty)\b/g, ' guarantee '],
  [/\b(locations?|branches|sites|offices|stores)\b/g, ' location '],
  [/\b(websites?|web ?site|site|homepage|web pages?)\b/g, ' website '],
  [/\b(leads?|inquir(y|ies)|enquir(y|ies))\b/g, ' lead '],
];

function stem(w: string): string {
  if (w.length <= 4) return w;
  return w.replace(/(ings|ing|edly|ed|ies|es|s|ly)$/, (m) => (m === 'ies' ? 'y' : '')) || w;
}

/** Content words of a text, lower-cased, stemmed, synonyms folded together. */
export function textTokens(text: string): string[] {
  let s = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9$%'+.\s-]/g, ' ')} `;
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  return s
    .split(/[\s.\-]+/)
    .map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

/** Share of the question's content words found in the candidate (0–1); rarer words are not weighted — kept simple and explainable. */
export function keywordScore(question: string, candidate: string): number {
  const q = [...new Set(textTokens(question))];
  if (!q.length) return 0;
  const c = new Set(textTokens(candidate));
  return q.filter((w) => c.has(w)).length / q.length;
}

/** Normalised question — one gap for "How long does setup take?" and "how long does the setup take". */
export function questionKey(question: string): string {
  return [...new Set(textTokens(question))].sort().join(' ').slice(0, 200) || question.toLowerCase().trim().slice(0, 200);
}

/**
 * Deterministic test vectors (the Test AI model's EMBEDDINGS): hashed word + character-trigram features of the folded
 * tokens, L2-normalised. Not semantic like a real model — good enough to exercise retrieval end to end.
 */
export function testEmbedding(text: string, dimensions = 256): number[] {
  const v = new Array<number>(dimensions).fill(0);
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  for (const w of textTokens(text)) {
    v[hash(`w:${w}`) % dimensions]! += 2;
    for (let i = 0; i + 3 <= w.length; i++) v[hash(`t:${w.slice(i, i + 3)}`) % dimensions]! += 0.5;
  }
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ───────────────────────────── Answer Engine ─────────────────────────────

/** One approved, current revision as the Answer Engine sees it — already filtered for workspace and permissions. */
export interface ApprovedKnowledge {
  itemId: string;
  revisionId: string;
  code: string;
  type: KnowledgeType;
  title: string;
  version: number;
  content: KnowledgeContent;
  text: string;
  /** Past its review date. */
  stale: boolean;
  /** An open knowledge conflict involves it. */
  conflicted: boolean;
  serviceItemId: string | null;
  authorityLevel: number;
}

export interface KnowledgeControls {
  /** false = every pricing question goes to a person (screen #13 §92). */
  pricingAnswers: boolean;
  /** false = integration / security / technical claims go to a person. */
  technicalClaims: boolean;
}
export const DEFAULT_KNOWLEDGE_CONTROLS: KnowledgeControls = { pricingAnswers: true, technicalClaims: true };
export const knowledgeControlsOf = (v: unknown): KnowledgeControls => ({ ...DEFAULT_KNOWLEDGE_CONTROLS, ...((v ?? {}) as Partial<KnowledgeControls>) });

export const QUESTION_TOPICS = ['PRICING', 'DISCOUNT', 'INTEGRATION', 'POLICY', 'SECURITY', 'LEGAL', 'COMMITMENT', 'COMPETITOR', 'CASE_STUDY', 'GENERAL'] as const;
export type QuestionTopic = (typeof QUESTION_TOPICS)[number];
export const QUESTION_TOPIC_LABEL: Record<QuestionTopic, string> = {
  PRICING: 'Pricing',
  DISCOUNT: 'Discount',
  INTEGRATION: 'Integration',
  POLICY: 'Policy',
  SECURITY: 'Security',
  LEGAL: 'Legal / contract',
  COMMITMENT: 'Delivery promise',
  COMPETITOR: 'Competitor',
  CASE_STUDY: 'Proof / case study',
  GENERAL: 'General',
};

export interface KnowledgeRef {
  itemId: string;
  revisionId: string;
  code: string;
  version: number;
  title: string;
  type: KnowledgeType;
}

export interface KnowledgeAnswer {
  question: string;
  topic: QuestionTopic;
  decision: 'ANSWER' | 'ESCALATE';
  /** Approved wording the reply may use (an FAQ answer verbatim; a price computed from the structured record). */
  answer: string | null;
  /** Why — shown to people, never sent. */
  reason: string;
  /** Internal note (e.g. "last reviewed 8 months ago"). */
  caveat: string | null;
  used: KnowledgeRef[];
  conflicts: string[];
  /** Money amounts the answer states — the reply's pricing validator allows exactly these. */
  amounts: number[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** No approved knowledge for it → a knowledge gap. */
  gap: boolean;
}

export interface Candidate {
  k: ApprovedKnowledge;
  /** Best vector similarity of its chunks to the question (0–1), when embeddings are on. */
  semantic: number | null;
}

const refOf = (k: ApprovedKnowledge): KnowledgeRef => ({ itemId: k.itemId, revisionId: k.revisionId, code: k.code, version: k.version, title: k.title, type: k.type });

const LEGAL = /\b(contract|liabilit|indemn|terms and conditions|lawyer|attorney|nda|legal|clause|sue)\b/i;
const MODIFY = /\b(change|modify|amend|remove|waive|edit|redline|negotiate)\b/i;
const DISCOUNT = /\b(discount(s|ed)?|cheaper|better (price|deal)|lower (the )?price|any (offer|deal)s?|deal on|promo(tion)?s?)\b/i;
const CUSTOM_PRICE = /\b(do it for|would you (do|take|accept)|match (their|a) price|price match)\b|\b(for|at) [$€£]\s?\d/i;
const PRICING = /\b(price|pricing|prices|cost|costs|how much|quote|rates?|fees?|charge|per month|packages?|expensive|afford)\b/i;
const INTEGRATION = /\b(integrat\w*|connect\w*|sync\w*|plug ?in|compatible|work(s)? (with|alongside))\b/i;
const SECURITY = /\b(secur\w*|encrypt\w*|data (protect\w*|stored|hosted|residency|safe)|protect\w* (our|my) data|soc ?2|hipaa|gdpr|iso ?27001|pci|privacy|backups?)\b/i;
const COMMITMENT = /\b(guarantee\w*|promise\w*|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|end of (the )?(week|month))|deadline|finish(ed)? by|done by|ready by)\b/i;
const CASE = /\b(case stud\w*|examples?|references?|worked with (anyone|someone|other|similar|companies|businesses)|clients like|results (you'?ve|you have)|proof|testimonials?)\b/i;
const POLICY_WORDS: [(typeof POLICY_TOPICS)[number], RegExp][] = [
  ['REFUND', /\b(refund\w*|money back)\b/i],
  ['CANCELLATION', /\b(cancel\w*|terminat\w*|get out of|notice period)\b/i],
  ['PAYMENT', /\b(pay(ment)?s?( terms| plan)?|upfront|deposit|instal(l)?ments?|invoice|billing)\b/i],
  ['TRIALS', /\b(trial|try (it|before)|test (it|drive))\b/i],
  ['SUPPORT', /\b(support|help desk|response time|after launch|maintenance)\b/i],
  ['SERVICE_LEVELS', /\b(sla|uptime|service level)\b/i],
  ['GUARANTEES', /\b(guarantee\w*|warranty)\b/i],
  ['CONTRACT', /\b(contract|minimum term|lock[- ]?in|commitment period)\b/i],
  ['DATA_HANDLING', /\b(data|privacy|gdpr)\b/i],
  ['SECURITY', /\b(secur\w*|encrypt\w*)\b/i],
];
const EXCEPTION = /\b(exception|waive|make an exception|special case|bend the rule|just this once)\b/i;
const QTY = /\b(\d{1,4})\s*(locations?|branches|sites?|offices|stores|pages?|users?|seats?|accounts?|vans?|trucks?|technicians?)\b/i;
const NAMED_SYSTEM = /\b(?:integrat\w*|connect\w*|sync\w*|work\w*|compatible)\s+(?:with|to|into|alongside)\s+([A-Z][\w.+-]*(?:\s+(?:[A-Z0-9][\w.+-]*|v\d[\w.]*)){0,2})/;

/** Which kind of question this is — the engine routes structured questions to structured records first. */
export function questionTopic(question: string, competitorNames: string[] = []): QuestionTopic {
  if (LEGAL.test(question) && (MODIFY.test(question) || /\b(liabilit|indemn|clause)\b/i.test(question))) return 'LEGAL';
  if (COMMITMENT.test(question) && !/\bhow (long|soon)\b/i.test(question)) return 'COMMITMENT';
  if (DISCOUNT.test(question) || CUSTOM_PRICE.test(question)) return 'DISCOUNT';
  if (competitorNames.some((n) => n && new RegExp(`\\b${escapeRe(n)}\\b`, 'i').test(question))) return 'COMPETITOR';
  if (INTEGRATION.test(question)) return 'INTEGRATION';
  if (SECURITY.test(question)) return 'SECURITY';
  if (PRICING.test(question)) return 'PRICING';
  if (POLICY_WORDS.some(([, re]) => re.test(question)) && /\b(policy|refund|cancel|payment|pay|trial|contract|guarantee|sla|warranty|deposit|upfront)\w*/i.test(question)) return 'POLICY';
  if (CASE.test(question)) return 'CASE_STUDY';
  return 'GENERAL';
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const escalate = (question: string, topic: QuestionTopic, reason: string, extra: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer => ({
  question,
  topic,
  decision: 'ESCALATE',
  answer: null,
  reason,
  caveat: null,
  used: [],
  conflicts: [],
  amounts: [],
  confidence: 'HIGH',
  gap: false,
  ...extra,
});
const answered = (question: string, topic: QuestionTopic, answer: string, used: ApprovedKnowledge[], extra: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer => ({
  question,
  topic,
  decision: 'ANSWER',
  answer,
  reason: `Answered from ${used.map((k) => `${k.code} v${k.version}`).join(', ')}`,
  caveat: used.some((k) => k.stale) ? 'Past its review date — re-approve soon' : null,
  used: used.map(refOf),
  conflicts: [],
  amounts: [],
  confidence: 'HIGH',
  gap: false,
  ...extra,
});

/** Words that name this item (title, name, aliases) — for "Jobber", "Website Starter", "GoHighLevel". */
function namesOf(k: ApprovedKnowledge): string[] {
  const c = k.content;
  return [k.title, str(c.name), ...strings(c.aliases)].filter((n) => n && n.length >= 2);
}
const mentions = (text: string, name: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(name.toLowerCase())}([^a-z0-9]|$)`).test(text.toLowerCase());

function matchText(k: ApprovedKnowledge): string {
  const c = k.content;
  if (k.type === 'FAQ') return `${str(c.question)} ${strings(c.alsoAskedAs).join(' ')} ${str(c.question)}`;
  return `${k.title} ${k.text}`;
}

function scoreOf(question: string, cand: Candidate): number {
  const kw = keywordScore(question, matchText(cand.k));
  return cand.semantic === null ? kw : 0.55 * kw + 0.45 * Math.max(0, cand.semantic);
}

const THRESHOLD = 0.5;
const HIGH_RISK: KnowledgeType[] = ['PRICING', 'POLICY', 'INTEGRATION', 'CLAIM'];

/** A conflict or a stale high-authority item means a person decides — never "pick one" (docs/13 §66-76). */
function blocked(question: string, topic: QuestionTopic, k: ApprovedKnowledge): KnowledgeAnswer | null {
  if (k.conflicted) return escalate(question, topic, `Knowledge conflict on ${k.code} (${k.title}) — the AI does not choose between versions`, { conflicts: [`${k.code} ${k.title}`], used: [refOf(k)] });
  if (k.stale && HIGH_RISK.includes(k.type)) return escalate(question, topic, `${k.code} (${k.title}) is past its review date — re-approve it before the AI uses it`, { used: [refOf(k)] });
  return null;
}

function pricingAnswer(question: string, items: Candidate[], controls: KnowledgeControls): KnowledgeAnswer {
  const topic: QuestionTopic = 'PRICING';
  if (!controls.pricingAnswers) return escalate(question, topic, 'AI pricing answers are turned off — a person answers pricing');
  const pricing = items.filter((c) => c.k.type === 'PRICING');
  if (!pricing.length) return escalate(question, topic, 'No approved pricing — a person answers', { gap: true });
  const named = pricing.filter((c) => namesOf(c.k).some((n) => mentions(question, n)));
  const ranked = (named.length ? named : pricing).map((c) => ({ c, s: named.length ? 1 : scoreOf(question, c) })).sort((a, b) => b.s - a.s);
  let chosen: ApprovedKnowledge[];
  if (named.length) chosen = named.map((c) => c.k);
  else if (pricing.length === 1) chosen = [pricing[0]!.k];
  else if (ranked[0]!.s >= THRESHOLD && (ranked.length < 2 || ranked[0]!.s - ranked[1]!.s > 0.1)) chosen = [ranked[0]!.c.k];
  else if (pricing.length <= 3) chosen = pricing.map((c) => c.k);
  else return escalate(question, topic, 'Not clear which service they mean — a person clarifies', { confidence: 'MEDIUM' });

  const sentences: string[] = [];
  const amounts: number[] = [];
  for (const k of chosen) {
    const stop = blocked(question, topic, k);
    if (stop) return stop;
    const c = k.content as {
      name: string; currency: string; priceType: string; price: number | null; maxPrice: number | null; billing: string; quantityUnit: string;
      includedQuantity: number | null; perExtraUnit: number | null; maxQuantity: number | null; addOns: { name: string; price: number | null; condition: string }[];
      conditions: string[]; customWhen: string; paymentTerms: string[]; aiMayQuote: boolean; aiMayExplain: boolean;
    };
    const money = (n: number) => formatMoney(n, c.currency || 'USD');
    const suffix = BILLING_SUFFIX[c.billing] ?? '';
    if (c.priceType === 'CUSTOM') return escalate(question, topic, `${k.title} is custom-priced${c.customWhen ? ` (${c.customWhen})` : ''} — needs an assessment by a person`, { used: [refOf(k)] });
    if (!c.aiMayQuote) return escalate(question, topic, `The AI may not quote ${k.title} — a person sends the price`, { used: [refOf(k)] });
    // Quantity: compute only where an approved deterministic rule exists — otherwise DO NOT CALCULATE (screen #13 §10).
    const q = QTY.exec(question);
    let qtyNote = '';
    if (q && c.quantityUnit && stem(q[2]!.toLowerCase()).startsWith(stem(c.quantityUnit.toLowerCase()).slice(0, 4))) {
      const n = Number(q[1]);
      if (c.maxQuantity !== null && n > c.maxQuantity) return escalate(question, topic, `${n} ${c.quantityUnit} is above the approved range for ${k.title} (custom pricing above ${c.maxQuantity}) — a person quotes`, { used: [refOf(k)] });
      if (c.includedQuantity !== null && n > c.includedQuantity) {
        if (c.perExtraUnit === null || c.price === null || c.priceType !== 'FIXED') return escalate(question, topic, `No approved rule prices ${n} ${c.quantityUnit} for ${k.title} — a person quotes`, { used: [refOf(k)] });
        const total = Math.round((c.price + (n - c.includedQuantity) * c.perExtraUnit) * 100) / 100;
        qtyNote = `For ${n} ${c.quantityUnit} that is ${money(total)}${suffix} (${money(c.price)} covers ${c.includedQuantity}, plus ${money(c.perExtraUnit)} for each extra one).`;
        amounts.push(total, c.perExtraUnit);
      } else if (c.includedQuantity !== null) qtyNote = `That covers up to ${c.includedQuantity} ${c.quantityUnit}.`;
    }
    const base =
      c.priceType === 'FIXED'
        ? `${k.title} is ${money(c.price!)}${suffix}.`
        : c.priceType === 'STARTING_FROM'
          ? `${k.title} starts at ${money(c.price!)}${suffix}.`
          : `${k.title} is between ${money(c.price!)} and ${money(c.maxPrice!)}${suffix}.`;
    amounts.push(...[c.price, c.maxPrice].filter((x): x is number => x !== null));
    const parts = [base];
    if (qtyNote) parts.push(qtyNote);
    else if (c.includedQuantity !== null && c.quantityUnit) parts.push(`That covers up to ${c.includedQuantity} ${c.quantityUnit}.`);
    for (const a of c.addOns ?? []) {
      if (!mentions(question, a.name) && !textTokens(question).some((w) => textTokens(a.name).includes(w) && w.length > 3)) continue;
      if (a.price === null) return escalate(question, topic, `${a.name} is priced individually — a person quotes it`, { used: [refOf(k)] });
      parts.push(`${a.name} is ${money(a.price)}${a.condition ? ` (${a.condition})` : ''}.`);
      amounts.push(a.price);
    }
    if (/\b(pay|payment|upfront|deposit|instal|invoice)\w*/i.test(question) && c.paymentTerms?.length) parts.push(`Payment: ${c.paymentTerms.join('; ')}.`);
    sentences.push(parts.join(' '));
  }
  return answered(question, topic, sentences.join(' '), chosen, { amounts: [...new Set(amounts)] });
}

function discountAnswer(question: string, items: Candidate[], controls: KnowledgeControls): KnowledgeAnswer {
  const topic: QuestionTopic = 'DISCOUNT';
  if (CUSTOM_PRICE.test(question)) return escalate(question, topic, 'Asks for a custom price — the AI has no authority to agree a price', {});
  if (!controls.pricingAnswers) return escalate(question, topic, 'AI pricing answers are turned off');
  // The AI never invents or negotiates a discount; it may only mention one that is approved for it to mention.
  const mentionable = items
    .filter((c) => c.k.type === 'PRICING' && !c.k.conflicted && !c.k.stale)
    .flatMap((c) => ((c.k.content.discounts as { name: string; percent: number; condition: string; aiMayMention: boolean }[]) ?? []).filter((d) => d.aiMayMention).map((d) => ({ d, k: c.k })));
  if (!mentionable.length) return escalate(question, topic, 'Discount requests need a person (the AI has no discount authority)');
  const text = mentionable.map(({ d, k }) => `${d.name}: ${d.percent}% off ${k.title}${d.condition ? ` (${d.condition})` : ''}.`).join(' ');
  const lead = mentionable.length > 1 ? 'The discounts we offer are:' : 'The only discount we offer is:';
  return answered(question, topic, `${lead} ${text}`, [...new Set(mentionable.map((m) => m.k))], {
    amounts: mentionable.map((m) => m.d.percent),
  });
}

function integrationAnswer(question: string, items: Candidate[], controls: KnowledgeControls): KnowledgeAnswer {
  const topic: QuestionTopic = 'INTEGRATION';
  const integrations = items.filter((c) => c.k.type === 'INTEGRATION');
  const hit = integrations.filter((c) => namesOf(c.k).some((n) => mentions(question, n))).map((c) => c.k);
  const named = NAMED_SYSTEM.exec(question)?.[1]?.trim();
  if (!hit.length) {
    if (named || integrations.length) return escalate(question, topic, `No approved knowledge about ${named ?? 'that integration'} — a person answers`, { gap: true });
    return generalAnswer(question, items, controls, topic);
  }
  if (!controls.technicalClaims) return escalate(question, topic, 'AI technical claims are turned off — a person answers');
  const lines: string[] = [];
  for (const k of hit) {
    const stop = blocked(question, topic, k);
    if (stop) return stop;
    const c = k.content as { name: string; status: IntegrationStatus; capabilities: string[]; conditions: string[]; limitations: string[]; setupRequirements: string[] };
    const name = c.name || k.title;
    const caps = c.capabilities?.length ? ` It covers ${c.capabilities.slice(0, 3).join(', ').toLowerCase()}.` : '';
    switch (c.status) {
      case 'NATIVE':
      case 'SUPPORTED':
        lines.push(`Yes — we integrate with ${name}.${caps}`);
        break;
      case 'SUPPORTED_WITH_CONDITIONS':
        lines.push(`Yes, we work with ${name}${c.conditions?.length ? `, as long as ${c.conditions.join('; ').replace(/\.$/, '')}` : ' (with some conditions a colleague can walk you through)'}.${caps}`);
        break;
      case 'CUSTOM':
        lines.push(`${name} is possible as a custom integration — we scope it first.`);
        break;
      case 'PLANNED':
        lines.push(`Not yet — a ${name} integration is planned but not available today.`);
        break;
      case 'NOT_SUPPORTED':
        lines.push(`We don't integrate with ${name} today.`);
        break;
      default:
        return escalate(question, topic, `${name} support is unknown in the knowledge base — a person answers`, { used: [refOf(k)], gap: true });
    }
  }
  return answered(question, topic, lines.join(' '), hit);
}

function policyAnswer(question: string, items: Candidate[], controls: KnowledgeControls, topic: QuestionTopic): KnowledgeAnswer {
  if (EXCEPTION.test(question)) return escalate(question, topic, 'Asks for a policy exception — a person decides');
  if (topic === 'SECURITY' && !controls.technicalClaims) return escalate(question, topic, 'AI technical claims are turned off — a person answers');
  const wanted = POLICY_WORDS.filter(([, re]) => re.test(question)).map(([p]) => p);
  const policies = items.filter((c) => c.k.type === 'POLICY' && (wanted.includes(c.k.content.topic as never) || (topic === 'SECURITY' && ['SECURITY', 'DATA_HANDLING'].includes(String(c.k.content.topic)))));
  if (policies.length) {
    const k = policies.sort((a, b) => a.k.authorityLevel - b.k.authorityLevel)[0]!.k;
    const stop = blocked(question, topic, k);
    if (stop) return stop;
    if (k.content.aiMayExplain === false) return escalate(question, topic, `${k.title} may only be explained by a person`, { used: [refOf(k)] });
    return answered(question, topic, str(k.content.statement), [k]);
  }
  // A security / compliance question with no approved policy: an FAQ may answer it; otherwise a person (never a guess).
  return generalAnswer(question, items, controls, topic);
}

function generalAnswer(question: string, items: Candidate[], controls: KnowledgeControls, topic: QuestionTopic): KnowledgeAnswer {
  const pool = items.filter((c) => ['FAQ', 'SERVICE', 'POLICY', 'CASE_STUDY', 'COMPETITOR', 'CLAIM', 'DOCUMENT', 'PROFILE'].includes(c.k.type) && !(c.k.type === 'CLAIM' && c.k.content.kind === 'PROHIBITED'));
  const ranked = pool.map((c) => ({ c, s: scoreOf(question, c) })).filter((x) => x.s >= THRESHOLD);
  if (!ranked.length) return escalate(question, topic, 'No approved answer in the knowledge base — a person answers', { gap: true, confidence: 'HIGH' });
  // Authority beats similarity (docs/13 §100-113): the best-authority item above the bar wins; similarity breaks ties.
  ranked.sort((a, b) => a.c.k.authorityLevel - b.c.k.authorityLevel || b.s - a.s);
  const best = ranked[0]!;
  // A known conflict is said as such (not as "two answers fit").
  const conflictStop = blocked(question, topic, best.c.k);
  if (conflictStop && best.c.k.conflicted) return conflictStop;
  const rival = ranked.find((x) => x.c.k.itemId !== best.c.k.itemId && x.c.k.type === best.c.k.type && x.c.k.authorityLevel === best.c.k.authorityLevel && best.s - x.s < 0.05);
  if (rival && best.c.k.type === 'FAQ' && str(rival.c.k.content.answer) !== str(best.c.k.content.answer)) {
    return escalate(question, topic, `Two approved answers fit equally (${best.c.k.code}, ${rival.c.k.code}) — a person picks`, { confidence: 'MEDIUM', used: [refOf(best.c.k), refOf(rival.c.k)] });
  }
  const k = best.c.k;
  const stop = blocked(question, topic, k);
  if (stop) return stop;
  if ((topic === 'SECURITY' || topic === 'INTEGRATION') && !controls.technicalClaims) return escalate(question, topic, 'AI technical claims are turned off — a person answers');
  const c = k.content;
  const confidence = best.s >= 0.75 ? 'HIGH' : 'MEDIUM';
  switch (k.type) {
    case 'FAQ':
      if (strings(c.escalateIf).some((e) => keywordScore(e, question) >= 0.6)) return escalate(question, topic, `${k.code}: "${strings(c.escalateIf).find((e) => keywordScore(e, question) >= 0.6)}" — escalate`, { used: [refOf(k)] });
      return answered(question, topic, str(c.answer), [k], { confidence });
    case 'SERVICE': {
      const wantsIncluded = /\b(include|included|what do (i|we) get|deliverables?|what('?s| is) in)\b/i.test(question);
      const wantsLimits = /\b(can'?t|cannot|limit|not include|exclude)\w*/i.test(question);
      const bits = [str(c.description)];
      if (wantsIncluded && strings(c.deliverables).length) bits.push(`It includes ${strings(c.deliverables).join(', ').toLowerCase()}.`);
      else if (strings(c.capabilities).length) bits.push(`That covers ${strings(c.capabilities).slice(0, 4).join(', ').toLowerCase()}.`);
      if (wantsLimits && strings(c.limitations).length) bits.push(`What it doesn't do: ${strings(c.limitations).join('; ').toLowerCase()}.`);
      if (c.newSales === false) return escalate(question, topic, `${k.title} is not open for new sales`, { used: [refOf(k)] });
      return answered(question, topic, bits.join(' '), [k], { confidence });
    }
    case 'POLICY':
      if (c.aiMayExplain === false) return escalate(question, topic, `${k.title} may only be explained by a person`, { used: [refOf(k)] });
      return answered(question, topic, str(c.statement), [k], { confidence });
    case 'CASE_STUDY': {
      if (c.internalUse === false) return escalate(question, topic, `${k.title} is not cleared for sales use`, { used: [refOf(k)] });
      const name = c.namedExternally ? str(c.client) : c.anonymousReference !== false ? str(c.anonymousName) || `a ${str(c.industry) || 'similar'} business` : null;
      if (!name) return escalate(question, topic, `${k.title} may not be referenced externally`, { used: [refOf(k)] });
      return answered(question, topic, `We worked with ${name}: ${str(c.outcome).replace(/\.$/, '')}.`, [k], { confidence });
    }
    case 'COMPETITOR':
      if (!strings(c.approvedStatements).length) return escalate(question, topic, `No approved comparison statements for ${k.title}`, { used: [refOf(k)] });
      return answered(question, 'COMPETITOR', strings(c.approvedStatements).join(' '), [k], { confidence });
    case 'CLAIM':
      return answered(question, topic, str(c.claim), [k], { confidence });
    default:
      // Reference documents and the profile support context but are not quoted as approved answers.
      return escalate(question, topic, `Only reference material matches (${k.code}) — no approved answer; a person answers`, { gap: true, used: [refOf(k)], confidence: 'MEDIUM' });
  }
}

/**
 * The Answer Engine (screen #13 §15-16, §66; docs/13 §121-126): for one question, the approved answer the AI may give —
 * or ESCALATE with the reason. Structured records first (pricing, integrations, policies), then FAQs/services by
 * hybrid score with authority ahead of similarity. Missing knowledge is a gap; a conflict or a stale price is a person.
 */
export function answerQuestion(question: string, candidates: Candidate[], controls: KnowledgeControls = DEFAULT_KNOWLEDGE_CONTROLS): KnowledgeAnswer {
  const competitors = candidates.filter((c) => c.k.type === 'COMPETITOR').flatMap((c) => namesOf(c.k));
  const topic = questionTopic(question, competitors);
  switch (topic) {
    case 'LEGAL':
      return escalate(question, topic, 'Legal or contract changes always go to a person');
    case 'COMMITMENT':
      return escalate(question, topic, 'Asks for a promise (date, guarantee, result) — only a person can commit');
    case 'DISCOUNT':
      return discountAnswer(question, candidates, controls);
    case 'PRICING':
      return pricingAnswer(question, candidates, controls);
    case 'INTEGRATION':
      return integrationAnswer(question, candidates, controls);
    case 'POLICY':
    case 'SECURITY':
      return policyAnswer(question, candidates, controls, topic);
    case 'COMPETITOR': {
      const k = candidates.find((c) => c.k.type === 'COMPETITOR' && namesOf(c.k).some((n) => mentions(question, n)))?.k;
      if (!k) return escalate(question, topic, 'No approved comparison — a person answers', { gap: true });
      const stop = blocked(question, topic, k);
      if (stop) return stop;
      const statements = strings(k.content.approvedStatements);
      if (!statements.length) return escalate(question, topic, `No approved comparison statements for ${k.title} — a person answers`, { used: [refOf(k)], gap: true });
      return answered(question, topic, statements.join(' '), [k]);
    }
    default:
      return generalAnswer(question, candidates, controls, topic);
  }
}

/**
 * One message, several questions (screen #13 §51): "Can you integrate with Jobber and how much would it cost for 10
 * locations?" is answered part by part — the integration from knowledge, the custom price by a person.
 */
export function splitQuestions(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=\?)\s+/)
    .flatMap((p) => p.split(/,?\s+and\s+(?=(?:how|what|can|could|do|does|is|are|will|would|when|which|who|whats|what's)\b)/i))
    .map((p) => p.trim())
    .filter((p) => p.length > 3)
    .map((p) => (/[?.!]$/.test(p) ? p : `${p}?`))
    .slice(0, 6);
}

// ───────────────────────────── reply checks against the Business Brain ─────────────────────────────

/** Claims nobody may make without approved evidence (screen #13 §26, §46). */
const BUILT_IN_PROHIBITED: RegExp[] = [
  /\bguarantee[ds]? (#?1|first|top|number one|rank\w*|results?|revenue|leads?|more)\b/i,
  /\b(soc ?2|hipaa|iso ?27001|pci[- ]dss)( type (i|ii|1|2))? (certified|compliant|compliance)\b/i,
  /\bgdpr (certified|certification)\b/i,
  /\bworks with (every|any|all) (crm|system|tool|software)\b/i,
  /\b100% automated\b/i,
];

export interface BrainRules {
  /** Prohibited claims from CLAIM items, services and competitor "do not say" lists. */
  prohibited: string[];
  /** Approved claims (an approved claim can lift a built-in rule, e.g. "SOC 2 Type II certified" with evidence). */
  approved: string[];
}

export function brainRules(items: Pick<ApprovedKnowledge, 'type' | 'content'>[]): BrainRules {
  const prohibited: string[] = [];
  const approved: string[] = [];
  for (const k of items) {
    const c = k.content;
    if (k.type === 'CLAIM') (c.kind === 'PROHIBITED' ? prohibited : approved).push(str(c.claim));
    if (k.type === 'SERVICE') {
      prohibited.push(...strings(c.prohibitedClaims));
      approved.push(...strings(c.approvedClaims));
    }
    if (k.type === 'COMPETITOR') prohibited.push(...strings(c.doNotSay));
  }
  return { prohibited: prohibited.filter(Boolean), approved: approved.filter(Boolean) };
}

/** The first prohibited claim a text makes (normalised containment, or ≥ 80% of the claim's words in one sentence). */
export function prohibitedClaimIn(text: string, rules: BrainRules): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9%#$ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const body = norm(text);
  for (const p of rules.prohibited) {
    const n = norm(p.replace(/^["'✕x]\s*/i, ''));
    if (n.length < 4) continue;
    if (body.includes(n)) return p;
    const words = textTokens(p);
    if (words.length >= 3) {
      for (const s of text.split(/(?<=[.!?])\s+|\n+/)) {
        const sw = new Set(textTokens(s));
        if (words.filter((w) => sw.has(w)).length / words.length >= 0.8) return p;
      }
    }
  }
  for (const re of BUILT_IN_PROHIBITED) {
    const m = re.exec(text);
    if (m && !rules.approved.some((a) => norm(a).includes(norm(m[0])))) return m[0];
  }
  return null;
}

/** Money amounts in a text ($1,500 · 1500 USD · €99.50). */
export function moneyAmountsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:[$€£]|\b(?:usd|cad|aud|gbp|eur|pkr|aed|rs\.?)\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s?k\b)?/gi)) {
    let n = Number(m[1]!.replace(/,/g, '')) + (m[2] ? Number(`0.${m[2]}`) : 0);
    if (m[3]) n *= 1000;
    out.push(Math.round(n * 100) / 100);
  }
  for (const m of text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(usd|dollars|cad|aud|gbp|pounds|eur|euros)\b/gi)) out.push(Math.round((Number(m[1]!.replace(/,/g, '')) + (m[2] ? Number(`0.${m[2]}`) : 0)) * 100) / 100);
  return [...new Set(out)];
}

export function percentsIn(text: string): number[] {
  return [...text.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s?%/g)].map((m) => Number(m[1]));
}
