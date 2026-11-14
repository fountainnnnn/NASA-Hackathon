/** Small DEM helpers for the Ops layer: slope at a point, polygon geometry in lon/lat. Pure, no React. */
import { R_MARS } from '@/lib/contracts';
import type { Dem, LonLat } from '@/lib/contracts';
import { sampleElevation } from '@/lib/geo/frame';

const DEG = Math.PI / 180;

/** Slope (deg) at a point from the 20 m DEM by central differences over +-step metres. null where any sample is nodata. */
export function slopeAtDem(dem: Dem, lon: number, lat: number, stepM = 20): number | null {
  const dLat = (stepM / R_MARS) / DEG;
  const dLon = dLat / Math.max(0.05, Math.cos(lat * DEG));
  const e = sampleElevation(dem, lon + dLon, lat), w = sampleElevation(dem, lon - dLon, lat);
  const n = sampleElevation(dem, lon, lat + dLat), s = sampleElevation(dem, lon, lat - dLat);
  if (e == null || w == null || n == null || s == null) return null;
  return Math.atan(Math.hypot((e - w) / (2 * stepM), (n - s) / (2 * stepM))) / DEG;
}

export function pointInPolygon(p: LonLat, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** Area in km2 (shoelace on local equirectangular metres). */
export function polygonAreaKm2(poly: LonLat[]): number {
  if (poly.length < 3) return 0;
  const lat0 = poly.reduce((a, p) => a + p.lat, 0) / poly.length;
  const kx = R_MARS * Math.cos(lat0 * DEG) * DEG, ky = R_MARS * DEG;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.lon * kx * (q.lat * ky) - q.lon * kx * (p.lat * ky);
  }
  return Math.abs(a) / 2 / 1e6;
}

export function centroid(poly: LonLat[]): LonLat {
  return { lon: poly.reduce((a, p) => a + p.lon, 0) / poly.length, lat: poly.reduce((a, p) => a + p.lat, 0) / poly.length };
}

export function distM(a: LonLat, b: LonLat): number {
  const lat = ((a.lat + b.lat) / 2) * DEG;
  return Math.hypot(R_MARS * Math.cos(lat) * (b.lon - a.lon) * DEG, R_MARS * (b.lat - a.lat) * DEG);
}

/** Regular sample grid (n x n over the bounding box) of points that fall inside the polygon. */
export function samplePolygon(poly: LonLat[], n = 28): LonLat[] {
  const lons = poly.map((p) => p.lon), lats = poly.map((p) => p.lat);
  const lo = Math.min(...lons), hi = Math.max(...lons), la = Math.min(...lats), lb = Math.max(...lats);
  const out: LonLat[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = { lon: lo + ((i + 0.5) / n) * (hi - lo), lat: la + ((j + 0.5) / n) * (lb - la) };
    if (pointInPolygon(p, poly)) out.push(p);
  }
  return out;
}
