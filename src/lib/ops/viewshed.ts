/**
 * Line-of-sight / comms visibility over the 20 m DEM.
 *
 * Geometry (exact for a chord between two points above a sphere): along the ray from eye E (height above the
 * areoid) the apparent elevation angle of a terrain point at ground distance d is
 *     v(d) = (z(d) − E)/d − d/(2R)            [R = 3,396,190 m; d/(2R) is the d²/(2R) curvature drop ÷ d]
 * The target (ground z_T + target height) at distance D is visible iff no intermediate sample has v(d) > v_T.
 * This is identical to testing terrain against the straight chord lowered by d(D−d)/(2R) (verified in tests
 * against the √(2Rh₁)+√(2Rh₂) horizon distance). Terrain is sampled every HALF DEM CELL (10 m) with bilinear
 * heights. DEM nodata along a ray is treated as BLOCKING (conservative: comms are never claimed through gaps);
 * endpoints on nodata/outside the DEM give visible=false.
 *
 * Heights: STATION_MAST_HEIGHT_M (2 m) and SUIT_ANTENNA_HEIGHT_M (1.8 m) are ASSUMPTIONS (assumptions.ts).
 */
import { R_MARS } from '../contracts';
import type { Dem, LonLat, RouteResult } from '../contracts';
import type { CommsResult, LosResult, ShadowStretch, Station, Timeline, ViewshedGrid } from '../opsContracts';
import { groundDistanceM, sampleElevation } from '../geo/frame';
import { STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M } from './assumptions';
import { buildTimeline, positionAt } from './timeline';

const DEG = Math.PI / 180;
const TWO_R = 2 * R_MARS;

export interface LosOptions { stepM?: number }

/** Fast bilinear sampler on pixel centres; NaN for nodata or outside the outer edges (same rule as geo.sampleElevation). */
function makeSampler(dem: Dem) {
  const { meta, elev } = dem;
  const w = meta.width, h = meta.height;
  const lon0 = meta.lonMin, lat0 = meta.latMax, dLon = meta.dLon, dLat = meta.dLat;
  return (lon: number, lat: number): number => {
    let fc = (lon - lon0) / dLon - 0.5, fr = (lat0 - lat) / dLat - 0.5;
    if (!(fc >= -0.5 && fc <= w - 0.5 && fr >= -0.5 && fr <= h - 0.5)) return NaN;
    fc = fc < 0 ? 0 : fc > w - 1 ? w - 1 : fc;
    fr = fr < 0 ? 0 : fr > h - 1 ? h - 1 : fr;
    const c0 = fc | 0, r0 = fr | 0, tc = fc - c0, tr = fr - r0;
    const c1 = c0 + 1 < w ? c0 + 1 : c0, r1 = r0 + 1 < h ? r0 + 1 : r0;
    const i00 = r0 * w + c0, i10 = r0 * w + c1, i01 = r1 * w + c0, i11 = r1 * w + c1;
    const w00 = (1 - tc) * (1 - tr), w10 = tc * (1 - tr), w01 = (1 - tc) * tr, w11 = tc * tr;
    let acc = 0;
    if (w00 > 0) { const v = elev[i00]; if (v !== v) return NaN; acc += v * w00; }
    if (w10 > 0) { const v = elev[i10]; if (v !== v) return NaN; acc += v * w10; }
    if (w01 > 0) { const v = elev[i01]; if (v !== v) return NaN; acc += v * w01; }
    if (w11 > 0) { const v = elev[i11]; if (v !== v) return NaN; acc += v * w11; }
    return acc;
  };
}

/** Is `b` (target height hb above ground) visible from `a` (eye height ha above ground)? Heights in metres. */
export function lineOfSight(dem: Dem, a: LonLat, b: LonLat, ha: number, hb: number, o: LosOptions = {}): LosResult {
  const zA = sampleElevation(dem, a.lon, a.lat), zB = sampleElevation(dem, b.lon, b.lat);
  const D = groundDistanceM(a, b);
  if (zA === null || zB === null) {
    return { visible: false, distM: D, blockedAtM: null, minClearanceM: null, reason: 'nodata-endpoint' };
  }
  return losCore(makeSampler(dem), a, b, zA + ha, zB + hb, D, o.stepM ?? dem.meta.nominalResM / 2);
}

