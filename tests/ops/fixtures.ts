/**
 * Synthetic test fixture — NOT NASA data.
 * Hand-built DEMs and routes for the ops-science tests (lib/ops).
 */
import { DEFAULT_CONSTRAINTS, R_MARS } from '@/lib/contracts';
import type { Dem, LonLat, MissionConstraints, RouteResult } from '@/lib/contracts';
import { buildTimeline } from '@/lib/ops/timeline';
import { makeMeta } from '../fixtures/synthetic';

const DEG = Math.PI / 180;
export const LON_C = 77.4, LAT_C = 18.4;

/** DEM of n×n 20 m cells centred on (LON_C, LAT_C); z = f(eastM, northM) from the centre. */
export function makeFeatureDem(n: number, f: (x: number, y: number) => number): Dem {
  const meta = makeMeta(n, n, LON_C, LAT_C, 20);
  const elev = new Float32Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elev[r * n + c] = f((c + 0.5 - n / 2) * 20, (n / 2 - (r + 0.5)) * 20);
  return { meta, elev };
}

/** lon/lat offset by (east, north) metres from (lon0, lat0). */
export function offset(east: number, north: number, lon0 = LON_C, lat0 = LAT_C): LonLat {
  return { lon: lon0 + east / (R_MARS * Math.cos(lat0 * DEG) * DEG), lat: lat0 + north / (R_MARS * DEG) };
}

/** Minimal RouteResult from hand-made leg vertex lists (flat ground, h given). Totals come from the timeline. */
export function handRoute(
  legsPts: (LonLat & { h?: number })[][], over: Partial<RouteResult> & { constraints?: Partial<MissionConstraints> } = {},
): RouteResult {
  const constraints = { ...DEFAULT_CONSTRAINTS, ...over.constraints };
  const wp = (p: LonLat) => ({ id: 'w', ...p, elevationM: -2500, x: 0, z: 0, source: 'preset' as const });
  const legs = legsPts.map((pts) => ({
    path: pts.map((p) => ({ lon: p.lon, lat: p.lat, h: p.h ?? -2500 })),
    lengthM: 0, horizM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, timeMin: 0, segSlopeDeg: [],
  }));
  const route: RouteResult = {
    id: 'RH', label: 'hand', from: wp(legsPts[0][0]), to: wp(legsPts[0][legsPts[0].length - 1]),
    roundTrip: legsPts.length > 1, legs,
    totals: { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 },
    feasible: true, reasons: [], constraintsUsed: constraints, gridResM: 40, demResM: 20, computeMs: 0,
  };
  const tl = buildTimeline(route);
  route.totals = { ...route.totals, lengthM: tl.totalDistM, evaMin: tl.totalMin, walkMin: tl.totalMin - constraints.dwellMin * (legsPts.length > 1 ? legsPts.length - 1 : 1), batteryUsedPct: 100 - tl.samples[tl.samples.length - 1].batteryPct };
  return { ...route, ...over, constraintsUsed: constraints };
}

/** Straight vertex list from a to b every `stepM` metres (east/north offsets from the DEM centre). */
export function line(a: [number, number], b: [number, number], stepM = 20): LonLat[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.round(L / stepM));
  return Array.from({ length: n + 1 }, (_, i) => offset(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
}

import { pixelCentreLonLat } from '@/lib/geo/frame';
import { computeSlopeField } from '@/lib/terrain/slope';
import { buildPlanningGrid } from '@/lib/terrain/grid';
import { planRoute } from '@/lib/terrain/route';
import { makeSyntheticDem } from '../fixtures/synthetic';

const synDem = makeSyntheticDem();
const synGrid = buildPlanningGrid(synDem, computeSlopeField(synDem));
export { synDem };

/** Real planner output on the synthetic ridge DEM (south plain → saddle → north plain), id 'R1'. */
export function planSynthetic(over: Partial<MissionConstraints> = {}, roundTrip = true): RouteResult {
  const from = pixelCentreLonLat(synDem.meta, 30, 100), to = pixelCentreLonLat(synDem.meta, 90, 15);
  const k = { ...DEFAULT_CONSTRAINTS, ...over };
  const res = planRoute(synGrid, { from, to, roundTrip, constraints: k });
  const wp = (p: LonLat, id: string) => ({ id, ...p, elevationM: null, x: 0, z: 0, source: 'preset' as const });
  return { id: 'R1', label: 'synthetic crossing', from: wp(from, 'a'), to: wp(to, 'b'), ...res };
}
