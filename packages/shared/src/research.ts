/**
 * Deterministic website research (docs/17 §52-57, docs/08 §25-27): read what a page says in machine-readable ways —
 * forms, booking and chat tools, social links, published emails and phones, technologies, copyright year — before any
 * AI is involved. Pure functions over HTML text: no network, no DOM, safe in the API, the worker and tests.
 *
 * Page content is untrusted data (docs/12 §50): nothing here follows instructions found on a page; text like "ignore
 * your previous instructions" is only flagged so later AI steps treat the page with suspicion.
 */

/** Bump when the checks change, so old audits stay explainable next to new ones. */
export const AUDIT_VERSION = 1;

export type TechnologyCategory = 'CMS' | 'ECOMMERCE' | 'BOOKING' | 'CHAT' | 'ANALYTICS' | 'MARKETING' | 'FORMS';

export interface DetectedTechnology {
  key: string;
  name: string;
  category: TechnologyCategory;
}

export interface SocialLink {
  platform: string;
  url: string;
  handle: string | null;
}

/** A person the page names with a role — what the page says, not a verified employment. */
export interface PersonMention {
  name: string;
  title: string;
  /** Only an address published on the page itself — never a guessed pattern. */
  email: string | null;
  excerpt: string;
}

export interface PageAnalysis {
  title: string | null;
  description: string | null;
  language: string | null;
  generator: string | null;
  hasViewport: boolean;
  hasForm: boolean;
  hasContactForm: boolean;
  booking: { provider: string; url: string | null } | null;
  chat: { provider: string } | null;
  technologies: DetectedTechnology[];
  socialLinks: SocialLink[];
  emails: string[];
  phones: string[];
  ctas: string[];
  copyrightYear: number | null;
  links: { contact: string | null; about: string | null };
  people: PersonMention[];
  /** The page contains text that tries to instruct a reader/AI. Kept as data; flagged for later AI steps. */
  untrustedInstructions: boolean;
  /** Visible text, whitespace-collapsed and capped. */
  text: string;
}

interface Signature extends DetectedTechnology {
  pattern: RegExp;
}

