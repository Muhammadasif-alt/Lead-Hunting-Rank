"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/** Location reference data for the Lead Hunter pickers (`/api/v1/geo`): country → state/region → city. */

export interface GeoCountry {
  code: string;
  name: string;
  flag: string;
  /** US, Australia, New Zealand and Europe — listed first. */
  main: boolean;
}

export interface GeoRegion {
  /** Stored on the market and sent back to the API. */
  value: string;
  name: string;
  cities: number;
}

interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: boolean;
}

// Reference data doesn't change while the page is open — fetch each list once per session.
const cache = new Map<string, Promise<unknown>>();

function fetchOnce<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = api<T>(path);
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

function useGeo<T>(path: string | null): Loadable<T> {
  const [state, setState] = useState<Loadable<T> & { path: string | null }>({
    data: null,
    loading: false,
    error: false,
    path: null,
  });

  useEffect(() => {
    if (!path) return;
    let alive = true;
    fetchOnce<T>(path)
      .then((data) => alive && setState({ data, loading: false, error: false, path }))
      .catch(() => alive && setState({ data: null, loading: false, error: true, path }));
    return () => {
      alive = false;
    };
  }, [path]);

  if (!path) return { data: null, loading: false, error: false };
  // Until the answer for *this* path arrives, don't show the previous country's list.
  if (state.path !== path) return { data: null, loading: true, error: false };
  return state;
}

export function useCountries() {
  return useGeo<{ items: GeoCountry[] }>("/geo/countries");
}

export function useRegions(country: string) {
  return useGeo<{ regions: GeoRegion[]; citiesWithoutRegion: boolean }>(
    country ? `/geo/countries/${country}/regions` : null,
  );
}

/** Cities of a region — or of the whole country when it has no regions (`region` = ""). Null path = nothing to load. */
export function useCities(country: string, region: string, enabled: boolean) {
  const qs = region ? `?region=${encodeURIComponent(region)}` : "";
  return useGeo<{ items: string[] }>(enabled && country ? `/geo/countries/${country}/cities${qs}` : null);
}
