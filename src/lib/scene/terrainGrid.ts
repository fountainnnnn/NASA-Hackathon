/**
 * Render grid built from the DEM: downsampled heights, mesh geometry, and an analytic
 * heightfield ray-march used for picking / occlusion (the 900k-triangle mesh is never raycast).
 * Frame (contracts.ts): x east, z south, y = (h − hRef)·exaggeration.
 */
import * as THREE from 'three';
import type { Dem, GeoApi } from '../contracts';

export interface TerrainGrid {
  nx: number; nz: number;
  x0: number; z0: number;       // local metres of vertex (0,0) = north-west corner
  dx: number; dz: number;       // vertex spacing, metres
  heights: Float32Array;        // h − hRef (metres, NOT exaggerated); nodata = 0
  valid: Uint8Array;            // 1 = real DEM data
  minH: number; maxH: number;   // of valid vertices, relative to hRef
  hRef: number;
  elevMin: number; elevMax: number;
  stride: number;               // DEM pixels per mesh step
}

/** Bilinear height at fractional pixel coords using only valid neighbours; NaN if none. */
function sampleLoose(elev: Float32Array, w: number, h: number, fc: number, fr: number): number {
  fc = Math.min(Math.max(fc, 0), w - 1);
  fr = Math.min(Math.max(fr, 0), h - 1);
  const c0 = Math.floor(fc), r0 = Math.floor(fr);
  const c1 = Math.min(c0 + 1, w - 1), r1 = Math.min(r0 + 1, h - 1);
  const tc = fc - c0, tr = fr - r0;
  let acc = 0, wsum = 0;
  const add = (c: number, r: number, wt: number) => {
    const v = elev[r * w + c];
    if (wt > 0 && v === v) { acc += v * wt; wsum += wt; }
  };
  add(c0, r0, (1 - tc) * (1 - tr)); add(c1, r0, tc * (1 - tr));
  add(c0, r1, (1 - tc) * tr); add(c1, r1, tc * tr);
  return wsum > 0 ? acc / wsum : NaN;
}

export function buildTerrainGrid(dem: Dem, geo: Pick<GeoApi, 'toLocal'>, maxVerts = 768): TerrainGrid {
  const { meta, elev } = dem;
  const w = meta.width, h = meta.height;
  const stride = Math.max(1, Math.ceil(Math.max(w, h) / maxVerts));
  const nx = Math.floor(w / stride) + 1;
  const nz = Math.floor(h / stride) + 1;
  const nw = geo.toLocal(meta, meta.lonMin, meta.latMax);
  const se = geo.toLocal(meta, meta.lonMax, meta.latMin);
  const dx = (se.x - nw.x) / (nx - 1);
  const dz = (se.z - nw.z) / (nz - 1);
  const heights = new Float32Array(nx * nz);
  const valid = new Uint8Array(nx * nz);
  let minH = Infinity, maxH = -Infinity;
  for (let j = 0; j < nz; j++) {
    const fr = (j / (nz - 1)) * h - 0.5; // mesh spans outer edges; pixel centres sit at +0.5
    for (let i = 0; i < nx; i++) {
      const fc = (i / (nx - 1)) * w - 0.5;
      const v = sampleLoose(elev, w, h, fc, fr);
      const k = j * nx + i;
      if (v === v) {
        const rel = v - meta.hRef;
        heights[k] = rel; valid[k] = 1;
        if (rel < minH) minH = rel;
        if (rel > maxH) maxH = rel;
      }
    }
  }
  if (!isFinite(minH)) { minH = 0; maxH = 0; }
  return { nx, nz, x0: nw.x, z0: nw.z, dx, dz, heights, valid, minH, maxH, hRef: meta.hRef, elevMin: meta.elevMin, elevMax: meta.elevMax, stride };
}