function losCore(sample: (lon: number, lat: number) => number, a: LonLat, b: LonLat, E: number, T: number, D: number, step: number): LosResult {
  if (D < 1e-6) return { visible: true, distM: 0, blockedAtM: null, minClearanceM: null, reason: 'clear' };
  const vT = (T - E) / D - D / TWO_R;
  const n = Math.ceil(D / step) - 1; // interior samples at d = k·step < D
  let minClear = Infinity;
  for (let k = 1; k <= n; k++) {
    const d = k * step;
    const f = d / D;
    const z = sample(a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f);
    if (z !== z) return { visible: false, distM: D, blockedAtM: d, minClearanceM: null, reason: 'nodata-ray' };
    const v = (z - E) / d - d / TWO_R;
    // vertical clearance of the chord over the curvature-corrected terrain at d
    const clear = E + (T - E) * f - (z + d * (D - d) / TWO_R);
    if (clear < minClear) minClear = clear;
    if (v > vT) return { visible: false, distM: D, blockedAtM: d, minClearanceM: Math.min(minClear, clear), reason: 'terrain' };
  }
  return { visible: true, distM: D, blockedAtM: null, minClearanceM: n > 0 ? minClear : null, reason: 'clear' };
}

/** Horizon (flat-ground) distance √(2Rh) for an eye height h (m). */
export const horizonDistanceM = (hM: number): number => Math.sqrt(2 * R_MARS * hM);

/* ------------------------------------------------------------------ comms along a route */

/**
 * Per-vertex comms visibility from a fixed station (mast on habitat/rover) to the suit antenna along `route`.
 * Flags are aligned with buildTimeline(route).samples (flat index). The route's own vertex heights are NOT used:
 * ground is re-sampled from the 20 m DEM so the ray and its endpoints share the same surface.
 */
export function commsAlongRoute(
  dem: Dem, route: RouteResult | Timeline, station: Station,
  o: { stationHeightM?: number; suitHeightM?: number; stepM?: number } = {},
): CommsResult {
  const tl = 'samples' in route ? route : buildTimeline(route);
  const hs = o.stationHeightM ?? station.heightM ?? STATION_MAST_HEIGHT_M;
  const hr = o.suitHeightM ?? SUIT_ANTENNA_HEIGHT_M;
  const step = o.stepM ?? dem.meta.nominalResM / 2;
  const sample = makeSampler(dem);
  const zS = sampleElevation(dem, station.lon, station.lat);
  const visible: boolean[] = [];
  let nodata = 0;
  for (const s of tl.samples) {
    const z = sampleElevation(dem, s.lon, s.lat);
    if (zS === null || z === null) { visible.push(false); nodata++; continue; }
    visible.push(losCore(sample, station, s, zS + hs, z + hr, groundDistanceM(station, s), step).visible);
  }
  const shadows = shadowStretches(tl, visible);
  const nVis = visible.filter(Boolean).length;
  return {
    stationId: station.id ?? 'station', visible, shadows, nodataVertices: nodata,
    visibleFraction: visible.length ? nVis / visible.length : 1,
    longestShadowM: shadows.reduce((m, s) => Math.max(m, s.lengthM), 0),
    stationHeightM: hs, suitHeightM: hr,
  };
}

/** Maximal runs of non-visible vertices. */
export function shadowStretches(tl: Timeline, visible: boolean[]): ShadowStretch[] {
  const s = tl.samples, out: ShadowStretch[] = [];
  let i = 0;
  while (i < s.length) {
    if (visible[i]) { i++; continue; }
    let j = i;
    while (j + 1 < s.length && !visible[j + 1]) j++;
    const before = i > 0 ? s[i - 1] : s[i], after = j + 1 < s.length ? s[j + 1] : s[j];
    out.push({
      startIdx: i, endIdx: j, startLeg: s[i].leg, startVertex: s[i].vertex, endLeg: s[j].leg, endVertex: s[j].vertex,
      lengthM: s[j].distM - s[i].distM, maxLengthM: after.distM - before.distM,
      startMin: s[i].tMin, endMin: s[j].tMin,
      start: { lon: s[i].lon, lat: s[i].lat }, end: { lon: s[j].lon, lat: s[j].lat },
    });
    i = j + 1;
  }
  return out;
}

/**
 * Suit-to-suit (or suit-to-rover) visibility between two moving parties at elapsed minute `tMin`.
 * `a` and `b` are route timelines (each may use its own clock origin = EVA start).
 */
export function pairVisibility(
  dem: Dem, a: Timeline, b: Timeline, tMin: number, o: { heightAM?: number; heightBM?: number } = {},
): LosResult & { a: LonLat; b: LonLat } {
  const pa = positionAt(a, tMin), pb = positionAt(b, tMin);
  const r = lineOfSight(dem, pa, pb, o.heightAM ?? SUIT_ANTENNA_HEIGHT_M, o.heightBM ?? SUIT_ANTENNA_HEIGHT_M);
  return { ...r, a: { lon: pa.lon, lat: pa.lat }, b: { lon: pb.lon, lat: pb.lat } };
}