const SIGNATURES: Signature[] = [
  { key: 'wordpress', name: 'WordPress', category: 'CMS', pattern: /\/wp-content\/|\/wp-includes\//i },
  { key: 'wix', name: 'Wix', category: 'CMS', pattern: /static\.wixstatic\.com|static\.parastorage\.com/i },
  { key: 'squarespace', name: 'Squarespace', category: 'CMS', pattern: /static1\.squarespace\.com|assets\.squarespace\.com/i },
  { key: 'webflow', name: 'Webflow', category: 'CMS', pattern: /data-wf-page=|assets\.website-files\.com/i },
  { key: 'godaddy_builder', name: 'GoDaddy Website Builder', category: 'CMS', pattern: /img1\.wsimg\.com\/isteam/i },
  { key: 'shopify', name: 'Shopify', category: 'ECOMMERCE', pattern: /cdn\.shopify\.com|\.myshopify\.com/i },
  { key: 'calendly', name: 'Calendly', category: 'BOOKING', pattern: /calendly\.com\//i },
  { key: 'acuity', name: 'Acuity Scheduling', category: 'BOOKING', pattern: /acuityscheduling\.com/i },
  { key: 'housecall_pro', name: 'Housecall Pro', category: 'BOOKING', pattern: /housecallpro\.com/i },
  { key: 'jobber', name: 'Jobber', category: 'BOOKING', pattern: /getjobber\.com/i },
  { key: 'square_appointments', name: 'Square Appointments', category: 'BOOKING', pattern: /squareup\.com\/appointments|square\.site\/book/i },
  { key: 'setmore', name: 'Setmore', category: 'BOOKING', pattern: /setmore\.com/i },
  { key: 'simplybook', name: 'SimplyBook.me', category: 'BOOKING', pattern: /simplybook\.(?:me|it)/i },
  { key: 'tawk', name: 'tawk.to', category: 'CHAT', pattern: /embed\.tawk\.to/i },
  { key: 'intercom', name: 'Intercom', category: 'CHAT', pattern: /widget\.intercom\.io|js\.intercomcdn\.com/i },
  { key: 'drift', name: 'Drift', category: 'CHAT', pattern: /js\.driftt\.com/i },
  { key: 'tidio', name: 'Tidio', category: 'CHAT', pattern: /code\.tidio\.co/i },
  { key: 'livechat', name: 'LiveChat', category: 'CHAT', pattern: /cdn\.livechatinc\.com/i },
  { key: 'crisp', name: 'Crisp', category: 'CHAT', pattern: /client\.crisp\.chat/i },
  { key: 'zendesk_chat', name: 'Zendesk Chat', category: 'CHAT', pattern: /static\.zdassets\.com/i },
  { key: 'google_analytics', name: 'Google Analytics', category: 'ANALYTICS', pattern: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js/i },
  { key: 'google_tag_manager', name: 'Google Tag Manager', category: 'ANALYTICS', pattern: /googletagmanager\.com\/gtm\.js/i },
  { key: 'hotjar', name: 'Hotjar', category: 'ANALYTICS', pattern: /static\.hotjar\.com/i },
  { key: 'meta_pixel', name: 'Meta Pixel', category: 'MARKETING', pattern: /connect\.facebook\.net\/[^"']*\/fbevents\.js/i },
  { key: 'hubspot', name: 'HubSpot', category: 'MARKETING', pattern: /js\.hs-scripts\.com|js\.hsforms\.net/i },
  { key: 'mailchimp', name: 'Mailchimp', category: 'MARKETING', pattern: /list-manage\.com|chimpstatic\.com/i },
  { key: 'jotform', name: 'Jotform', category: 'FORMS', pattern: /jotform\.com/i },
  { key: 'typeform', name: 'Typeform', category: 'FORMS', pattern: /typeform\.com/i },
];

/** `<meta name="generator">` values → technology (WordPress / Wix / Squarespace write their name there). */
const GENERATORS: [RegExp, string][] = [
  [/wordpress/i, 'wordpress'],
  [/wix/i, 'wix'],
  [/squarespace/i, 'squarespace'],
  [/webflow/i, 'webflow'],
  [/shopify/i, 'shopify'],
];

const SOCIAL: { platform: string; pattern: RegExp }[] = [
  { platform: 'facebook', pattern: /^https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b)([A-Za-z0-9.\-_]+)\/?/i },
  { platform: 'instagram', pattern: /^https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|explore\/)([A-Za-z0-9._]+)\/?/i },
  { platform: 'linkedin', pattern: /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(company\/[A-Za-z0-9\-_%]+|in\/[A-Za-z0-9\-_%]+)\/?/i },
  { platform: 'x', pattern: /^https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home\b)([A-Za-z0-9_]+)\/?/i },
  { platform: 'youtube', pattern: /^https?:\/\/(?:www\.)?youtube\.com\/((?:@|channel\/|c\/|user\/)[A-Za-z0-9\-_.]+)\/?/i },
  { platform: 'tiktok', pattern: /^https?:\/\/(?:www\.)?tiktok\.com\/(@[A-Za-z0-9._]+)\/?/i },
  { platform: 'yelp', pattern: /^https?:\/\/(?:www\.)?yelp\.[a-z.]+\/biz\/([A-Za-z0-9\-_%]+)\/?/i },
  { platform: 'pinterest', pattern: /^https?:\/\/(?:www\.)?pinterest\.[a-z.]+\/([A-Za-z0-9_]+)\/?/i },
];

const CTA = /\b(free (?:quote|estimate|consultation|inspection)|get (?:a |your )?(?:free )?(?:quote|estimate)|request (?:a |an )?(?:quote|estimate|service|appointment|callback)|book (?:now|online|an appointment|a service|a consultation)|schedule (?:now|online|service|an appointment|a consultation)|call (?:us|now|today)|contact us|get started)\b/i;
const BOOKING_TEXT = /\b(?:book|schedule)\s+(?:online|now|an appointment|a service|a consultation)\b/i;
const INJECTION = /\b(?:ignore|disregard) (?:all |any |your |the )?(?:previous |prior |above )?(?:instructions|prompts?)\b|\byou are (?:an? )?(?:ai|assistant|language model)\b/i;

const TITLES = [
  'Co-Owner',
  'Owner',
  'Co-Founder',
  'Founder',
  'CEO',
  'President',
  'Managing Director',
  'General Manager',
  'Operations Manager',
  'Office Manager',
  'Marketing Manager',
  'Principal',
  'Director',
];
const TITLE_RE = TITLES.map((t) => t.replace('-', '[- ]')).join('|');
const NAME_RE = "[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?(?: [A-Z][a-z]+(?:[-'][A-Z][a-z]+)?){1,2}";
/** Capitalised words that start sentences/headings, not names ("Meet Our Team", "Call Today"). */
const NOT_NAME = new Set(
  'our the meet team about contact home services service call free get us we your and with for from to of in at by is are this that who what why how new best top local family owned operated since years experience customers quality licensed insured trusted serving area city county street avenue road copyright all rights reserved privacy policy terms read more learn view book schedule request quote estimate'.split(
    ' ',
  ),
);
const NOT_EMAIL = /\.(?:png|jpe?g|gif|svg|webp|css|js)$|^(?:you|your|name|email|user|someone|example)@|@(?:example\.com|domain\.com|email\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com)$/i;

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&copy;/g, '©')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function metaContent(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if ((attr(tag, 'name') ?? attr(tag, 'property'))?.toLowerCase() === key) return collapse(attr(tag, 'content') ?? '') || null;
  }
  return null;
}

