import { RELATIONSHIP_INFO, SIGNAL_CATEGORY_INFO, SIGNAL_TYPES, type SignalListQuery } from '@revenue-os/shared';

/**
 * "Austin landscapers that added a new service recently" → structured filters (screen #9 search). Deterministic: the
 * phrases it understands are listed here, and every filter it applied is explained back to the person.
 */
const TYPE_PHRASES: [RegExp, string][] = [
  [/\blost deals?\b.*\brevisit|\brevisit\b/i, 'LOST_DEAL_REVISIT'],
  [/\bnew services?\b|\badded (a )?(new )?services?\b|\bservices? added\b/i, 'NEW_SERVICE'],
  [/\bnew locations?\b|\bnew (office|branch|area)s?\b/i, 'NEW_LOCATION'],
  [/\b(website (launched|launch)|launched (a )?website|new website)\b/i, 'WEBSITE_LAUNCHED'],
  [/\b(website (down|offline|unavailable)|site down)\b/i, 'WEBSITE_DOWN'],
  [/\b(redesign(ed)?|website changes?|changed (their )?website)\b/i, 'WEBSITE_CHANGE'],
  [/\b(booking|chat|technology|tech change)\b/i, 'TECH_CHANGE'],
  [/\b(follow[- ]?ups?|contact (me )?later|come back|callbacks?)\b/i, 'CONTACT_LATER_DUE'],
  [/\b(pric(e|ing)|quotes?|cost)\b/i, 'PRICING_ASKED'],
  [/\b(meeting|call) (request|asked)|asked for a (meeting|call)\b/i, 'MEETING_ASKED'],
  [/\bhiring\b|\bjob (openings|posts)\b/i, 'HIRING'],
  [/\b(leadership|new owner|new decision maker)\b/i, 'LEADERSHIP_CHANGE'],
  [/\bnew to (our )?dataset|newly found\b/i, 'NEW_TO_DATASET'],
  [/\b(replied after|dormant (prospect )?replied|came back)\b/i, 'DORMANT_REENGAGED'],
  [/\btimelines?\b/i, 'TIMELINE_STATED'],
];

const CATEGORY_PHRASES: [RegExp, string][] = [
  [/\b(expan(ding|sion)|growing|growth)\b/i, 'GROWTH'],
  [/\bwebsites?\b|\bdigital\b/i, 'DIGITAL'],
  [/\bpeople\b|\bstaff\b/i, 'PEOPLE'],
];

const RELATIONSHIP_PHRASES: [RegExp, NonNullable<SignalListQuery['relationship']>][] = [
  [/\b(old|dormant|former) prospects?\b|\bdormant\b/i, 'DORMANT'],
  [/\bformer customers?\b/i, 'FORMER_CUSTOMER'],
  [/\b(existing )?customers?\b|\bclients?\b/i, 'CUSTOMER'],
  [/\blost( deals?)?\b/i, 'LOST_DEAL'],
  [/\bopen deals?\b|\bin (the )?pipeline\b/i, 'OPEN_DEAL'],
  [/\bin conversation\b|\bwe(['’]re| are) talking to\b/i, 'IN_CONVERSATION'],
  [/\bcold\b|\bnew prospects?\b/i, 'COLD'],
];

export interface MarketRef {
  id: string;
  name: string;
  city: string | null;
}

export function parseSignalSearch(q: string, markets: MarketRef[]): { filters: SignalListQuery; explanation: string[] } {
  const text = q.trim();
  const filters: SignalListQuery = { status: 'OPEN' };
  const explanation: string[] = [];

  const type = TYPE_PHRASES.find(([re]) => re.test(text))?.[1];
  if (type) {
    filters.type = type;
    explanation.push(`Type: ${(SIGNAL_TYPES as Record<string, { label: string }>)[type]!.label}`);
  } else {
    const category = CATEGORY_PHRASES.find(([re]) => re.test(text))?.[1] as SignalListQuery['category'];
    if (category) {
      filters.category = category;
      explanation.push(`Category: ${SIGNAL_CATEGORY_INFO[category!].label}`);
    }
  }

  const lastN = /\blast (\d{1,3}) days?\b/i.exec(text);
  const days = lastN ? Number(lastN[1]) : /\btoday\b/i.test(text) ? 1 : /\b(this|last|past) week\b/i.test(text) ? 7 : /\b(this|last|past) month\b/i.test(text) ? 30 : /\brecent(ly)?\b|\blately\b/i.test(text) ? 14 : /\b(this|last|past) (quarter|3 months)\b/i.test(text) ? 90 : null;
  if (days) {
    filters.days = Math.min(days, 365);
    explanation.push(days === 1 ? 'Detected today (last 24 hours)' : `Detected in the last ${filters.days} days`);
  }

  if (/\bstrong(est)?\b/i.test(text)) filters.strength = 'STRONG';
  else if (/\bweak\b/i.test(text)) filters.strength = 'WEAK';
  else if (/\bmedium\b/i.test(text)) filters.strength = 'MEDIUM';
  if (filters.strength) explanation.push(`Strength: ${filters.strength.toLowerCase()}`);

  if (/\b(high icp|good fit|best fit|ideal (customer|fit)|icp fit)\b/i.test(text)) {
    filters.icp = 'HIGH';
    explanation.push('ICP fit: high');
  }

  // "lost deal revisit" is a type, not a relationship filter.
  const relationship = filters.type === 'LOST_DEAL_REVISIT' ? undefined : RELATIONSHIP_PHRASES.find(([re]) => re.test(text))?.[1];
  if (relationship) {
    filters.relationship = relationship;
    explanation.push(`Relationship: ${RELATIONSHIP_INFO[relationship].label}`);
  }

  const lower = text.toLowerCase();
  const market = markets.find((m) => lower.includes(m.name.toLowerCase())) ?? markets.find((m) => !!m.city && new RegExp(`\\b${m.city.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower));
  if (market) {
    filters.marketId = market.id;
    explanation.push(`Market: ${market.name}`);
  }

  if (/\bcampaign candidates?\b/i.test(text)) {
    filters.campaignCandidate = true;
    explanation.push('Campaign candidates only');
  }
  if (/\bpriority\b/i.test(text)) {
    filters.priority = true;
    explanation.push('In the priority queue');
  }
  if (/\b(all|history|including (closed|dismissed|expired))\b/i.test(text)) {
    filters.status = 'ALL';
    explanation.push('Including closed signals');
  } else explanation.push('Open signals only');

  if (explanation.length === 1 && text) {
    filters.q = text.slice(0, 200);
    explanation.unshift(`Company or title contains "${filters.q}"`);
  }
  return { filters, explanation };
}
