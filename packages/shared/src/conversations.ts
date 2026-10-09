/**
 * Conversations + AI Inbox catalog (docs/17 §77-86, screen #5). Browser-safe: intents, categories and labels shared by
 * the API, the worker and the web app — plus the deterministic reading of a message that backs the Inbox Agent's test
 * model and the safety net around the real one (risk words always escalate, whatever a model says).
 */

export const INTENTS = [
  'POSITIVE',
  'QUESTION',
  'PRICING',
  'MEETING_REQUEST',
  'OBJECTION',
  'NOT_NOW',
  'REFERRAL',
  'WRONG_PERSON',
  'NEGATIVE',
  'UNSUBSCRIBE',
  'OUT_OF_OFFICE',
  'AUTOMATED',
  'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_INFO: Record<Intent, { label: string; description: string }> = {
  POSITIVE: { label: 'Interested', description: 'Positive about the idea' },
  QUESTION: { label: 'Question', description: 'Asks something before deciding' },
  PRICING: { label: 'Pricing', description: 'Asks about price, cost or a quote' },
  MEETING_REQUEST: { label: 'Wants a meeting', description: 'Asks for a call or a meeting' },
  OBJECTION: { label: 'Objection', description: 'A reason not to go ahead (already has someone, budget, timing…)' },
  NOT_NOW: { label: 'Not now', description: 'Maybe later — contact again at a better time' },
  REFERRAL: { label: 'Referral', description: 'Points to someone else to talk to' },
  WRONG_PERSON: { label: 'Wrong person', description: 'Not the right contact' },
  NEGATIVE: { label: 'Not interested', description: 'Declined' },
  UNSUBSCRIBE: { label: 'Unsubscribe', description: 'Asked not to be contacted — handled without AI discretion' },
  OUT_OF_OFFICE: { label: 'Out of office', description: 'Automatic away message — not a human reply' },
  AUTOMATED: { label: 'Automated', description: 'A system message (ticket received, no-reply…)' },
  UNKNOWN: { label: 'Unclear', description: 'Could not tell — a person should read it' },
};

/** Intents that are not a person talking to us — no reply, no new conversation. */
export const NON_HUMAN_INTENTS: readonly Intent[] = ['OUT_OF_OFFICE', 'AUTOMATED'];

export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'UNCERTAIN'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const RISK_FLAGS = ['LEGAL', 'REFUND', 'DISCOUNT', 'CUSTOM_PRICING', 'HUMAN_REQUESTED', 'ANGRY', 'COMMITMENT'] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];
export const RISK_INFO: Record<RiskFlag, string> = {
  LEGAL: 'Legal or contract question',
  REFUND: 'Refund or cancellation',
  DISCOUNT: 'Asks for a discount or a better deal',
  CUSTOM_PRICING: 'Asks for a custom price or quote',
  HUMAN_REQUESTED: 'Asked to talk to a person',
  ANGRY: 'Upset or complaining',
  COMMITMENT: 'Wants a promise (date, guarantee, result)',
};

export const OBJECTION_TYPES = ['ALREADY_HAS_SOLUTION', 'NO_BUDGET', 'TOO_EXPENSIVE', 'NO_TIME', 'TRIED_BEFORE', 'NO_NEED', 'OTHER'] as const;
export type ObjectionType = (typeof OBJECTION_TYPES)[number];
export const OBJECTION_INFO: Record<ObjectionType, string> = {
  ALREADY_HAS_SOLUTION: 'Already has a provider',
  NO_BUDGET: 'No budget',
  TOO_EXPENSIVE: 'Too expensive',
  NO_TIME: 'No time right now',
  TRIED_BEFORE: 'Tried something like it before',
  NO_NEED: 'Does not see a need',
  OTHER: 'Other',
};

/** What a prospect can tell us that is worth keeping (screen #5 §23, §30). Unknown stays unknown. */
export const EXTRACTION_FIELDS = ['NEED', 'TIMELINE', 'BUDGET', 'AUTHORITY', 'CURRENT_SOLUTION', 'MEETING_PREFERENCE', 'REFERRAL', 'RETURN_DATE', 'CONTACT_LATER'] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];
export const EXTRACTION_INFO: Record<ExtractionField, string> = {
  NEED: 'Need',
  TIMELINE: 'Timeline',
  BUDGET: 'Budget',
  AUTHORITY: 'Who decides',
  CURRENT_SOLUTION: 'Current solution',
  MEETING_PREFERENCE: 'Meeting preference',
  REFERRAL: 'Referred to',
  RETURN_DATE: 'Back in the office',
  CONTACT_LATER: 'Contact again',
};

