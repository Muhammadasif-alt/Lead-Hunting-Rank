import { SIGNAL_TYPES, type PageState, type SignalTypeKey } from '@revenue-os/shared';

/**
 * Pure detection rules (no database): page state from a stored snapshot + audit, wording checks on first-party text,
 * and the expansion cluster. Kept apart so they are unit-tested on their own.
 */

export interface SnapshotLike {
  title: string | null;
  textExcerpt: string | null;
  metadata: unknown;
}

export interface AuditLike {
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasContactForm: boolean | null;
  technologySummary: string[];
  copyrightYear: number | null;
  findings: unknown;
}

/** "Buttons/links ask visitors to: get a quote, book now." → ['get a quote', 'book now'] (the audit's cta finding). */
export function ctasFromFindings(findings: unknown): string[] {
  const list = Array.isArray(findings) ? (findings as { key?: string; observed?: boolean | null; detail?: string }[]) : [];
  const cta = list.find((f) => f.key === 'cta' && f.observed);
  const m = cta?.detail ? /ask visitors to:\s*(.+?)\.?$/i.exec(cta.detail) : null;
  return m ? m[1]!.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
}

/** What a page looked like at one check, from what research stored (snapshot text + deterministic audit). */
export function pageStateOf(snapshot: SnapshotLike, audit: AuditLike | null): PageState {
  const meta = (snapshot.metadata ?? {}) as { description?: unknown };
  return {
    title: snapshot.title,
    description: typeof meta.description === 'string' ? meta.description : null,
    text: snapshot.textExcerpt ?? '',
    ctas: audit ? ctasFromFindings(audit.findings) : [],
    booking: audit?.hasBooking ?? null,
    chat: audit?.hasChat ?? null,
    contactForm: audit?.hasContactForm ?? null,
    technologies: audit?.technologySummary ?? [],
    copyrightYear: audit?.copyrightYear ?? null,
  };
}

const NEGATIVE_ABOUT_SOLUTION = /\b(unhappy|not happy|frustrat\w*|disappoint\w*|poor|bad|terrible|awful|useless|too slow|slow|too expensive|overpriced|doesn['’]?t work|not working|isn['’]?t working|problems?|issues?|struggl\w*|hate|leaving|switch(ing)? (away|from)|looking (for|to replace)|replace|fed up|not great)\b/i;

/** A first-party statement about their current provider that sounds unhappy (screen #9 §28). */
export const negativeAboutSolution = (quote: string) => NEGATIVE_ABOUT_SOLUTION.test(quote);

const COME_BACK = /\b(contact|reach out|get back|come back|follow[- ]?up|touch base|check in|circle back|try (us|me|again)|talk again|speak again|call (us|me) (back|again|in|after)|email (us|me) (again|in|after))\b/i;

/** A promise that is really "come back to us later" (contact-later / return date), not an ordinary task. */
export const isComeBackRequest = (text: string) => COME_BACK.test(text);

/** Categories whose independent changes together may indicate expansion (screen #9 §34). */
const CLUSTER_CATEGORIES = ['GROWTH', 'DIGITAL'];
export const EXPANSION_MIN_TYPES = 3;
export const EXPANSION_WINDOW_DAYS = 90;

/** Open growth/digital signals of different types within the window → the types that form an expansion pattern. */
export function expansionCluster(signals: { type: string; category: string; detectedAt: Date }[], now: Date): string[] {
  const since = now.getTime() - EXPANSION_WINDOW_DAYS * 86_400_000;
  const types = new Set(
    signals
      .filter((s) => s.type !== 'EXPANSION' && CLUSTER_CATEGORIES.includes(s.category) && s.detectedAt.getTime() >= since)
      .filter((s) => !(SIGNAL_TYPES as Record<string, { negative: boolean }>)[s.type]?.negative)
      .map((s) => s.type),
  );
  return types.size >= EXPANSION_MIN_TYPES ? [...types] : [];
}

export const typeLabel = (type: string) => (SIGNAL_TYPES as Record<string, { label: string }>)[type]?.label ?? type;
export const isSignalType = (type: string): type is SignalTypeKey => Object.hasOwn(SIGNAL_TYPES, type);
export const day = (d: Date) => d.toISOString().slice(0, 10);
