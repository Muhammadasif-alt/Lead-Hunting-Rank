import { z } from 'zod';
import type { AgentSpec } from '../agent.js';
import type { CompanyContext } from '../context.js';
import { BASE_RULES, type PromptTemplate } from '../prompts.js';
import { assertToolAllowed } from '../registry.js';
import { knownIds, noInventedContacts, type ValidationResult } from '../validators.js';

const Output = z.object({
  ranking: z.array(z.object({ personId: z.string(), relevance: z.enum(['HIGH', 'MEDIUM', 'LOW']), reason: z.string().min(1).max(240) })).max(10),
  bestRoute: z.object({
    type: z.enum(['PERSON_EMAIL', 'COMPANY_EMAIL', 'PHONE', 'CONTACT_FORM', 'NONE']),
    personId: z.string().nullable(),
    contactPointId: z.string().nullable(),
    reason: z.string().min(1).max(300),
  }),
  gaps: z.array(z.string().max(200)).max(5),
});
export type ContactOutput = z.infer<typeof Output>;

const prompt: PromptTemplate = {
  agentType: 'CONTACT',
  taskType: 'RANK_CONTACTS',
  version: 1,
  schemaName: 'ContactRecommendation',
  schemaVersion: 1,
  system: `${BASE_RULES}
You are the Contact Agent. Rank the people we found by how likely their role decides on buying local marketing or website services, and pick the best first contact route from the contact points listed. Never create or guess an email address. Role fit is not verified authority. A contact point with status INVALID must not be chosen.`,
  template: `Company context (trusted, structured):
{{context}}

Return:
- ranking: every person, with relevance (HIGH/MEDIUM/LOW) and a one-line reason.
- bestRoute: the type, and the personId / contactPointId it uses (null when not applicable), with a reason.
- gaps: what would improve contactability.`,
};

function input(ctx: CompanyContext) {
  return {
    company: { name: ctx.company.name, industry: ctx.company.industry, hasPhone: !!ctx.company.phone },
    people: ctx.people.map((p) => ({ personId: p.personId, name: p.name, title: p.title, roleConfidence: p.confidence, emails: p.emails })),
    companyContacts: ctx.companyContacts,
    contactForm: ctx.contactability.contactForm,
  };
}

const usable = (status: string) => status !== 'INVALID';

