import { Injectable } from '@nestjs/common';
import { City, Country, State } from 'country-state-city';
import { NotFoundError } from '@revenue-os/shared';

/** Main markets first in the country picker: the US, Australia, New Zealand and every European country. */
const MAIN_MARKETS = new Set([
  'US', 'AU', 'NZ',
  'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'CH', 'AT', 'IT', 'ES', 'PT', 'DK', 'NO', 'SE', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU',
  'SI', 'HR', 'RO', 'BG', 'GR', 'CY', 'MT', 'EE', 'LV', 'LT', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'MD', 'UA', 'BY', 'MC', 'LI',
  'SM', 'AD', 'VA',
]);

/** Countries where people write the state as its short code ("Austin, TX"); elsewhere the name is stored ("Punjab"). */
const CODE_REGIONS = new Set(['US', 'CA', 'AU']);

export interface GeoCountry {
  code: string;
  name: string;
  flag: string;
  main: boolean;
}

export interface GeoRegion {
  /** What a market stores as its region (and what the picker sends back). */
  value: string;
  name: string;
  cities: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Location reference data for the Lead Hunter pickers (country → state/region → city), from the bundled
 * country-state-city dataset. Only regions that have cities are offered, so every choice leads somewhere.
 */
@Injectable()
export class GeoService {
  private countries: GeoCountry[] | null = null;
  private readonly regions = new Map<string, { regions: GeoRegion[]; isoByValue: Map<string, string> }>();
  private readonly cities = new Map<string, string[]>();

  listCountries(): GeoCountry[] {
    this.countries ??= Country.getAllCountries()
      .map((c) => ({ code: c.isoCode, name: c.name, flag: c.flag, main: MAIN_MARKETS.has(c.isoCode) }))
      .sort(byName);
    return this.countries;
  }

  listRegions(country: string): { regions: GeoRegion[]; citiesWithoutRegion: boolean } {
    const regions = this.regionIndex(country).regions;
    return { regions, citiesWithoutRegion: regions.length === 0 && this.listCities(country).length > 0 };
  }

  /** Cities of a region (by its stored value), or of the whole country when it has no regions. */
  listCities(country: string, region?: string): string[] {
    const cc = this.country(country);
    const key = `${cc}|${(region ?? '').toLowerCase()}`;
    const cached = this.cities.get(key);
    if (cached) return cached;
    let rows;
    if (region) {
      const iso = this.regionIndex(cc).isoByValue.get(region.toLowerCase());
      if (!iso) throw new NotFoundError(`No region "${region}" in ${cc}`);
      rows = City.getCitiesOfState(cc, iso);
    } else {
      rows = City.getCitiesOfCountry(cc) ?? [];
    }
    const names = [...new Set(rows.map((c) => c.name))].sort((a, b) => a.localeCompare(b));
    this.cities.set(key, names);
    return names;
  }

  private regionIndex(country: string) {
    const cc = this.country(country);
    let index = this.regions.get(cc);
    if (!index) {
      const isoByValue = new Map<string, string>();
      const regions: GeoRegion[] = [];
      for (const s of State.getStatesOfCountry(cc)) {
        const cities = City.getCitiesOfState(cc, s.isoCode).length;
        if (cities === 0) continue;
        const value = CODE_REGIONS.has(cc) && /^[A-Z]{2,3}$/.test(s.isoCode) ? s.isoCode : s.name;
        if (isoByValue.has(value.toLowerCase())) continue;
        isoByValue.set(value.toLowerCase(), s.isoCode);
        regions.push({ value, name: s.name, cities });
      }
      index = { regions: regions.sort(byName), isoByValue };
      this.regions.set(cc, index);
    }
    return index;
  }

  private country(code: string): string {
    const cc = code.trim().toUpperCase();
    if (!this.listCountries().some((c) => c.code === cc)) throw new NotFoundError(`Unknown country "${code}"`);
    return cc;
  }
}