/** Visible text: scripts, styles, comments and tags removed; block elements become line breaks. */
export function visibleText(html: string, max = 20_000): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/header|\/footer)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map(collapse)
    .filter(Boolean)
    .join('\n')
    .slice(0, max);
}

const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, '');

function absolute(href: string, base: string): URL | null {
  try {
    const url = new URL(href, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

interface Anchor {
  href: string;
  text: string;
}

function anchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${m[1]}>`, 'href');
    if (href) out.push({ href: href.trim(), text: collapse(decodeEntities(m[2]!.replace(/<[^>]+>/g, ' '))) });
  }
  return out;
}

export function analyzePage(html: string, pageUrl: string): PageAnalysis {
  const base = absolute(pageUrl, pageUrl)?.toString() ?? pageUrl;
  const host = absolute(base, base)?.hostname ?? '';
  const text = visibleText(html);
  const links = anchors(html);

  const title = collapse(decodeEntities(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')) || null;
  const generator = metaContent(html, 'generator');
  const language = attr(/<html\b[^>]*>/i.exec(html)?.[0] ?? '', 'lang');

  const technologies = new Map<string, DetectedTechnology>();
  for (const s of SIGNATURES) if (s.pattern.test(html)) technologies.set(s.key, { key: s.key, name: s.name, category: s.category });
  for (const [pattern, key] of GENERATORS) {
    const s = SIGNATURES.find((x) => x.key === key)!;
    if (generator && pattern.test(generator)) technologies.set(key, { key, name: s.name, category: s.category });
  }

  // Forms: any non-search form counts; a contact form asks for an email or phone plus a message/name.
  let hasForm = false;
  let hasContactForm = false;
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const body = m[2]!;
    const inputs = [...body.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)].map((x) => x[0]);
    const visible = inputs.filter((i) => !/type\s*=\s*["']?(?:hidden|submit|button)/i.test(i));
    const isSearch = /role\s*=\s*["']?search/i.test(m[1]!) || (visible.length === 1 && /name\s*=\s*["']?(?:s|q|search)["'\s>]/i.test(visible[0]!));
    if (isSearch || visible.length === 0) continue;
    hasForm = true;
    const asksContact = visible.some((i) => /type\s*=\s*["']?(?:email|tel)|name\s*=\s*["']?[^"'\s>]*(?:email|phone)/i.test(i));
    const asksMore = /<textarea\b/i.test(body) || visible.some((i) => /name\s*=\s*["']?[^"'\s>]*(?:name|message|service|details)/i.test(i));
    if (asksContact && asksMore) hasContactForm = true;
  }
  // An embedded form tool (HubSpot/Jotform/Typeform) is a contact form too.
  if (!hasContactForm && /js\.hsforms\.net|jotform\.com\/(?:jsform|\d)|form\.typeform\.com/i.test(html)) hasContactForm = hasForm = true;

  const bookingTech = [...technologies.values()].find((t) => t.category === 'BOOKING');
  const bookingLink = links.find((a) => (bookingTech && SIGNATURES.find((s) => s.key === bookingTech.key)!.pattern.test(a.href)) || (BOOKING_TEXT.test(a.text) && !/^(?:tel|mailto):/i.test(a.href)));
  const booking = bookingTech
    ? { provider: bookingTech.name, url: bookingLink ? (absolute(bookingLink.href, base)?.toString() ?? null) : null }
    : bookingLink
      ? { provider: 'Booking page on the website', url: absolute(bookingLink.href, base)?.toString() ?? null }
      : null;
  const chatTech = [...technologies.values()].find((t) => t.category === 'CHAT');

  const social = new Map<string, SocialLink>();
  for (const a of links) {
    const url = absolute(a.href, base);
    if (!url) continue;
    const clean = `https://${url.hostname.replace(/^(?:m|mobile)\./, 'www.')}${url.pathname}`.replace(/\/+$/, '');
    for (const s of SOCIAL) {
      const m = s.pattern.exec(clean + '/');
      if (m && !social.has(clean.toLowerCase())) social.set(clean.toLowerCase(), { platform: s.platform, url: clean, handle: m[1]!.replace(/^(?:company|in|channel|c|user)\//, '') });
    }
  }

  const emails = new Set<string>();
  for (const a of links) if (/^mailto:/i.test(a.href)) emails.add(decodeURIComponent(a.href.slice(7).split('?')[0]!).trim().toLowerCase());
  for (const m of text.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) emails.add(m[0].toLowerCase());
  const cleanEmails = [...emails].filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !NOT_EMAIL.test(e));

  const phones = [...new Set(links.filter((a) => /^tel:/i.test(a.href)).map((a) => decodeURIComponent(a.href.slice(4)).trim()).filter((p) => p.replace(/\D/g, '').length >= 7))];

  const ctas = new Set<string>();
  for (const m of html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = collapse(decodeEntities(m[2]!.replace(/<[^>]+>/g, ' ')));
    const hit = t.length <= 60 ? CTA.exec(t) : null;
    if (hit) ctas.add(hit[1]!.toLowerCase());
  }

  let copyrightYear: number | null = null;
  const thisYear = new Date().getUTCFullYear();
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–—]\s*)?(\d{4})/gi)) {
    const year = Number(m[1]);
    if (year >= 1995 && year <= thisYear + 1) copyrightYear = Math.max(copyrightYear ?? 0, year);
  }

  const sameSite = (a: Anchor) => {
    const url = absolute(a.href, base);
    return url && hostKey(url.hostname) === hostKey(host) ? url : null;
  };
  const pick = (re: RegExp) => {
    for (const a of links) {
      const url = sameSite(a);
      if (url && (re.test(url.pathname) || re.test(a.text)) && url.pathname !== new URL(base).pathname) return `${url.origin}${url.pathname}`;
    }
    return null;
  };

  return {
    title,
    description: metaContent(html, 'description') ?? metaContent(html, 'og:description'),
    language,
    generator,
    hasViewport: /<meta\b[^>]*name\s*=\s*["']?viewport[^>]*content\s*=\s*["'][^"']*width\s*=\s*device-width/i.test(html),
    hasForm,
    hasContactForm,
    booking,
    chat: chatTech ? { provider: chatTech.name } : null,
    technologies: [...technologies.values()],
    socialLinks: [...social.values()],
    emails: cleanEmails,
    phones,
    ctas: [...ctas].slice(0, 6),
    copyrightYear,
    links: { contact: pick(/contact/i), about: pick(/about|our-team|team|our-story|who-we-are/i) },
    people: findPeople(text, cleanEmails),
    untrustedInstructions: INJECTION.test(text),
    text,
  };
}

