import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeoService } from './geo.service.js';

const geo = new GeoService();

test('main markets (US, AU, NZ, Europe) are flagged; every country is listed', () => {
  const countries = geo.listCountries();
  assert.ok(countries.length > 200);
  const main = new Set(countries.filter((c) => c.main).map((c) => c.code));
  for (const cc of ['US', 'AU', 'NZ', 'GB', 'DE', 'FR', 'IE']) assert.ok(main.has(cc), cc);
  assert.ok(!main.has('PK'));
});

test('regions match what markets already store: US codes, names elsewhere — only regions with cities', () => {
  const us = geo.listRegions('US').regions;
  assert.ok(us.some((r) => r.value === 'TX' && r.name === 'Texas'));
  const pk = geo.listRegions('pk').regions;
  assert.ok(pk.some((r) => r.value === 'Punjab'));
  assert.ok(pk.every((r) => r.cities > 0));
  assert.ok(geo.listCities('US', 'TX').includes('Austin'));
  assert.ok(geo.listCities('PK', 'punjab').includes('Lahore'));
});

test('unknown country or region is a not-found error', () => {
  assert.throws(() => geo.listRegions('ZZ'), { code: 'RESOURCE_NOT_FOUND' });
  assert.throws(() => geo.listCities('US', 'Atlantis'), { code: 'RESOURCE_NOT_FOUND' });
});
