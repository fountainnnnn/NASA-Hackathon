import { R_MARS } from '../contracts';
import type { LonLat } from '../contracts';

const DEG = Math.PI / 180;

/** Densify a lon/lat polyline to ~stepM spacing; vertexIndex[i] = dense index of original vertex i. */
export function densify(path: LonLat[], stepM: number): { pts: LonLat[]; vertexIndex: number[] } {
  const pts: LonLat[] = [];
  const vertexIndex: number[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      const a = path[i - 1], b = path[i];
      const latM = ((a.lat + b.lat) / 2) * DEG;
      const len = Math.hypot(R_MARS * Math.cos(latM) * (b.lon - a.lon) * DEG, R_MARS * (b.lat - a.lat) * DEG);
      const n = Math.max(1, Math.round(len / stepM));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        pts.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });
      }
    }
    vertexIndex.push(pts.length);
    pts.push({ lon: path[i].lon, lat: path[i].lat });
  }
  return { pts, vertexIndex };
}
