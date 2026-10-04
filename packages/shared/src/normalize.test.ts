import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCompanyName, normalizeDomain, normalizeEmail, normalizePhone } from './normalize.js';

test('normalizeCompanyName strips punctuation, accents and legal suffixes', () => {
  assert.equal(normalizeCompanyName('GreenScape Landscaping, LLC'), 'greenscape landscaping');
  assert.equal(normalizeCompanyName('  Café & Co. Inc. '), 'cafe and');
  assert.equal(normalizeCompanyName('LLC'), 'llc');
});

test('normalizeDomain reduces URLs, hosts and emails to a bare domain', () => {
  assert.equal(normalizeDomain('https://www.GreenScape.com/about?x=1'), 'greenscape.com');
  assert.equal(normalizeDomain('greenscape.com'), 'greenscape.com');
  assert.equal(normalizeDomain('john@Mail.GreenScape.com'), 'mail.greenscape.com');
  assert.equal(normalizeDomain('not a domain'), null);
  assert.equal(normalizeDomain(''), null);
});

test('normalizeEmail validates shape and lower-cases', () => {
  assert.equal(normalizeEmail(' John.Smith@GreenScape.com '), 'john.smith@greenscape.com');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(normalizeEmail('a@b'), null);
});

test('normalizePhone produces comparable E.164-style keys', () => {
  assert.equal(normalizePhone('(512) 555-0100'), '+15125550100');
  assert.equal(normalizePhone('+1 512 555 0100'), '+15125550100');
  assert.equal(normalizePhone('1-512-555-0100'), '+15125550100');
  assert.equal(normalizePhone('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('123'), null);
});
