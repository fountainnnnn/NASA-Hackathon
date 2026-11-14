/**
 * Globe coordinate math. Pure functions, no three.js dependency (unit-testable in node).
 *
 * FRAME (Mars-fixed, right-handed, 1 unit = R_MARS):
 *   +Y = north pole.  lon 0 lies on +X.  East is toward -Z (so lon 90E is at -Z, lon 180 at -X, lon 90W at +Z).
 *   x =  cos(lat)·cos(lon)
 *   y =  sin(lat)
 *   z = -cos(lat)·sin(lon)
 * This matches THREE.SphereGeometry with texture u = (lon + 180) / 360 and v = (lat + 90) / 180,
 * and an observer outside the planet looking at lon 0 sees east to the right.
 * Longitude is planetocentric, EAST-POSITIVE, -180..180 (same as src/lib/contracts.ts).
 */
import { R_MARS } from '../../lib/contracts';

export const R_KM = R_MARS / 1000;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Vec3 = [number, number, number];
export interface LonLatDeg { lon: number; lat: number }

export function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}

export function lonLatToXYZ(lon: number, lat: number, r = 1): Vec3 {
  const lo = lon * D2R, la = lat * D2R, c = Math.cos(la);
  return [r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo)];
}

export function xyzToLonLat(x: number, y: number, z: number): LonLatDeg & { r: number } {
  const r = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) * R2D;
  const horiz = Math.hypot(x, z);
  const lon = horiz < 1e-12 ? 0 : wrapLon(Math.atan2(-z, x) * R2D);
  return { lon, lat, r };
}

/** Central angle (radians) between two lon/lat points (haversine, stable for small angles). */
export function centralAngle(a: LonLatDeg, b: LonLatDeg): number {
  const la1 = a.lat * D2R, la2 = b.lat * D2R, dLa = la2 - la1, dLo = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function greatCircleKm(a: LonLatDeg, b: LonLatDeg): number {
  return centralAngle(a, b) * R_KM;
}

/** Initial bearing from a to b, degrees clockwise from north, 0..360. */
export function bearingDeg(a: LonLatDeg, b: LonLatDeg): number {
  const la1 = a.lat * D2R, la2 = b.lat * D2R, dLo = (b.lon - a.lon) * D2R;
  const y = Math.sin(dLo) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

/** Point reached from `from` travelling `distKm` along the great circle with initial bearing `bearing` (deg from north, clockwise). */
export function destinationPoint(from: LonLatDeg, bearing: number, distKm: number): LonLatDeg {
  const d = distKm / R_KM, br = bearing * D2R, la1 = from.lat * D2R, lo1 = from.lon * D2R;
  const sinLa2 = Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br);
  const la2 = Math.asin(Math.max(-1, Math.min(1, sinLa2)));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * sinLa2);
  return { lon: wrapLon(lo2 * R2D), lat: la2 * R2D };
}

/** Great-circle interpolation (slerp), t in 0..1. */
export function greatCircleLerp(a: LonLatDeg, b: LonLatDeg, t: number): LonLatDeg {
  const A = lonLatToXYZ(a.lon, a.lat), B = lonLatToXYZ(b.lon, b.lat);
  const dot = Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]));
  const om = Math.acos(dot), so = Math.sin(om);
  let k1: number, k2: number;
  if (so < 1e-9) { k1 = 1 - t; k2 = t; } else { k1 = Math.sin((1 - t) * om) / so; k2 = Math.sin(t * om) / so; }
  const p = xyzToLonLat(k1 * A[0] + k2 * B[0], k1 * A[1] + k2 * B[1], k1 * A[2] + k2 * B[2]);
  return { lon: p.lon, lat: p.lat };
}

/** n+1 points along the great circle a→b. */
export function greatCirclePath(a: LonLatDeg, b: LonLatDeg, n: number): LonLatDeg[] {
  const out: LonLatDeg[] = [];
  for (let i = 0; i <= n; i++) out.push(greatCircleLerp(a, b, i / n));
  return out;
}

/**
 * Closed geodesic ellipse: semi-major axis `aKm` points along bearing `azimuthDeg` (clockwise from north),
 * semi-minor `bKm` is perpendicular. Each vertex is the great-circle destination at the ellipse radius
 * (so axis lengths are true surface distances). Returns n+1 points (last === first).
 */
export function ellipsePoints(c: LonLatDeg, aKm: number, bKm: number, azimuthDeg: number, n = 128): LonLatDeg[] {
  const out: LonLatDeg[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i % n) / n * 2 * Math.PI;
    const u = aKm * Math.cos(t), v = bKm * Math.sin(t);
    const d = Math.hypot(u, v);
    out.push(d < 1e-9 ? { ...c } : destinationPoint(c, azimuthDeg + Math.atan2(v, u) * R2D, d));
  }
  return out;
}

/** Ray (origin o, unit direction d) vs sphere radius r at origin. Returns nearest positive t or null. */
export function raySphere(o: Vec3, d: Vec3, r: number): number | null {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc), t0 = -b - s, t1 = -b + s;
  if (t0 > 0) return t0;
  return t1 > 0 ? t1 : null;
}

/**
 * Pick the lon/lat under a ray. Intersects the unit sphere, then refines against the relief radius
 * `radiusAt(lon, lat)` (= 1 + exaggerated elevation) a few times so the hit stays under the cursor
 * on displaced terrain. Returns null when the ray misses the planet.
 */
export function pickRay(o: Vec3, d: Vec3, radiusAt?: (lon: number, lat: number) => number): (LonLatDeg & { r: number }) | null {
  let r = 1;
  let hit: (LonLatDeg & { r: number }) | null = null;
  for (let i = 0; i < (radiusAt ? 4 : 1); i++) {
    const t = raySphere(o, d, r);
    if (t == null) break;
    const p = xyzToLonLat(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    hit = p;
    if (!radiusAt) break;
    const nr = radiusAt(p.lon, p.lat);
    if (Math.abs(nr - r) < 1e-6) { r = nr; break; }
    r = nr;
  }
  // Limb case: refined radius grew past the ray but the unit sphere was hit — keep the last valid hit.
  return hit;
}

/** Camera position for looking straight down at lon/lat from `distance` units from the centre. */
export function cameraPosition(lon: number, lat: number, distance: number): Vec3 {
  return lonLatToXYZ(lon, lat, distance);
}

/** Jezero high-resolution coverage (CTX DEM bounds), degrees. */
export const JEZERO_BOUNDS = { lonMin: 77.1605, lonMax: 77.699, latMin: 18.211, latMax: 18.7212 } as const;
export const JEZERO_CENTER: LonLatDeg = {
  lon: (JEZERO_BOUNDS.lonMin + JEZERO_BOUNDS.lonMax) / 2,
  lat: (JEZERO_BOUNDS.latMin + JEZERO_BOUNDS.latMax) / 2,
};