/** Contact Agent (docs/08 §22-24): candidate → role fit → route. No guessing, no verification claims. */
export const contactAgent: AgentSpec<ReturnType<typeof input>, ContactOutput> = {
  type: 'CONTACT',
  taskType: prompt.taskType,
  prompt,
  schema: Output,
  skipReason: (ctx) => (ctx.people.length || ctx.companyContacts.length || ctx.company.phone || ctx.contactability.contactForm ? null : 'No people or contact points found yet'),
  objective: (ctx) => `Pick who to reach first at ${ctx.company.name} and how`,
  input,
  simulate(_input, ctx) {
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const people = [...ctx.people].sort((a, b) => rank[a.relevance] - rank[b.relevance]);
    const ranking = people.map((p) => ({
      personId: p.personId,
      relevance: p.relevance,
      reason: `${p.title ?? 'Role unknown'}${p.confidence === 'LOW' ? ' (named on the website, not verified)' : ''}`,
    }));
    const verifiedFirst = (emails: { contactPointId: string; status: string }[]) => [...emails].filter((e) => usable(e.status)).sort((a, b) => Number(b.status === 'VERIFIED') - Number(a.status === 'VERIFIED'));
    let bestRoute: ContactOutput['bestRoute'] = { type: 'NONE', personId: null, contactPointId: null, reason: 'No usable contact point yet' };
    for (const p of people) {
      const email = verifiedFirst(p.emails)[0];
      if (email && (email.status === 'VERIFIED' || p.relevance === 'HIGH')) {
        bestRoute = { type: 'PERSON_EMAIL', personId: p.personId, contactPointId: email.contactPointId, reason: `${p.name} (${p.title ?? 'role unknown'}) has a ${email.status === 'VERIFIED' ? 'verified' : 'published but unverified'} email` };
        break;
      }
    }
    if (bestRoute.type === 'NONE') {
      const email = verifiedFirst(ctx.companyContacts.filter((c) => c.type === 'EMAIL'))[0];
      const phone = ctx.companyContacts.find((c) => c.type !== 'EMAIL' && c.type !== 'OTHER');
      if (email) bestRoute = { type: 'COMPANY_EMAIL', personId: null, contactPointId: email.contactPointId, reason: `Shared company inbox (${email.status === 'VERIFIED' ? 'verified' : 'not verified'})` };
      else if (phone || ctx.company.phone) bestRoute = { type: 'PHONE', personId: null, contactPointId: phone?.contactPointId ?? null, reason: 'Main business phone' };
      else if (ctx.contactability.contactForm) bestRoute = { type: 'CONTACT_FORM', personId: null, contactPointId: null, reason: 'Contact form on the website' };
    }
    const gaps = [
      ...(people.some((p) => p.relevance === 'HIGH') ? [] : ['No owner or founder identified']),
      ...(ctx.people.some((p) => p.emails.some((e) => e.status === 'VERIFIED')) ? [] : ['No verified personal email']),
    ];
    return { ranking, bestRoute, gaps };
  },
  validate(out, ctx) {
    const personIds = ctx.people.map((p) => p.personId);
    const points = [...ctx.companyContacts.map((c) => ({ ...c, owner: null as string | null })), ...ctx.people.flatMap((p) => p.emails.map((e) => ({ ...e, type: 'EMAIL', owner: p.personId })))];
    const r = out.bestRoute;
    const results: ValidationResult[] = [
      knownIds('ranking', out.ranking.map((x) => x.personId), personIds),
      knownIds('bestRoute', [r.personId], personIds),
      knownIds('bestRoute', [r.contactPointId], points.map((p) => p.contactPointId)),
      noInventedContacts('contact reasons', [r.reason, ...out.ranking.map((x) => x.reason), ...out.gaps].join(' '), ctx),
    ];
    const cp = points.find((p) => p.contactPointId === r.contactPointId);
    const bad = (detail: string) => results.push({ validator: 'route', ok: false, detail, blocking: true });
    if (cp && !usable(cp.status)) bad('The chosen contact point failed verification (INVALID)');
    if (r.type === 'PERSON_EMAIL' && (!cp || cp.owner !== r.personId)) bad('PERSON_EMAIL must use an email of that person');
    if (r.type === 'COMPANY_EMAIL' && (!cp || cp.owner !== null || cp.type !== 'EMAIL')) bad('COMPANY_EMAIL must use a company email');
    if (r.type === 'PHONE' && !ctx.company.phone && !(cp && cp.type !== 'EMAIL')) bad('PHONE chosen but no phone is on record');
    if (r.type === 'CONTACT_FORM' && ctx.contactability.contactForm !== true) bad('CONTACT_FORM chosen but no contact form was found');
    return results;
  },
  async apply(_tx, _sctx, out, ctx, ref) {
    assertToolAllowed(ref.def, 'proposeContactRoute');
    const cp = [...ctx.companyContacts, ...ctx.people.flatMap((p) => p.emails)].find((c) => c.contactPointId === out.bestRoute.contactPointId);
    return {
      decision: 'PROPOSE',
      actionType: 'RECOMMEND_CONTACT_ROUTE',
      confidence: cp?.status === 'VERIFIED' ? 'HIGH' : out.bestRoute.type === 'NONE' || out.bestRoute.type === 'CONTACT_FORM' ? 'LOW' : 'MEDIUM',
      risk: 'LOW',
      reasonSummary: out.bestRoute.reason,
      evidenceRefs: ctx.people.filter((p) => p.personId === out.bestRoute.personId).flatMap((p) => p.evidenceIds),
      uncertainties: out.gaps,
    };
  },
};