export const INBOX_CATEGORIES = ['HIGH_INTENT', 'NEEDS_HUMAN', 'AI_HANDLING', 'MEETING', 'NURTURE', 'CLOSED'] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];
export const CATEGORY_INFO: Record<InboxCategory, { label: string; description: string }> = {
  HIGH_INTENT: { label: 'High intent', description: 'Interested, asking how it works — move fast' },
  NEEDS_HUMAN: { label: 'Needs you', description: 'Pricing, risk, unclear or taken over — a person acts' },
  AI_HANDLING: { label: 'Waiting / AI', description: 'We answered and wait for the prospect, or the AI is answering within policy' },
  MEETING: { label: 'Meeting', description: 'Asked for a call — a person books it' },
  NURTURE: { label: 'Nurture', description: 'Not now — snoozed until a better time' },
  CLOSED: { label: 'Closed', description: 'Resolved, declined or unsubscribed' },
};

export const CONVERSATION_MODES = ['AUTO', 'ASSIST', 'HUMAN'] as const;
export type ConversationMode = (typeof CONVERSATION_MODES)[number];
export const MODE_INFO: Record<ConversationMode, { label: string; description: string }> = {
  AUTO: { label: 'Auto', description: 'The AI replies on its own when the policy allows it; anything sensitive still goes to a person' },
  ASSIST: { label: 'Assist', description: 'The AI drafts, a person edits and sends' },
  HUMAN: { label: 'Human', description: 'A person handles it; the AI never replies (it still reads and suggests)' },
};

export const CONVERSATION_STAGES = ['REPLIED', 'ENGAGED', 'MEETING_REQUESTED', 'NURTURE', 'CLOSED', 'SUPPRESSED'] as const;
export type ConversationStage = (typeof CONVERSATION_STAGES)[number];
export const STAGE_INFO: Record<ConversationStage, string> = {
  REPLIED: 'Replied',
  ENGAGED: 'Engaged',
  MEETING_REQUESTED: 'Meeting requested',
  NURTURE: 'Nurture',
  CLOSED: 'Closed',
  SUPPRESSED: 'Unsubscribed',
};

// ───────────────────────────── deterministic reading ─────────────────────────────

export interface ExtractedFact {
  field: ExtractionField;
  value: string;
  /** The exact words in the message (provenance). */
  quote: string;
}

export interface MessageReading {
  primaryIntent: Intent;
  secondaryIntents: Intent[];
  sentiment: Sentiment;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  questions: string[];
  objections: { type: ObjectionType; text: string }[];
  riskFlags: RiskFlag[];
  extracted: ExtractedFact[];
  /** YYYY-MM-DD when an away message says when they are back. */
  returnDate: string | null;
  summary: string;
  needsHuman: boolean;
  reason: string;
}