/** "Owner: Maria Lopez", "Maria Lopez — Founder", "founded by Maria Lopez". What the page claims, nothing more. */
export function findPeople(text: string, emails: string[] = []): PersonMention[] {
  const found = new Map<string, PersonMention>();
  const add = (raw: string, rawTitle: string, index: number) => {
    // "Meet Maria Lopez" / "Maria Lopez Call" → trim heading words around the name; anything left over rejects it.
    const words = raw.split(' ');
    while (words.length && NOT_NAME.has(words[0]!.toLowerCase())) words.shift();
    while (words.length && NOT_NAME.has(words.at(-1)!.toLowerCase())) words.pop();
    if (words.length < 2 || words.some((w) => NOT_NAME.has(w.toLowerCase()))) return;
    const name = words.join(' ');
    const title = TITLES.find((t) => new RegExp(`^${t.replace('-', '[- ]')}$`, 'i').test(rawTitle)) ?? rawTitle;
    const key = name.toLowerCase();
    if (found.has(key)) return;
    const first = words[0]!.toLowerCase();
    const last = words.at(-1)!.toLowerCase();
    // Only an address the page published that clearly belongs to this name (jane@, jane.doe@, jdoe@).
    const email = emails.find((e) => {
      const local = e.split('@')[0]!;
      return local === first || local === `${first}.${last}` || local === `${first}${last}` || local === `${first[0]}${last}` || local === `${first}_${last}`;
    });
    const excerpt = collapse(text.slice(Math.max(0, index - 40), index + name.length + rawTitle.length + 60));
    found.set(key, { name, title, email: email ?? null, excerpt });
  };
  const patterns: [RegExp, (m: RegExpMatchArray) => [string, string]][] = [
    [new RegExp(`\\b(${TITLE_RE})\\b\\s*(?:[:\\-–—|,])?\\s*(${NAME_RE})\\b`, 'g'), (m) => [m[2]!, m[1]!]],
    [new RegExp(`\\b(${NAME_RE})\\s*(?:[,\\-–—|(]\\s*)(?:our |the )?(${TITLE_RE})\\b`, 'g'), (m) => [m[1]!, m[2]!]],
    [new RegExp(`\\b([Ff]ounded|[Oo]wned|[Rr]un) by (${NAME_RE})\\b`, 'g'), (m) => [m[2]!, m[1]!.toLowerCase() === 'founded' ? 'Founder' : 'Owner']],
  ];
  for (const [re, get] of patterns) {
    for (const m of text.matchAll(re)) {
      const [name, title] = get(m);
      add(name, title, m.index ?? 0);
    }
  }
  return [...found.values()].slice(0, 10);
}