export function buildTerrainGeometry(g: TerrainGrid, exag: number): THREE.BufferGeometry {
  const { nx, nz } = g;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const aValid = new Float32Array(nx * nz);
  const aElev = new Float32Array(nx * nz);
  const span = Math.max(1, g.elevMax - g.elevMin);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pos[k * 3] = g.x0 + i * g.dx;
      pos[k * 3 + 1] = g.heights[k] * exag;
      pos[k * 3 + 2] = g.z0 + j * g.dz;
      uv[k * 2] = i / (nx - 1);
      uv[k * 2 + 1] = j / (nz - 1); // row 0 = north = v 0 (textures use flipY=false)
      aValid[k] = g.valid[k];
      aElev[k] = g.valid[k] ? Math.min(1, Math.max(0, (g.heights[k] + g.hRef - g.elevMin) / span)) : 0;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = (j + 1) * nx + i, c = j * nx + i + 1, d = (j + 1) * nx + i + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = c; idx[p++] = b; idx[p++] = d;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setAttribute('aValid', new THREE.BufferAttribute(aValid, 1));
  geom.setAttribute('aElev', new THREE.BufferAttribute(aElev, 1));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
  return geom;
}

/** Rebuilds only y (and normals) after an exaggeration change. */
export function applyExaggeration(geom: THREE.BufferGeometry, g: TerrainGrid, exag: number) {
  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let k = 0; k < g.heights.length; k++) a[k * 3 + 1] = g.heights[k] * exag;
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  geom.computeBoundingBox();
}

/** Exaggerated mesh height at local (x, z), bilinear between vertices; hRef-relative. */
export function meshHeightAt(g: TerrainGrid, x: number, z: number, exag: number): number {
  let fx = (x - g.x0) / g.dx, fz = (z - g.z0) / g.dz;
  fx = Math.min(Math.max(fx, 0), g.nx - 1.000001);
  fz = Math.min(Math.max(fz, 0), g.nz - 1.000001);
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const k = j * g.nx + i;
  const h = g.heights;
  const top = h[k] * (1 - tx) + h[k + 1] * tx;
  const bot = h[k + g.nx] * (1 - tx) + h[k + g.nx + 1] * tx;
  return (top * (1 - tz) + bot * tz) * exag;
}

/** Ray vs. heightfield. Returns distance t along `dir` (unit) or null. */
export function marchRay(
  g: TerrainGrid, exag: number,
  o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number },
  near = 0, far = Infinity,
): number | null {
  const xMax = g.x0 + (g.nx - 1) * g.dx, zMax = g.z0 + (g.nz - 1) * g.dz;
  const yMin = Math.min(g.minH, 0) * exag - 1, yMax = Math.max(g.maxH, 0) * exag + 1;
  let t0 = Math.max(0, near), t1 = far;
  const slab = (oo: number, dd: number, lo: number, hi: number): boolean => {
    if (Math.abs(dd) < 1e-12) return oo >= lo && oo <= hi;
    let a = (lo - oo) / dd, b = (hi - oo) / dd;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(o.x, d.x, Math.min(g.x0, xMax), Math.max(g.x0, xMax))) return null;
  if (!slab(o.z, d.z, Math.min(g.z0, zMax), Math.max(g.z0, zMax))) return null;
  if (!slab(o.y, d.y, yMin, yMax)) return null;
  const step = Math.min(Math.abs(g.dx), Math.abs(g.dz)) * 0.5;
  const below = (t: number) => o.y + d.y * t <= meshHeightAt(g, o.x + d.x * t, o.z + d.z * t, exag);
  if (below(t0)) return t0;
  let prev = t0;
  for (let t = t0 + step; ; t += step) {
    const tt = Math.min(t, t1);
    if (below(tt)) {
      let lo = prev, hi = tt;
      for (let n = 0; n < 14; n++) { const m = (lo + hi) / 2; if (below(m)) hi = m; else lo = m; }
      return hi;
    }
    if (tt >= t1) return null;
    prev = tt;
  }
}
