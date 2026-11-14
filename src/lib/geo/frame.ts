import { R_MARS } from '@/lib/contracts';
import type { Dem, DemMeta, GeoApi, LonLat } from '@/lib/contracts';

const DEG = Math.PI / 180;

export function demCentre(meta: DemMeta): { lonC: number; latC: number } {
  return { lonC: (meta.lonMin + meta.lonMax) / 2, latC: (meta.latMin + meta.latMax) / 2 };
}

/** lon/lat -> local scene metres. x east, z south (+z), per contracts.ts. */
export function toLocal(meta: DemMeta, lon: number, lat: number): { x: number; z: number } {
  const { lonC, latC } = demCentre(meta);
  return {
    x: R_MARS * Math.cos(latC * DEG) * (lon - lonC) * DEG,
    z: -R_MARS * (lat - latC) * DEG,
  };
}

export function toLonLat(meta: DemMeta, x: number, z: number): LonLat {
  const { lonC, latC } = demCentre(meta);
  return {
    lon: lonC + x / (R_MARS * Math.cos(latC * DEG) * DEG),
    lat: latC - z / (R_MARS * DEG),
  };
}

/** Lon/lat of the CENTRE of pixel (c, r). */
export function pixelCentreLonLat(meta: DemMeta, c: number, r: number): LonLat {
  return { lon: meta.lonMin + (c + 0.5) * meta.dLon, lat: meta.latMax - (r + 0.5) * meta.dLat };
}

/** Continuous pixel coordinates where integer values are pixel centres (so pixel (c,r) centre = (c, r)). */
export function lonLatToPixel(meta: DemMeta, lon: number, lat: number): { c: number; r: number } {
  return { c: (lon - meta.lonMin) / meta.dLon - 0.5, r: (meta.latMax - lat) / meta.dLat - 0.5 };
}

/**
 * Bilinear sample on pixel centres. null if outside the DEM outer edges or if any contributing
 * cell (nonzero bilinear weight) is NaN. Within the outer half-pixel margin the nearest edge
 * pixel row/column is used (clamped).
 */
export function sampleElevation(dem: Dem, lon: number, lat: number): number | null {
  const { meta, elev } = dem;
  const w = meta.width, h = meta.height;
  let fc = (lon - meta.lonMin) / meta.dLon - 0.5;
  let fr = (meta.latMax - lat) / meta.dLat - 0.5;
  const eps = 1e-9;
  if (!(fc >= -0.5 - eps && fc <= w - 0.5 + eps && fr >= -0.5 - eps && fr <= h - 0.5 + eps)) return null;
  fc = Math.min(Math.max(fc, 0), w - 1);
  fr = Math.min(Math.max(fr, 0), h - 1);
  // snap float noise at pixel centres so exact centres return exact values
  const rc = Math.round(fc), rr = Math.round(fr);
  if (Math.abs(fc - rc) < eps) fc = rc;
  if (Math.abs(fr - rr) < eps) fr = rr;
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  const tc = fc - c0, tr = fr - r0;
  const c1 = Math.min(c0 + 1, w - 1), r1 = Math.min(r0 + 1, h - 1);
  let acc = 0;
  const add = (c: number, r: number, wt: number): boolean => {
    if (wt === 0) return true;
    const v = elev[r * w + c];
    if (v !== v) return false;
    acc += v * wt;
    return true;
  };
  if (
    !add(c0, r0, (1 - tc) * (1 - tr)) || !add(c1, r0, tc * (1 - tr)) ||
    !add(c0, r1, (1 - tc) * tr) || !add(c1, r1, tc * tr)
  ) return null;
  return acc;
}

/** Undo row-wise delta encoding (wrap-around Int16 sums). Returns a new buffer. */
export function undoRowDelta(buf: ArrayBuffer, width: number, height: number): ArrayBuffer {
  const n = width * height;
  if (buf.byteLength < n * 2) throw new Error(`DEM buffer too small: ${buf.byteLength} < ${n * 2}`);
  const src = new DataView(buf);
  const out = new Int16Array(n);
  for (let r = 0; r < height; r++) {
    const o = r * width;
    let acc = src.getInt16(o * 2, true);
    out[o] = acc;
    for (let c = 1; c < width; c++) {
      acc = (acc + src.getInt16((o + c) * 2, true)) << 16 >> 16; // wrap to Int16
      out[o + c] = acc;
    }
  }
  const le = new ArrayBuffer(n * 2);
  const dv = new DataView(le);
  for (let i = 0; i < n; i++) dv.setInt16(i * 2, out[i], true);
  return le;
}

/** Decode the (already decompressed) DEM buffer, Int16 LE, optionally row-delta encoded, into a Dem. nodata -> NaN. */
export function decodeDem(meta: DemMeta, rawBuf: ArrayBuffer): Dem {
  const n = meta.width * meta.height;
  if (rawBuf.byteLength < n * 2) throw new Error(`DEM buffer too small: ${rawBuf.byteLength} < ${n * 2}`);
  const buf = meta.encoding.delta === 'row' ? undoRowDelta(rawBuf, meta.width, meta.height) : rawBuf;
  const view = new DataView(buf);
  const { scale, offset, nodata } = meta.encoding;
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = view.getInt16(i * 2, true);
    elev[i] = v === nodata ? NaN : offset + scale * v;
  }
  return { meta, elev };
}

/** Equirectangular ground distance (m) using the mean latitude; fine within ~50 km. */
export function groundDistanceM(a: LonLat, b: LonLat): number {
  const latM = ((a.lat + b.lat) / 2) * DEG;
  const dx = R_MARS * Math.cos(latM) * (b.lon - a.lon) * DEG;
  const dy = R_MARS * (b.lat - a.lat) * DEG;
  return Math.hypot(dx, dy);
}

/** Initial bearing a -> b in degrees, 0 = north, 90 = east, range [0, 360). Local approximation. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const latM = ((a.lat + b.lat) / 2) * DEG;
  const east = Math.cos(latM) * (b.lon - a.lon);
  const north = b.lat - a.lat;
  return (Math.atan2(east, north) / DEG + 360) % 360;
}

export const geo: GeoApi = { toLocal, toLonLat, sampleElevation };