// ───────────────────────────── audit ─────────────────────────────

export type PageType = 'HOME' | 'CONTACT' | 'ABOUT';

export interface AnalyzedPage {
  pageType: PageType;
  url: string;
  finalUrl: string;
  analysis: PageAnalysis;
}

export const AUDIT_CHECKS = ['ssl', 'mobile', 'contact_form', 'booking', 'chat', 'cta', 'freshness'] as const;
export type AuditCheck = (typeof AUDIT_CHECKS)[number];

export interface AuditFinding {
  key: AuditCheck;
  label: string;
  /** null = could not tell from the pages we read. */
  observed: boolean | null;
  detail: string;
  url: string | null;
}

export interface WebsiteAuditResult {
  hasSsl: boolean | null;
  mobileReady: boolean | null;
  hasContactForm: boolean | null;
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasClearCta: boolean | null;
  copyrightYear: number | null;
  technologies: DetectedTechnology[];
  socialLinks: SocialLink[];
  emails: string[];
  phones: string[];
  people: PersonMention[];
  ctas: string[];
  findings: AuditFinding[];
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  pagesChecked: number;
  untrustedInstructions: boolean;
}

export const AUDIT_LABEL: Record<AuditCheck, string> = {
  ssl: 'Secure connection (https)',
  mobile: 'Mobile-friendly setup',
  contact_form: 'Contact form',
  booking: 'Online booking',
  chat: 'Live chat',
  cta: 'Clear call to action',
  freshness: 'Recently updated',
};

/** Years without a copyright update before a site counts as "may be outdated". */
export const OUTDATED_AFTER_YEARS = 3;

