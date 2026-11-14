/**
 * Global MOLA DEM on the CPU (for picking, marker/line placement) — decoded once, shared by the canvas.
 * Raster is equirectangular, lon -180..180 left→right, lat 90..-90 top→bottom, pixel-edge aligned.
 */
import * as THREE from 'three';
import type { GlobalManifest } from '../../lib/globeContracts';
import { R_KM as R_MARS_KM, wrapLon } from './geo';

export interface GlobalDem {
  width: number; height: number;
  /** Metres above the areoid, row 0 = north. NaN = nodata. */
  elev: Float32Array;
  minM: number; maxM: number;
  decodeMs: number;
}

let current: GlobalDem | null = null;
let version = 0;
const listeners = new Set<() => void>();
export const getGlobalDem = () => current;
export const globalDemVersion = () => version;
/** useSyncExternalStore-compatible subscription: fires when a new DEM has been decoded. */
export function subscribeDem(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Radius (1 = R_MARS) of the displayed surface at lon/lat: 1 + exaggerated elevation. Flat sphere when no DEM. */
export function reliefRadius(lon: number, lat: number, exaggeration: number): number {
  const h = sampleElevationM(lon, lat);
  return 1 + ((h ?? 0) * exaggeration) / (R_MARS_KM * 1000);
}

/** Bilinear elevation (m) at lon/lat; null when no DEM or nodata. */
export function sampleElevationM(lon: number, lat: number, dem: GlobalDem | null = current): number | null {
  if (!dem) return null;
  const { width: W, height: H, elev } = dem;
  const fx = ((wrapLon(lon) + 180) / 360) * W - 0.5;
  const fy = ((90 - lat) / 180) * H - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
  const ya = Math.min(H - 1, Math.max(0, y0)), yb = Math.min(H - 1, Math.max(0, y0 + 1));
  const a = elev[ya * W + xa], b = elev[ya * W + xb], c = elev[yb * W + xa], d = elev[yb * W + xb];
  const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  return Number.isNaN(v) ? null : v;
}

async function gunzipIfNeeded(res: Response): Promise<ArrayBuffer> {
  const buf = await res.arrayBuffer();
  const u8 = new Uint8Array(buf, 0, 2);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot gunzip the global DEM (no DecompressionStream)');
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer(); // decompression runs off the main thread
  }
  return buf; // server already decoded Content-Encoding: gzip
}

/** Fetch + decode the DEM. Int16 → metres conversion is chunked so the main thread is never blocked > ~16 ms. */
export async function loadGlobalDem(base: string, m: GlobalManifest['dem']): Promise<GlobalDem> {
  const t0 = performance.now();
  const res = await fetch(`${base}/${m.file}`);
  if (!res.ok) throw new Error(`DEM ${m.file}: HTTP ${res.status}`);
  const raw = await gunzipIfNeeded(res);
  const n = m.width * m.height;
  if (raw.byteLength < n * 2) throw new Error(`DEM ${m.file}: expected ${n * 2} bytes, got ${raw.byteLength}`);
  const src = new Int16Array(raw, 0, n); // little-endian host (all supported browsers)
  const elev = new Float32Array(n);
  let min = Infinity, max = -Infinity;
  const { scale, offset, nodata } = m.encoding;
  const CHUNK = 262_144;
  for (let s = 0; s < n; s += CHUNK) {
    const e = Math.min(n, s + CHUNK);
    for (let i = s; i < e; i++) {
      const v = src[i];
      if (v === nodata) { elev[i] = NaN; continue; }
      const h = offset + scale * v;
      elev[i] = h;
      if (h < min) min = h; if (h > max) max = h;
    }
    if (e < n) await new Promise<void>((r) => setTimeout(r, 0));
  }
  const dem: GlobalDem = { width: m.width, height: m.height, elev, minM: min, maxM: max, decodeMs: performance.now() - t0 };
  current = dem; version++; listeners.forEach((cb) => cb());
  return dem;
}

/** Half-float R texture holding elevation in kilometres, row order flipped so uv.y = 1 is north (matches SphereGeometry uv). Chunked. */
export async function demToTexture(dem: GlobalDem): Promise<THREE.DataTexture> {
  const { width: W, height: H, elev } = dem;
  const data = new Uint16Array(W * H);
  const ROWS = 48;
  for (let y0 = 0; y0 < H; y0 += ROWS) {
    for (let y = y0; y < Math.min(H, y0 + ROWS); y++) {
      const dst = (H - 1 - y) * W, srcRow = y * W;
      for (let x = 0; x < W; x++) { const v = elev[srcRow + x]; data[dst + x] = THREE.DataUtils.toHalfFloat(Number.isNaN(v) ? 0 : v / 1000); }
    }
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false; tex.needsUpdate = true;
  return tex;
}