/** Sentences of a plain-text message, trimmed (keeps the punctuation so quotes stay verbatim). */
export function sentencesOf(text: string): string[] {
  // Split after . ! ? followed by space, or at line breaks — not inside "acme.example" or "3.5".
  return text.replace(/\r/g, '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1);
}

const UNSUBSCRIBE = /\b(unsubscribe|remove me|take me off|stop (emailing|sending|contacting|messaging)|do not (email|contact|message)|don'?t (email|contact|message) me|opt[- ]?out)\b/i;
const OOO = /\b(out of (the )?office|away from (the )?office|on (vacation|holiday|annual leave|leave|parental leave)|automatic reply|auto[- ]?reply|limited access to (my )?email|back (in the office )?on)\b/i;
const AUTOMATED = /\b(this is an automated|do not reply to this|no-?reply|we have received your (message|email|request)|ticket (number|#)|your request has been received)\b/i;
const WRONG_PERSON = /\b(not the right person|wrong person|(i|we) (don'?t|do not) (handle|deal with|look after) (that|this|marketing|the website)|not my (area|department|call|decision)|no longer (work|with))\b/i;
const REFERRAL = /\b((you should|better to|please|best to) (contact|talk to|speak (to|with)|reach out to|email)|(contact|talk to|speak (to|with)|reach out to) (my|our) (partner|colleague|manager|boss|office manager|owner)|(he|she|they) (handles?|looks? after|is in charge))\b/i;
const NOT_NOW = /\b(not (right )?now|not at the moment|maybe later|not a priority|(next|in a few|in \d+|in a couple of) (weeks?|months?|quarter|year)|after (the )?(summer|holidays|season|new year)|reach out (again )?(in|after|later)|(check|circle) back|busy season|timing (isn'?t|is not) (right|great))\b/i;
const NEGATIVE = /\b(not interested|no,? thanks?|no thank you|we'?re (good|all set|fine)|(we|i) (don'?t|do not) need|not for us|please don'?t|pass on this)\b/i;
const PRICING = /\b(price|pricing|prices|cost|costs|how much|quote|rates?|fees?|charge|per month|packages?)\b/i;
const MEETING = /\b(call|meet|meeting|chat|zoom|teams|schedule|calendar|book a time|set up a time|available (on|at|this|next)|free (on|at|this|next)|let'?s talk|catch up)\b/i;
const POSITIVE = /\b(interested|sounds (good|great|interesting)|tell me (a bit |a little )?more|more (info|information|details)|keen|love to|happy to|yes,? please|go ahead|sure|that would be (great|helpful|good))\b/i;
const OBJECTIONS: [ObjectionType, RegExp][] = [
  ['ALREADY_HAS_SOLUTION', /\b(already (have|use|work with|got)|we use|we'?re using|currently (use|using|have|work with)|(have|got) (a|an|someone|somebody) (who|that|for))\b/i],
  ['TOO_EXPENSIVE', /\b(too expensive|can'?t afford|too much money|too pricey)\b/i],
  ['NO_BUDGET', /\b(no budget|budget is (tight|gone|spent)|not in (the|our) budget)\b/i],
  ['NO_TIME', /\b(no time|too busy|swamped|don'?t have (the )?time)\b/i],
  ['TRIED_BEFORE', /\b(tried (that|this|it|something)|didn'?t work (for us)?|bad experience)\b/i],
  ['NO_NEED', /\b(don'?t (really )?need|no need|we'?re fine|works (fine|well) for us|happy with (what|our))\b/i],
];
const RISKS: [RiskFlag, RegExp][] = [
  ['LEGAL', /\b(contract|lawyer|attorney|legal|liability|indemn|gdpr|terms and conditions|nda|sue)\b/i],
  ['REFUND', /\b(refund|money back|cancel(lation)? (fee|policy)|chargeback)\b/i],
  ['DISCOUNT', /\b(discount|cheaper|better (price|deal)|lower (the )?price|deal on|any (offer|deal))\b/i],
  ['CUSTOM_PRICING', /\b(custom (quote|price|pricing|package)|quote for|proposal for|bespoke)\b/i],
  ['HUMAN_REQUESTED', /\b(speak (to|with) (a|an actual|a real) (person|human)|real person|talk to (a|an actual) (person|human)|are you a (bot|robot|ai)|is this (automated|a bot|ai))\b/i],
  ['ANGRY', /\b(spam|stop spamming|harass|annoying|annoyed|report (you|this)|how did you get (my|this) (email|address)|ridiculous)\b/i],
  ['COMMITMENT', /\b(guarantee|can you promise|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)|deadline|how (soon|fast|quickly) can)\b/i],
];
const FACTS: [ExtractionField, RegExp][] = [
  ['CURRENT_SOLUTION', /\b(we use|we'?re using|already (have|use|work with)|currently (use|using|have|work with))\b/i],
  ['TIMELINE', /\b(next (week|month|quarter|year|spring|summer|autumn|fall|winter)|in (a|\d+|a few|a couple of) (weeks?|months?)|this (month|quarter|year)|asap|as soon as possible|urgent(ly)?|by (january|february|march|april|may|june|july|august|september|october|november|december))\b/i],
  ['BUDGET', /\bbudget\b/i],
  ['AUTHORITY', /\b(i'?m the owner|i own (the|this)|i make the decisions?|decision[- ]maker|(my|our) (partner|boss|manager|owner) (decides|makes the call)|need to (ask|check with|run it by))\b/i],
  ['NEED', /\b(we need|we'?re looking for|looking for|we want|struggling with|problem with|issue with|we'?ve been meaning to)\b/i],
  ['MEETING_PREFERENCE', /\b((monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|mornings?|afternoons?|evenings?|after \d|before \d|\d{1,2}(:\d{2})?\s?(am|pm))\b/i],
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * When an away message says they are back: "back on 14 October", "until October 14th", "returning Monday",
 * "back on 2026-10-14", "until 14/10". Returns null when there is no clear date — never a guess.
 */
export function parseReturnDate(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const isoMatch = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const near = /(back|return(ing)?|until|till|through|in the office|from)\b[^.\n]{0,40}/g;
  for (const m of t.matchAll(near)) {
    const s = m[0];
    const dm = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?( of)? (${MONTHS.join('|')})\\b|\\b(${MONTHS.join('|')}) (\\d{1,2})(st|nd|rd|th)?\\b`).exec(s);
    if (dm) {
      const day = Number(dm[1] ?? dm[6]);
      const month = MONTHS.indexOf((dm[4] ?? dm[5])!);
      let d = new Date(Date.UTC(now.getUTCFullYear(), month, day));
      if (d.getTime() < now.getTime() - 86_400_000) d = new Date(Date.UTC(now.getUTCFullYear() + 1, month, day));
      if (d.getUTCDate() === day) return iso(d);
    }
    const dd = /\b(\d{1,2})[/.](\d{1,2})\b/.exec(s);
    if (dd) {
      // Day/month as most of the world writes it; an impossible month means month/day.
      let [day, month] = [Number(dd[1]), Number(dd[2])];
      if (month > 12) [day, month] = [month, day];
      let d = new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));
      if (d.getTime() < now.getTime() - 86_400_000) d = new Date(Date.UTC(now.getUTCFullYear() + 1, month - 1, day));
      if (month >= 1 && month <= 12 && d.getUTCDate() === day) return iso(d);
    }
    const wd = new RegExp(`\\b(${DAYS.join('|')})\\b`).exec(s);
    if (wd) {
      const target = DAYS.indexOf(wd[1]!);
      const diff = ((target - now.getUTCDay() + 7) % 7) || 7;
      return iso(new Date(now.getTime() + diff * 86_400_000));
    }
  }
  return null;
}

/** "Contact me again in 3 months / next quarter / after the summer" → a date, or null. */
export function parseContactLater(text: string, now = new Date()): string | null {
  const t = text.toLowerCase();
  const n = /\bin (\d+|a|a few|a couple of) (week|month)s?\b/.exec(t);
  if (n) {
    const count = n[1] === 'a' ? 1 : n[1] === 'a few' ? 3 : n[1] === 'a couple of' ? 2 : Number(n[1]);
    return iso(new Date(now.getTime() + count * (n[2] === 'week' ? 7 : 30) * 86_400_000));
  }
  if (/\bnext quarter\b/.test(t)) return iso(new Date(now.getTime() + 90 * 86_400_000));
  if (/\bnext year|after the new year\b/.test(t)) return iso(new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 15)));
  if (/\bnext month\b/.test(t)) return iso(new Date(now.getTime() + 30 * 86_400_000));
  if (/\bafter the (summer|season)\b/.test(t)) return iso(new Date(now.getTime() + 75 * 86_400_000));
  return null;
}

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Reads one inbound message by rules: intents (primary + secondary), tone, the questions asked, objections, risk
 * words, and facts with the exact words they came from. Conservative — anything unclear asks a person.
 */
export function readMessage(input: { text: string; subject?: string; from?: string }, now = new Date()): MessageReading {
  const text = input.text.trim();
  const subject = input.subject ?? '';
  const sentences = sentencesOf(text);
  const found: Intent[] = [];
  const add = (i: Intent, hit: boolean) => {
    if (hit && !found.includes(i)) found.push(i);
  };

  add('UNSUBSCRIBE', UNSUBSCRIBE.test(text.slice(0, 500)) || /^\s*unsubscribe\s*$/i.test(subject));
  add('OUT_OF_OFFICE', OOO.test(subject) || (OOO.test(text) && text.length < 1200 && !/\?/.test(text)));
  add('AUTOMATED', AUTOMATED.test(text) || /^(no-?reply|noreply|do-not-reply)@/i.test(input.from ?? ''));
  add('REFERRAL', REFERRAL.test(text));
  add('WRONG_PERSON', WRONG_PERSON.test(text));
  add('NEGATIVE', NEGATIVE.test(text));
  add('NOT_NOW', NOT_NOW.test(text));
  add('MEETING_REQUEST', MEETING.test(text) && (/\?/.test(text) || /\b(let'?s|happy to|can we|could we|would like to|free|available)\b/i.test(text)));
  add('PRICING', PRICING.test(text));
  const objections = OBJECTIONS.flatMap(([type, re]) => {
    const s = sentences.find((x) => re.test(x));
    return s ? [{ type, text: s }] : [];
  }).slice(0, 3);
  add('OBJECTION', objections.length > 0);
  const questions = sentences.filter((s) => s.endsWith('?')).slice(0, 5);
  add('QUESTION', questions.length > 0);
  add('POSITIVE', POSITIVE.test(text));

  const ORDER: Intent[] = ['UNSUBSCRIBE', 'OUT_OF_OFFICE', 'AUTOMATED', 'REFERRAL', 'WRONG_PERSON', 'NEGATIVE', 'NOT_NOW', 'MEETING_REQUEST', 'PRICING', 'OBJECTION', 'QUESTION', 'POSITIVE'];
  const ordered = ORDER.filter((i) => found.includes(i));
  // "Not interested" next to a question is still a question about something; a refusal wins only on its own.
  let primary: Intent = ordered[0] ?? 'UNKNOWN';
  if (primary === 'NEGATIVE' && (found.includes('QUESTION') || found.includes('MEETING_REQUEST'))) primary = found.includes('MEETING_REQUEST') ? 'MEETING_REQUEST' : 'QUESTION';
  const secondary = ordered.filter((i) => i !== primary).slice(0, 4);
  const human = !NON_HUMAN_INTENTS.includes(primary);

  const riskFlags = human ? RISKS.filter(([, re]) => re.test(text)).map(([f]) => f) : [];
  if (primary === 'PRICING' && !riskFlags.includes('CUSTOM_PRICING') && /\b(quote|for (our|my|us))\b/i.test(text)) riskFlags.push('CUSTOM_PRICING');

  const extracted: ExtractedFact[] = [];
  if (human) {
    for (const [field, re] of FACTS) {
      if (field === 'MEETING_PREFERENCE' && !found.includes('MEETING_REQUEST')) continue;
      const s = sentences.find((x) => re.test(x));
      if (s) extracted.push({ field, value: s.replace(/[.!]+$/, '').slice(0, 200), quote: s });
    }
    if (found.includes('REFERRAL') || found.includes('WRONG_PERSON')) {
      const s = sentences.find((x) => EMAIL.test(x) || REFERRAL.test(x));
      if (s) extracted.push({ field: 'REFERRAL', value: (EMAIL.exec(s)?.[0] ?? s.replace(/[.!]+$/, '')).slice(0, 200), quote: s });
    }
    if (primary === 'NOT_NOW') {
      const s = sentences.find((x) => NOT_NOW.test(x));
      const when = s ? parseContactLater(s, now) : null;
      if (s && when) extracted.push({ field: 'CONTACT_LATER', value: when, quote: s });
    }
  }
  const returnDate = primary === 'OUT_OF_OFFICE' ? parseReturnDate(`${subject}\n${text}`, now) : null;
  if (returnDate) {
    const s = sentences.find((x) => /back|return|until|till/i.test(x));
    if (s) extracted.push({ field: 'RETURN_DATE', value: returnDate, quote: s });
  }

  const sentiment: Sentiment = !human
    ? 'NEUTRAL'
    : riskFlags.includes('ANGRY') || primary === 'NEGATIVE' || primary === 'UNSUBSCRIBE'
      ? 'NEGATIVE'
      : found.includes('POSITIVE') || primary === 'MEETING_REQUEST'
        ? 'POSITIVE'
        : primary === 'UNKNOWN'
          ? 'UNCERTAIN'
          : 'NEUTRAL';

  const reasons: string[] = [];
  if (riskFlags.length) reasons.push(riskFlags.map((f) => RISK_INFO[f]).join('; '));
  if (primary === 'PRICING') reasons.push('Pricing needs a person (no approved price list yet)');
  if (primary === 'MEETING_REQUEST') reasons.push('A person books the meeting');
  if (primary === 'REFERRAL' || primary === 'WRONG_PERSON') reasons.push('A person decides whether to contact the referred person');
  if (primary === 'UNKNOWN') reasons.push('Could not tell what they want');
  const needsHuman = reasons.length > 0;

  const confidence = primary === 'UNKNOWN' ? 'LOW' : primary === 'UNSUBSCRIBE' || primary === 'OUT_OF_OFFICE' || ordered.length === 1 ? 'HIGH' : 'MEDIUM';
  // The first sentence that says something ("Thanks." doesn't); a question beats small talk.
  const firstLine = questions[0] ?? sentences.find((s) => s.split(/\s+/).length >= 4) ?? sentences[0] ?? '';
  const summary = `${INTENT_INFO[primary].label}${secondary.length ? ` (+ ${secondary.map((i) => INTENT_INFO[i].label.toLowerCase()).join(', ')})` : ''}: "${firstLine.slice(0, 140)}"`.slice(0, 300);

  return { primaryIntent: primary, secondaryIntents: secondary, sentiment, confidence, questions, objections, riskFlags, extracted: extracted.slice(0, 8), returnDate, summary, needsHuman, reason: reasons.join('. ').slice(0, 300) };
}

/** Whitespace- and case-insensitive containment — a quote must really be in the message. */
export function quotedIn(quote: string, text: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  return q.length > 0 && norm(text).includes(q);
}