/** Combines the pages read from one site into deterministic checks, each pointing at the page that shows it. */
export function auditWebsite(pages: AnalyzedPage[], now = new Date()): WebsiteAuditResult {
  const home = pages.find((p) => p.pageType === 'HOME') ?? pages[0];
  const all = pages.map((p) => p.analysis);
  const first = <T>(pick: (a: PageAnalysis) => T | null | false | undefined) => {
    for (const p of pages) {
      const v = pick(p.analysis);
      if (v) return { value: v, url: p.finalUrl };
    }
    return null;
  };
  const uniq = <T>(items: T[], key: (t: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];

  const hasSsl = home ? home.finalUrl.startsWith('https://') : null;
  const viewport = home ? home.analysis.hasViewport : null;
  const form = first((a) => a.hasContactForm);
  const booking = first((a) => a.booking);
  const chat = first((a) => a.chat);
  const cta = first((a) => a.ctas.length > 0 && a.ctas);
  const years = all.map((a) => a.copyrightYear).filter((y): y is number => y !== null);
  const copyrightYear = years.length ? Math.max(...years) : null;
  const age = copyrightYear !== null ? now.getUTCFullYear() - copyrightYear : null;
  const homeUrl = home?.finalUrl ?? null;
  const checked = pages.map((p) => p.pageType.toLowerCase()).join(', ');

  const findings: AuditFinding[] = [
    {
      key: 'ssl',
      label: AUDIT_LABEL.ssl,
      observed: hasSsl,
      detail: hasSsl ? 'The site loads over https.' : 'The site loads over plain http — browsers mark it "Not secure".',
      url: homeUrl,
    },
    {
      key: 'mobile',
      label: AUDIT_LABEL.mobile,
      observed: viewport,
      detail: viewport ? 'The home page sets a mobile viewport.' : 'No mobile viewport setting on the home page — it may render as a shrunken desktop page on phones.',
      url: homeUrl,
    },
    {
      key: 'contact_form',
      label: AUDIT_LABEL.contact_form,
      observed: !!form,
      detail: form ? 'A form asks for contact details and a message.' : `No contact form on the pages checked (${checked}).`,
      url: form?.url ?? null,
    },
    {
      key: 'booking',
      label: AUDIT_LABEL.booking,
      observed: !!booking,
      detail: booking ? `Online booking via ${booking.value.provider}.` : `No booking tool or booking page on the pages checked (${checked}).`,
      url: booking?.value.url ?? booking?.url ?? null,
    },
    {
      key: 'chat',
      label: AUDIT_LABEL.chat,
      observed: !!chat,
      detail: chat ? `Live chat via ${chat.value.provider}.` : 'No live chat widget found.',
      url: chat?.url ?? null,
    },
    {
      key: 'cta',
      label: AUDIT_LABEL.cta,
      observed: !!cta,
      detail: cta ? `Buttons/links ask visitors to: ${cta.value.join(', ')}.` : 'No clear next step (quote, booking, call) in buttons or links.',
      url: cta?.url ?? null,
    },
    {
      key: 'freshness',
      label: AUDIT_LABEL.freshness,
      observed: age === null ? null : age < OUTDATED_AFTER_YEARS,
      detail: copyrightYear === null ? 'No copyright year on the pages checked — age unknown.' : `The footer copyright says ${copyrightYear}.`,
      url: homeUrl,
    },
  ];

  return {
    hasSsl,
    mobileReady: viewport,
    hasContactForm: pages.length ? !!form : null,
    hasBooking: pages.length ? !!booking : null,
    hasChat: pages.length ? !!chat : null,
    hasClearCta: pages.length ? !!cta : null,
    copyrightYear,
    technologies: uniq(all.flatMap((a) => a.technologies), (t) => t.key),
    socialLinks: uniq(all.flatMap((a) => a.socialLinks), (s) => s.url.toLowerCase()),
    emails: [...new Set(all.flatMap((a) => a.emails))],
    phones: [...new Set(all.flatMap((a) => a.phones))],
    people: uniq(all.flatMap((a) => a.people), (p) => p.name.toLowerCase()),
    ctas: [...new Set(all.flatMap((a) => a.ctas))],
    findings,
    confidence: pages.length >= 2 ? 'HIGH' : pages.length === 1 ? 'MEDIUM' : 'LOW',
    pagesChecked: pages.length,
    untrustedInstructions: all.some((a) => a.untrustedInstructions),
  };
}

// ───────────────────────────── opportunity hypotheses ─────────────────────────────

export const HYPOTHESIS_KEYS = [
  'NO_WEBSITE',
  'WEBSITE_UNREACHABLE',
  'NO_SSL',
  'NOT_MOBILE_READY',
  'NO_CONTACT_FORM',
  'NO_ONLINE_BOOKING',
  'NO_CLEAR_CTA',
  'OUTDATED_SITE',
  'NO_CHAT',
] as const;
export type HypothesisKey = (typeof HYPOTHESIS_KEYS)[number];

export interface HypothesisDraft {
  key: HypothesisKey;
  /** Always hedged ("may"): an observed fact plus a possible need, never a verified pain (docs/08 §27). */
  hypothesis: string;
  /** The observed facts behind it. */
  reasonSummary: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Which audit check supports it — its page is the evidence. */
  check: AuditCheck | 'website';
}

export interface HypothesisInput {
  /** No source listed a website for the business. */
  hasWebsite: boolean;
  /** The website was tried but could not be loaded. */
  unreachable?: { reason: string } | null;
  audit: WebsiteAuditResult | null;
  now?: Date;
}

/**
 * Rule-based opportunity hypotheses from observed facts (docs/17 §52-57). AI may phrase better ones in Phase 9; it
 * must still cite the same evidence. Each rule needs a definite observation — "could not tell" proposes nothing.
 */
export function deriveHypotheses(input: HypothesisInput): HypothesisDraft[] {
  const out: HypothesisDraft[] = [];
  if (!input.hasWebsite) {
    out.push({
      key: 'NO_WEBSITE',
      hypothesis: 'They may benefit from a website — none was found for this business.',
      reasonSummary: 'No source that listed this business had a website for it.',
      confidence: 'MEDIUM',
      check: 'website',
    });
    return out;
  }
  if (input.unreachable) {
    out.push({
      key: 'WEBSITE_UNREACHABLE',
      hypothesis: 'Their website may be losing visitors — it could not be loaded when we checked.',
      reasonSummary: `The website did not load: ${input.unreachable.reason}. This can be temporary.`,
      confidence: 'LOW',
      check: 'website',
    });
    return out;
  }
  const a = input.audit;
  if (!a) return out;
  const now = input.now ?? new Date();
  const asksToCall = a.ctas.some((c) => /quote|estimate|call/.test(c));
  if (a.hasSsl === false) {
    out.push({
      key: 'NO_SSL',
      hypothesis: 'Visitors may be put off by a "Not secure" warning on their site.',
      reasonSummary: 'The site loads over plain http, without https.',
      confidence: 'HIGH',
      check: 'ssl',
    });
  }
  if (a.mobileReady === false) {
    out.push({
      key: 'NOT_MOBILE_READY',
      hypothesis: 'Their site may be hard to use on phones.',
      reasonSummary: 'The home page has no mobile viewport setting.',
      confidence: 'MEDIUM',
      check: 'mobile',
    });
  }
  if (a.hasContactForm === false) {
    out.push({
      key: 'NO_CONTACT_FORM',
      hypothesis: 'A contact form may capture enquiries from visitors who would rather not call.',
      reasonSummary: `No contact form on the ${a.pagesChecked} page(s) checked.`,
      confidence: a.pagesChecked >= 2 ? 'MEDIUM' : 'LOW',
      check: 'contact_form',
    });
  }
  if (a.hasBooking === false) {
    out.push({
      key: 'NO_ONLINE_BOOKING',
      hypothesis: 'A simple online booking or quote request flow may reduce friction for new customers.',
      reasonSummary: asksToCall
        ? `Visitors are asked to ${a.ctas.filter((c) => /quote|estimate|call/.test(c)).join(' / ')}, but no booking tool or booking page was found.`
        : 'No booking tool or booking page was found on the pages checked.',
      confidence: asksToCall ? 'MEDIUM' : 'LOW',
      check: 'booking',
    });
  }
  if (a.hasClearCta === false) {
    out.push({
      key: 'NO_CLEAR_CTA',
      hypothesis: 'Visitors may not know what to do next on their site.',
      reasonSummary: 'No button or link asks for a quote, a booking or a call.',
      confidence: 'LOW',
      check: 'cta',
    });
  }
  if (a.copyrightYear !== null && now.getUTCFullYear() - a.copyrightYear >= OUTDATED_AFTER_YEARS) {
    out.push({
      key: 'OUTDATED_SITE',
      hypothesis: `Their website may not have been updated since ${a.copyrightYear}.`,
      reasonSummary: `The footer copyright says ${a.copyrightYear}.`,
      confidence: 'MEDIUM',
      check: 'freshness',
    });
  }
  if (a.hasChat === false) {
    out.push({
      key: 'NO_CHAT',
      hypothesis: 'Instant replies (chat or messaging) may help answer visitors faster.',
      reasonSummary: 'No live chat widget on the pages checked.',
      confidence: 'LOW',
      check: 'chat',
    });
  }
  return out;
}

export const HYPOTHESIS_LABEL: Record<HypothesisKey, string> = {
  NO_WEBSITE: 'No website',
  WEBSITE_UNREACHABLE: 'Website not loading',
  NO_SSL: 'Not secure (no https)',
  NOT_MOBILE_READY: 'Not mobile-friendly',
  NO_CONTACT_FORM: 'No contact form',
  NO_ONLINE_BOOKING: 'No online booking',
  NO_CLEAR_CTA: 'No clear next step',
  OUTDATED_SITE: 'Possibly outdated site',
  NO_CHAT: 'No live chat',
};

/**
 * How likely a stated role decides on buying services like ours (docs/08 §22-24). Role fit only — it never makes the
 * person a verified decision maker.
 */
export function roleRelevance(title: string | null | undefined): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (!title) return 'LOW';
  if (/\b(?:co-?)?(?:owner|founder)\b|\bceo\b|\bpresident\b|managing director|\bprincipal\b/i.test(title)) return 'HIGH';
  if (/\bmanager\b|\bdirector\b|\bhead of\b/i.test(title)) return 'MEDIUM';
  return 'LOW';
}

