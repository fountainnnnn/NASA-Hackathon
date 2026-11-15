/**
 * Gap filling for the global data (pure). Where a dataset has no value at a point, the app still gives an answer, and says
 * how it got it:
 *  - estimate: derived from real data nearby or at another scale (nearest valid cell within 200 km, a slope scaled from
 *    the MOLA baseline, dust cover from thermal inertia). The method is carried with the value.
 *  - mock: a plausible value for the location when nothing can be derived. Deterministic: seeded by lon/lat (rounded to
 *    0.01 degree), never random per call, and always labelled "mock".
 */
import { gcDistanceKm } from './geo';
import { cellCol, cellRow, type Raster } from './raster';

import type { FillProvenance } from '../globeContracts';
export type { FillProvenance };
export interface Filled { value: number; provenance: FillProvenance; method: string }

/** Farthest a neighbouring cell may be to stand in for a missing one. */
export const FILL_RADIUS_KM = 200;

/** Deterministic hash of a location to [0, 1): same lon/lat (to 0.01 degree) and salt, same number. */
export function siteHash(lon: number, lat: number, salt: string): number {
  let h = 2166136261;
  const s = `${Math.round(lon * 100)}|${Math.round(lat * 100)}|${salt}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Nearest valid cell of a raster within `maxKm` of a point (great-circle distance), or null. */
export function nearestValid(r: Raster, lon: number, lat: number, maxKm = FILL_RADIUS_KM): { value: number; distanceKm: number } | null {
  const c0 = cellCol(r, lon), r0 = cellRow(r, lat);
  const cellKm = (180 / r.height) * 59.27; // Mars: 3389.5 km radius, 59.16 km per degree; a little generous
  const rowsR = Math.ceil(maxKm / cellKm) + 1;
  const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const colsR = Math.min(Math.floor(r.width / 2), Math.ceil(rowsR / cosLat));
  let best: { value: number; distanceKm: number } | null = null;
  for (let dy = -rowsR; dy <= rowsR; dy++) {
    const row = r0 + dy;
    if (row < 0 || row >= r.height) continue;
    const clat = 90 - ((row + 0.5) / r.height) * 180;
    for (let dx = -colsR; dx <= colsR; dx++) {
      const col = (((c0 + dx) % r.width) + r.width) % r.width;
      const raw = r.data[row * r.width + col];
      if (raw === r.nodata) continue;
      const clon = ((col + 0.5) / r.width) * 360 - 180;
      const d = gcDistanceKm(lon, lat, clon, clat);
      if (d <= maxKm && (!best || d < best.distanceKm)) best = { value: raw * r.scale + r.offset, distanceKm: d };
    }
  }
  return best;
}

/** Observed value, else the nearest valid cell within 200 km (estimate), else a labelled mock. */
export function fillFromRaster(r: Raster | null, lon: number, lat: number, observed: number | null, what: string, mock: (lon: number, lat: number) => number): Filled {
  if (observed != null && Number.isFinite(observed)) return { value: observed, provenance: 'observed', method: what };
  const near = r ? nearestValid(r, lon, lat) : null;
  if (near) return { value: near.value, provenance: 'estimate', method: `nearest valid ${what} cell, ${Math.round(near.distanceKm)} km away` };
  return { value: mock(lon, lat), provenance: 'mock', method: `mock ${what} value, seeded by lon/lat (no data within ${FILL_RADIUS_KM} km)` };
}

/* ------------------------------------------------------------------ plausible mocks (labelled "mock" wherever shown) */

/** Thermal inertia (tiu): 150 to 350, the middle of the TES range for most of the planet (Putzig & Mellon 2007). */
export const mockThermalInertia = (lon: number, lat: number) => Math.round(150 + 200 * siteHash(lon, lat, 'ti'));
/** Water-equivalent hydrogen (wt%): 2 to 8 at low latitudes, 20 to 50 poleward of 55 degrees (Boynton et al. 2007 ranges). */
export const mockHydrogen = (lon: number, lat: number) => {
  const u = siteHash(lon, lat, 'h');
  return Math.round((Math.abs(lat) >= 55 ? 20 + 30 * u : 2 + 6 * u) * 10) / 10;
};
/** Rock abundance (% of area): 3 to 12, around the Mars median of about 6 % (Nowicki & Christensen 2007). */
export const mockRockAbundance = (lon: number, lat: number) => Math.round((3 + 9 * siteHash(lon, lat, 'rock')) * 10) / 10;
/** Elevation (m above the areoid): -3000 to +2000, the bulk of the MOLA hypsometry. */
export const mockElevation = (lon: number, lat: number) => Math.round(-3000 + 5000 * siteHash(lon, lat, 'z'));
/** Regional slope (deg): 0.2 to 2. */
export const mockSlope = (lon: number, lat: number) => Math.round((0.2 + 1.8 * siteHash(lon, lat, 'slope')) * 10) / 10;

/* ------------------------------------------------------------------ derived estimates */

/** Hurst exponent assumed for scaling slope with baseline (self-affine topography; Mars values are about 0.7 to 0.8, Orosei et al. 2003). */
export const HURST = 0.75;
/** Slope at baseline `toKm` estimated from the slope at `fromKm`: s(L) = s(L0) * (L0 / L)^(1 - H). */
export function scaleSlope(slopeDeg: number, fromKm: number, toKm: number): number {
  const t = Math.tan((slopeDeg * Math.PI) / 180) * Math.pow(fromKm / toKm, 1 - HURST);
  return Math.round((Math.atan(t) * 180) / Math.PI * 100) / 100;
}

/** TES dust cover index estimated from thermal inertia: low inertia reads as dust-covered (about 0.92), high as clear (about 0.98). */
export function dustFromThermalInertia(ti: number): number {
  const k = Math.min(1, Math.max(0, (ti - 100) / 300));
  return Math.round((0.92 + 0.06 * k) * 1000) / 1000;
}
