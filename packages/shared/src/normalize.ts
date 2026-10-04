/**
 * Deterministic normalizers used for matching and uniqueness (docs/17 Phase 6 entity resolution foundation).
 * They never decide that two records are the same — they only produce comparable keys.
 */

const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'l.l.c', 'ltd', 'limited', 'co', 'corp', 'corporation', 'company', 'plc', 'pllc', 'lp', 'llp', 'pvt',
]);

/** "GreenScape Landscaping, LLC" → "greenscape landscaping" */
export function normalizeCompanyName(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return words.join(' ');
}

/** "https://www.GreenScape.com/about?x=1" → "greenscape.com". Returns null when it isn't a plausible domain. */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('@')) value = value.slice(value.lastIndexOf('@') + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `http://${value}`;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\d*\./, '').replace(/\.$/, '');
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? host : null;
}

/** Lower-cases and trims an email. Returns null when the shape is invalid. Does not claim the mailbox exists. */
export function normalizeEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1 || at > 64) return null;
  const domain = normalizeDomain(value.slice(at + 1));
  if (!domain || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(value.slice(0, at))) return null;
  return `${value.slice(0, at)}@${domain}`;
}

/**
 * Keeps digits (and a leading +). Numbers without a country code get `defaultCountryCode` (US "1" by default),
 * so "(512) 555-0100" and "+1 512 555 0100" compare equal. Returns null for implausible lengths.
 */
export function normalizePhone(input: string, defaultCountryCode = '1'): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) digits = digits.slice(2);
  else if (!trimmed.startsWith('+')) {
    if (defaultCountryCode === '1' && digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    digits = `${defaultCountryCode}${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}
