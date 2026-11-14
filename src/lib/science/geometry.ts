import { R_MARS, type LonLat } from '@/lib/contracts';

const D2R = Math.PI / 180;

export type Ring = [number, number][];

/** Ground distance (m) via equirectangular approximation about the mean latitude. */
export function distanceM(a: LonLat, b: LonLat): number {
  const latM = ((a.lat + b.lat) / 2) * D2R;
  const dx = R_MARS * Math.cos(latM) * (b.lon - a.lon) * D2R;
  const dy = R_MARS * (b.lat - a.lat) * D2R;
  return Math.hypot(dx, dy);
}

/** Initial bearing a -> b in degrees clockwise from north, [0, 360). */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const latM = ((a.lat + b.lat) / 2) * D2R;
  const dx = Math.cos(latM) * (b.lon - a.lon);
  const dy = b.lat - a.lat;
  return ((Math.atan2(dx, dy) / D2R) + 360) % 360;
}

export function inBBox(p: LonLat, bb: [number, number, number, number]): boolean {
  return p.lon >= bb[0] && p.lon <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3];
}

/** Minimum distance (m) from p to the bbox [lonMin, latMin, lonMax, latMax] (0 if inside). */
export function distanceToBBoxM(p: LonLat, bb: [number, number, number, number]): number {
  const q = { lon: Math.min(Math.max(p.lon, bb[0]), bb[2]), lat: Math.min(Math.max(p.lat, bb[1]), bb[3]) };
  return distanceM(p, q);
}

/** Even-odd point-in-polygon over all rings (outer + holes): a point in a hole is outside. */
export function pointInRings(p: LonLat, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * "Pole of inaccessibility"-lite: among area centroid and a coarse grid (refined twice around the best),
 * the point inside the polygon (even-odd, holes respected) that maximises distance to the nearest edge.
 * Clearance is computed in local metres on a decimated copy of the edges (<= ~500 vertices per ring set).
 */
export function interiorPoint(rings: Ring[], gridN = 18): { lon: number; lat: number; clearanceM: number } | null {
  if (!rings.length || rings[0].length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, nv = 0;
  for (const r of rings[0]) {
    x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[0]); y0 = Math.min(y0, r[1]); y1 = Math.max(y1, r[1]);
  }
  for (const r of rings) nv += r.length;
  const lonC = (x0 + x1) / 2, latC = (y0 + y1) / 2;
  const mx = R_MARS * Math.cos(latC * D2R) * D2R, my = R_MARS * D2R;
  const stride = Math.max(1, Math.ceil(nv / 500));
  const edges: [number, number, number, number][] = [];
  for (const ring of rings) {
    const pts = ring.filter((_, i) => i % stride === 0 || i === ring.length - 1)
      .map(([lo, la]) => [(lo - lonC) * mx, (la - latC) * my] as [number, number]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  const clearance = (lon: number, lat: number): number => {
    if (!pointInRings({ lon, lat }, rings)) return -1;
    const px = (lon - lonC) * mx, py = (lat - latC) * my;
    let m = Infinity;
    for (const e of edges) m = Math.min(m, segDist(px, py, e[0], e[1], e[2], e[3]));
    return m;
  };
  let best: { lon: number; lat: number; c: number } | null = null;
  const consider = (lon: number, lat: number) => {
    const c = clearance(lon, lat);
    if (c >= 0 && (!best || c > best.c)) best = { lon, lat, c };
  };
  // area-weighted centroid of the outer ring
  let a2 = 0, cx = 0, cy = 0;
  const o = rings[0];
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const f = o[j][0] * o[i][1] - o[i][0] * o[j][1];
    a2 += f; cx += (o[j][0] + o[i][0]) * f; cy += (o[j][1] + o[i][1]) * f;
  }
  if (a2 !== 0) consider(cx / (3 * a2), cy / (3 * a2));
  let sx = (x1 - x0) / gridN, sy = (y1 - y0) / gridN;
  for (let i = 0; i < gridN; i++) for (let j = 0; j < gridN; j++) consider(x0 + (i + 0.5) * sx, y0 + (j + 0.5) * sy);
  for (let pass = 0; pass < 2 && best; pass++) {
    const b: { lon: number; lat: number; c: number } = best;
    const n = 8;
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) consider(b.lon + (i * sx) / n, b.lat + (j * sy) / n);
    sx /= 4; sy /= 4;
  }
  if (!best) return null;
  const r: { lon: number; lat: number; c: number } = best;
  return { lon: r.lon, lat: r.lat, clearanceM: r.c };
}
