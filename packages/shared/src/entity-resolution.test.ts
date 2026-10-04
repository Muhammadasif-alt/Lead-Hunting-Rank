import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshnessOf, nameSimilarity, scoreCompanyMatch, type CompanyMatchRecord } from './entity-resolution.js';
import { normalizeAddress } from './normalize.js';

const base: CompanyMatchRecord = {
  normalizedName: 'greenscape landscaping',
  websiteDomain: 'greenscape.com',
  phone: '+15125550100',
  addressLine: '120 North Lamar Boulevard',
  city: 'Austin',
  region: 'TX',
  country: 'US',
  postalCode: '78703',
};
const kinds = (signals: { kind: string }[]) => signals.map((s) => s.kind).sort();

test('same website + phone + name → HIGH and safe to auto-merge', () => {
  const m = scoreCompanyMatch(base, { ...base, addressLine: '120 N Lamar Blvd' });
  assert.equal(m.confidence, 'HIGH');
  assert.equal(m.score, 100);
  assert.equal(m.autoMergeSafe, true);
  assert.deepEqual(kinds(m.matching), ['ADDRESS', 'DOMAIN', 'NAME_EXACT', 'PHONE']);
  assert.deepEqual(m.conflicting, []);
});

test('a conflict makes even a strong match a human decision', () => {
  const m = scoreCompanyMatch(base, { ...base, city: 'Dallas', addressLine: null, postalCode: null });
  assert.equal(m.autoMergeSafe, false);
  assert.notEqual(m.confidence, 'HIGH');
  assert.deepEqual(kinds(m.conflicting), ['CITY']);
});

test('same name and city only → LOW (worth showing, never merging)', () => {
  const other = { ...base, websiteDomain: null, phone: null, addressLine: null, postalCode: null };
  const m = scoreCompanyMatch({ ...base, websiteDomain: null, phone: null, addressLine: null, postalCode: null }, other);
  assert.equal(m.confidence, 'LOW');
  assert.equal(m.autoMergeSafe, false);
});

test('franchise locations sharing a website in different cities are not merged', () => {
  const a = { ...base, normalizedName: 'lawn doctor of austin', websiteDomain: 'lawndoctor.com', phone: '+15125550111' };
  const b = { ...a, normalizedName: 'lawn doctor of dallas', city: 'Dallas', phone: '+12145550111', addressLine: '9 Elm St', postalCode: '75201' };
  const m = scoreCompanyMatch(a, b);
  assert.equal(m.autoMergeSafe, false);
  assert.notEqual(m.confidence, 'HIGH');
});

test('shared hosts like facebook.com are not evidence of sameness', () => {
  const a = { ...base, websiteDomain: 'facebook.com', phone: null, addressLine: null, postalCode: null };
  const b = { ...a, normalizedName: 'hill country roofing' };
  const m = scoreCompanyMatch(a, b);
  assert.equal(m.matching.some((s) => s.kind === 'DOMAIN'), false);
  assert.equal(m.conflicting.some((s) => s.kind === 'DOMAIN'), false);
  assert.equal(m.confidence, null);
});

test('different countries outweigh everything except overwhelming evidence', () => {
  const m = scoreCompanyMatch(
    { ...base, websiteDomain: null, phone: null },
    { ...base, websiteDomain: null, phone: null, country: 'CA', region: 'ON' },
  );
  assert.equal(m.confidence, null);
});

test('aliases count: an old domain or phone recorded on a company still matches', () => {
  const a = { ...base, websiteDomain: 'greenscapetx.com', aliases: { domains: ['greenscape.com'] } };
  const m = scoreCompanyMatch(a, base);
  assert.ok(m.matching.some((s) => s.kind === 'DOMAIN'));
});

test('nameSimilarity behaves like trigram similarity', () => {
  assert.equal(nameSimilarity('greenscape', 'greenscape'), 1);
  assert.ok(nameSimilarity('greenscape landscaping', 'green scape landscaping') > 0.6);
  assert.ok(nameSimilarity('greenscape landscaping', 'hill country roofing') < 0.2);
});

test('normalizeAddress makes common spellings comparable', () => {
  assert.equal(normalizeAddress('120 North Lamar Boulevard, Suite 4'), normalizeAddress('120 N. Lamar Blvd #4'));
  assert.equal(normalizeAddress('  '), null);
});

test('freshness: fresh → aging → stale', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  assert.equal(freshnessOf('2026-09-01T00:00:00Z', now), 'FRESH');
  assert.equal(freshnessOf('2026-05-01T00:00:00Z', now), 'AGING');
  assert.equal(freshnessOf('2025-10-01T00:00:00Z', now), 'STALE');
});
