import { R_MARS } from '../contracts';

const D2R = Math.PI / 180;

export const wrap180 = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;

/** Great-circle distance (km) on the Mars sphere. */
export function gcDistanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return (2 * R_MARS * Math.asin(Math.min(1, Math.sqrt(a)))) / 1000;
}

/** Initial great-circle bearing, degrees clockwise from north, [0, 360). */
export function gcBearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

export type Ring = [number, number][];

/** Makes a ring's longitudes continuous (removes +-360 jumps), so polygons crossing +-180 become one shape
 *  whose longitudes may run past 180 or below -180. */
export function unwrapRing(ring: Ring): Ring {
  if (!ring.length) return ring;
  const out: Ring = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}

export function ringsBBox(rings: Ring[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/** Even-odd point-in-polygon over all rings (holes respected). */
export function pointInRingsXY(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Point-in-polygon for polygons whose rings were unwrapped: tests the point at lon, lon+360 and lon-360,
 *  each with a bbox prefilter. */
export function pointInUnwrapped(lon: number, lat: number, rings: Ring[], bbox: [number, number, number, number]): boolean {
  if (lat < bbox[1] || lat > bbox[3]) return false;
  for (const shift of [0, 360, -360]) {
    const x = lon + shift;
    if (x < bbox[0] || x > bbox[2]) continue;
    if (pointInRingsXY(x, lat, rings)) return true;
  }
  return false;
}