export interface ContactabilityInput {
  emails: { status: 'UNVERIFIED' | 'VERIFIED' | 'INVALID' | 'STALE'; verification: string | null; person: { name: string; relevance: 'HIGH' | 'MEDIUM' | 'LOW' } | null }[];
  phones: number;
  contactForm: boolean | null;
}

export interface Contactability {
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  reasons: string[];
}

/**
 * Can we reach a relevant person, and how sure are we (docs/08 §52 Contactability)? Explained in words, never a bare
 * number. Verified ≠ allowed to contact — suppression and policy decide that later (docs/09 §67-76).
 */
export function assessContactability(input: ContactabilityInput): Contactability {
  const usable = input.emails.filter((e) => e.status !== 'INVALID');
  const verified = usable.filter((e) => e.status === 'VERIFIED');
  const decider = verified.find((e) => e.person?.relevance === 'HIGH');
  const reasons: string[] = [];
  if (decider) reasons.push(`Verified email for ${decider.person!.name}, a likely decision maker`);
  else if (verified.length) reasons.push(`${verified.length} verified email(s)${verified.some((e) => e.person) ? '' : ' — shared inbox, not a named person'}`);
  const unverified = usable.filter((e) => e.status !== 'VERIFIED');
  if (unverified.length) reasons.push(`${unverified.length} email(s) not verified (${[...new Set(unverified.map((e) => (e.verification ?? 'not checked').toLowerCase().replace('_', '-')))].join(', ')})`);
  const invalid = input.emails.length - usable.length;
  if (invalid) reasons.push(`${invalid} email(s) failed verification`);
  if (input.phones) reasons.push(`${input.phones} phone number(s)`);
  if (input.contactForm) reasons.push('Contact form on the website');
  if (!reasons.length) reasons.push('No email, phone or contact form found yet');

  const level = decider
    ? 'HIGH'
    : verified.length || (input.phones && (unverified.length || input.contactForm))
      ? 'MEDIUM'
      : input.phones || unverified.length || input.contactForm
        ? 'LOW'
        : 'NONE';
  return { level, reasons };
}

// ───────────────────────────── research run ─────────────────────────────

export const RESEARCH_STEPS = ['website', 'audit', 'technology', 'social', 'contacts', 'people', 'verification', 'hypotheses'] as const;
export type ResearchStepKey = (typeof RESEARCH_STEPS)[number];

export interface ResearchStep {
  key: ResearchStepKey;
  status: 'DONE' | 'SKIPPED' | 'FAILED';
  detail: string;
}

export const RESEARCH_STEP_LABEL: Record<ResearchStepKey, string> = {
  website: 'Read the website',
  audit: 'Website checks',
  technology: 'Technology',
  social: 'Social profiles',
  contacts: 'Published contacts',
  people: 'Decision makers',
  verification: 'Email verification',
  hypotheses: 'Opportunity hypotheses',
};

/** A company researched automatically is not researched again by discovery within this window (a person still can). */
export const RESEARCH_FRESH_DAYS = 14;
