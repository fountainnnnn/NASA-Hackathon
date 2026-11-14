import { R_MARS } from '../contracts';
import type { LonLat } from '../contracts';

export const fmtKm = (m: number) => `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
export const fmtMin = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
export const fmtDeg = (d: number) => `${d.toFixed(1)}°`;
export const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}`;
export const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
export const fmtElev = (e: number | null) => (e == null ? 'no data' : `${Math.round(e)} m`);

/** Horizontal distance (m) between two nearby points. */
export function groundM(a: LonLat, b: LonLat): number {
  const DEG = Math.PI / 180;
  const lat = ((a.lat + b.lat) / 2) * DEG;
  return Math.hypot(R_MARS * Math.cos(lat) * (b.lon - a.lon) * DEG, R_MARS * (b.lat - a.lat) * DEG);
}

/** Split `text` so numbers listed in `unverified` can be underlined. */
export function splitUnverified(text: string, unverified: string[]): { text: string; flagged: boolean }[] {
  const list = [...new Set(unverified.filter((u) => u.length > 0))].sort((a, b) => b.length - a.length);
  if (!list.length) return [{ text, flagged: false }];
  const re = new RegExp(`(${list.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  return text.split(re).filter((p) => p !== '').map((p) => ({ text: p, flagged: list.includes(p) }));
}