/* ------------------------------------------------------------------ viewshed raster */

/**
 * Viewshed mask around `station`: cells every `stepM` metres in a (2n+1)² grid (n = ceil(radius/step)), row 0 = north.
 * Value 0 = outside the radius / nodata, 1 = visible from the station mast to a SUIT_ANTENNA_HEIGHT_M target, 2 = hidden.
 *
 * Optimisation: instead of an independent ray per cell (O(cells × samples)), a fan of rays (2 per cell-width at the rim)
 * is marched once at half-DEM-cell spacing storing the running maximum apparent angle (the "horizon profile");
 * each cell is then one lookup against its nearest ray (≤ ¼ cell lateral offset at the rim) at the cell's exact
 * distance, with the cell's own height bilinearly sampled. Same v(d) test as lineOfSight (agreement is tested).
 */
export function viewshedGrid(
  dem: Dem, station: Station, radiusM: number, stepM: number,
  o: { stationHeightM?: number; targetHeightM?: number } = {},
): ViewshedGrid {
  const t0 = performance.now();
  const hs = o.stationHeightM ?? station.heightM ?? STATION_MAST_HEIGHT_M;
  const ht = o.targetHeightM ?? SUIT_ANTENNA_HEIGHT_M;
  const n = Math.ceil(radiusM / stepM);
  const width = 2 * n + 1;
  const mask = new Uint8Array(width * width);
  const zS = sampleElevation(dem, station.lon, station.lat);
  const result = (vis: number, hid: number): ViewshedGrid => ({
    mask, width, height: width, stepM, radiusM, station, visibleCount: vis, hiddenCount: hid, computeMs: performance.now() - t0,
  });
  if (zS === null) return result(0, 0);
  const E = zS + hs;
  const sample = makeSampler(dem);
  const mPerLon = R_MARS * Math.cos(station.lat * DEG) * DEG, mPerLat = R_MARS * DEG;
  const ds = dem.meta.nominalResM / 2;
  const nSteps = Math.ceil(radiusM / ds);
  const nRays = Math.max(64, Math.ceil((2 * Math.PI * radiusM) / stepM * 2));
  // horizon profile: prof[k*nSteps + j] = max v over samples d_i=(i+1)·ds, i ≤ j along ray k (Infinity once nodata hit)
  const prof = new Float32Array(nRays * nSteps);
  const cosA = new Float64Array(nRays), sinA = new Float64Array(nRays);
  for (let k = 0; k < nRays; k++) {
    const ang = (2 * Math.PI * k) / nRays;
    cosA[k] = Math.cos(ang); sinA[k] = Math.sin(ang);
    let mx = -Infinity;
    for (let j = 0; j < nSteps; j++) {
      if (mx !== Infinity) {
        const d = (j + 1) * ds;
        const z = sample(station.lon + (d * cosA[k]) / mPerLon, station.lat + (d * sinA[k]) / mPerLat);
        if (z !== z) mx = Infinity; // nodata or off-DEM blocks everything beyond
        else { const v = (z - E) / d - d / TWO_R; if (v > mx) mx = v; }
      }
      prof[k * nSteps + j] = mx;
    }
  }
  let vis = 0, hid = 0;
  const r2 = radiusM * radiusM;
  for (let j = 0; j < width; j++) {
    const y = (n - j) * stepM;
    for (let i = 0; i < width; i++) {
      const x = (i - n) * stepM;
      const d2 = x * x + y * y;
      if (d2 > r2) continue;
      if (d2 === 0) { mask[j * width + i] = 1; vis++; continue; }
      const z = sample(station.lon + x / mPerLon, station.lat + y / mPerLat);
      if (z !== z) continue;
      const d = Math.sqrt(d2);
      let ang = Math.atan2(y, x); if (ang < 0) ang += 2 * Math.PI;
      const k = Math.round((ang / (2 * Math.PI)) * nRays) % nRays;
      const m = Math.ceil(d / ds - 1e-9) - 1; // samples strictly before the cell
      const maxV = m >= 1 ? prof[k * nSteps + Math.min(m, nSteps) - 1] : -Infinity;
      const vT = (z + ht - E) / d - d / TWO_R;
      if (maxV <= vT) { mask[j * width + i] = 1; vis++; } else { mask[j * width + i] = 2; hid++; }
    }
  }
  return result(vis, hid);
}
