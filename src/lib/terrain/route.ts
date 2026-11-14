import { G_MARS, R_MARS } from '@/lib/contracts';
import type { InfeasibleReason, LonLat, MissionConstraints, PlanningGrid, RouteLeg, RouteResult } from '@/lib/contracts';
import { groundDistanceM } from '../geo/frame';
import { gridCellLonLat, gridDxM, gridDyM, gridLonLatToCell } from './grid';
import { solvePath, toblerKmh } from './astar';

const DEG = Math.PI / 180;

export type PlanRequest = { from: LonLat; to: LonLat; stops?: LonLat[]; roundTrip: boolean; constraints: MissionConstraints; findMinSlope?: boolean };
export type PlanResult = Omit<RouteResult, 'id' | 'label' | 'from' | 'to' | 'stops'>;

/** Build a RouteLeg from grid cell indices. Vertices are cell centres with h = cell mean elevation. */
export function buildLeg(grid: PlanningGrid, cells: number[], suitSpeedFactor: number): RouteLeg {
  const W = grid.width;
  const path = cells.map((n) => {
    const r = (n / W) | 0, c = n - r * W;
    return { ...gridCellLonLat(grid, c, r), h: grid.elev[n] };
  });
  let lengthM = 0, horizM = 0, ascentM = 0, descentM = 0, maxSlopeDeg = 0, timeMin = 0;
  const segSlopeDeg: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const horiz = groundDistanceM(a, b);
    const dh = b.h - a.h;
    const len3 = Math.hypot(horiz, dh);
    const slope = Math.atan(Math.abs(dh) / horiz) / DEG;
    lengthM += len3; horizM += horiz;
    if (dh > 0) ascentM += dh; else descentM -= dh;
    if (slope > maxSlopeDeg) maxSlopeDeg = slope;
    segSlopeDeg.push(slope);
    timeMin += len3 / (toblerKmh(dh / horiz, suitSpeedFactor) * 1000 / 60);
  }
  return { path, lengthM, horizM, ascentM, descentM, maxSlopeDeg, timeMin, segSlopeDeg };
}

/**
 * Plan outbound (from -> stops -> to) and, if roundTrip, return (to -> from) legs, each solved
 * separately on the planning grid. Endpoints are snapped to the containing 40 m cell centre.
 *
 * All or nothing: if ANY leg has no path under the slope limit, the plan carries no legs and zero totals
 * (feasible = false, reasons ['no_path_slope'], minFeasibleSlopeDeg). A round trip is never reported from one
 * surviving leg. With the symmetric endpoint rule in solvePath, the outbound and return legs of a round trip
 * always succeed or fail together, and the round-trip length is the sum of the two legs (tested).
 * `targetSlopeDeg` is the steepest 20 m cell inside the target's 40 m planning cell (what the solver judged).
 * `findMinSlope: false` skips the 1° search for the smallest working limit (the reach sweep does not need it).
 */
export function planRoute(grid: PlanningGrid, req: PlanRequest): PlanResult {
  const t0 = performance.now();
  const k = req.constraints;
  const pts = [req.from, ...(req.stops ?? []), req.to];
  const base = {
    roundTrip: req.roundTrip, constraintsUsed: k, gridResM: grid.cellResM, demResM: grid.cellResM / 2,
  };
  const zero = { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 };
  const empty = (reason: InfeasibleReason, extra: Partial<PlanResult> = {}): PlanResult => ({
    ...base, legs: [], feasible: false, reasons: [reason], totals: { ...zero }, ...extra,
    computeMs: performance.now() - t0,
  });

  const cellIdx: number[] = [];
  for (const p of pts) {
    const cell = gridLonLatToCell(grid, p.lon, p.lat);
    if (!cell) return empty('out_of_bounds');
    cellIdx.push(cell.r * grid.width + cell.c);
  }
  for (const n of cellIdx) {
    if (!(grid.elev[n] === grid.elev[n]) || !(grid.slopeMaxDeg[n] === grid.slopeMaxDeg[n])) return empty('nodata_endpoint');
  }
  const targetSlopeDeg = grid.slopeMaxDeg[cellIdx[cellIdx.length - 1]];

  const specs: [number, number][] = [];
  for (let i = 0; i + 1 < cellIdx.length; i++) specs.push([cellIdx[i], cellIdx[i + 1]]);
  const outboundCount = specs.length;
  if (req.roundTrip) specs.push([cellIdx[cellIdx.length - 1], cellIdx[0]]);

  const params = { maxSlopeDeg: k.maxSlopeDeg, objective: k.objective, suitSpeedFactor: k.suitSpeedFactor };
  const findMin = req.findMinSlope !== false;
  const legs: RouteLeg[] = [];
  const failed: [number, number][] = [];
  for (const [a, b] of specs) {
    const res = solvePath(grid, a, b, params);
    if (res.ok) legs.push(buildLeg(grid, res.cells, k.suitSpeedFactor));
    else { failed.push([a, b]); if (!findMin) break; }
  }

  if (failed.length) {
    let minFeasibleSlopeDeg: number | null | undefined;
    if (findMin) {
      // smallest integer slope in (maxSlope, 45] that lets every failed leg through (monotone => bisection)
      let lo = Math.floor(k.maxSlopeDeg) + 1, hi = 46;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const ok = failed.every(([a, b]) => solvePath(grid, a, b, { ...params, maxSlopeDeg: mid }).ok);
        if (ok) hi = mid; else lo = mid + 1;
      }
      minFeasibleSlopeDeg = lo >= 46 ? null : lo;
    }
    return empty('no_path_slope', { targetSlopeDeg, ...(minFeasibleSlopeDeg !== undefined ? { minFeasibleSlopeDeg } : {}) });
  }

  let lengthM = 0, ascentM = 0, descentM = 0, maxSlopeDeg = 0, walkMin = 0;
  for (const l of legs) {
    lengthM += l.lengthM; ascentM += l.ascentM; descentM += l.descentM; walkMin += l.timeMin;
    if (l.maxSlopeDeg > maxSlopeDeg) maxSlopeDeg = l.maxSlopeDeg;
  }
  const dwellCount = outboundCount; // stops + target
  const evaMin = walkMin + k.dwellMin * dwellCount;
  const pctPerMin = (k.suitPowerW / 60) / k.batteryWh * 100;
  const batteryUsedPct = evaMin * pctPerMin;
  const climbWorkKJ = k.crewMassKg * G_MARS * ascentM / 1000;
  const batteryLimit = 100 - k.batteryReservePct;
  const reasons: InfeasibleReason[] = [];

  let turnBackIndex: { leg: number; vertex: number } | null | undefined;
  if (batteryUsedPct > batteryLimit) {
    reasons.push('battery_reserve');
    turnBackIndex = null;
    let t = 0;
    outer: for (let li = 0; li < legs.length; li++) {
      const leg = legs[li];
      if (li === 0 && t * pctPerMin > batteryLimit) { turnBackIndex = { leg: 0, vertex: 0 }; break; }
      let tl = 0;
      for (let v = 1; v < leg.path.length; v++) {
        const a = leg.path[v - 1], b = leg.path[v];
        const horiz = groundDistanceM(a, b), dh = b.h - a.h;
        tl += Math.hypot(horiz, dh) / (toblerKmh(dh / horiz, k.suitSpeedFactor) * 1000 / 60);
        if ((t + tl) * pctPerMin > batteryLimit) { turnBackIndex = { leg: li, vertex: v }; break outer; }
      }
      t += tl;
      if (li < outboundCount) {
        t += k.dwellMin; // dwell at stop / target
        if (t * pctPerMin > batteryLimit) { turnBackIndex = { leg: li, vertex: leg.path.length - 1 }; break; }
      }
    }
  }
  if (evaMin > k.evaMaxMin) reasons.push('eva_time');

  return {
    ...base, legs,
    totals: { lengthM, ascentM, descentM, maxSlopeDeg, walkMin, evaMin, batteryUsedPct, climbWorkKJ },
    feasible: reasons.length === 0,
    reasons,
    targetSlopeDeg,
    ...(turnBackIndex !== undefined ? { turnBackIndex } : {}),
    computeMs: performance.now() - t0,
  };
}

const DC8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const DR8 = [-1, -1, -1, 0, 0, 1, 1, 1];

export interface NearestReachable {
  /** Centre of the reachable planning cell closest to the target, or null when none is within maxRadiusM. */
  point: LonLat | null;
  /** Ground distance from the requested target to that point, m. */
  movedM: number | null;
  /** Steepest 20 m cell inside the chosen 40 m cell (deg). */
  slopeDeg: number | null;
  reason?: 'start_blocked' | 'none_within_radius' | 'out_of_bounds';
}

/**
 * The point nearest to `to` that the crew can reach from `from` (and get back from) under the slope limit: a flood fill
 * from the start cell with exactly the solver's admissibility rules (cell max slope and edge grade under the limit),
 * then the reachable cell whose centre is closest to the target. Reachability is symmetric, so a round trip on slope
 * alone always exists to the returned point; battery and time are checked when that point is planned.
 */
export function nearestReachable(grid: PlanningGrid, from: LonLat, to: LonLat, maxSlopeDeg: number, maxRadiusM = 1000): NearestReachable {
  const W = grid.width, H = grid.height, { elev, slopeMaxDeg } = grid;
  const a = gridLonLatToCell(grid, from.lon, from.lat), b = gridLonLatToCell(grid, to.lon, to.lat);
  if (!a || !b) return { point: null, movedM: null, slopeDeg: null, reason: 'out_of_bounds' };
  const s = a.r * W + a.c;
  if (!(elev[s] === elev[s]) || !(slopeMaxDeg[s] <= maxSlopeDeg)) return { point: null, movedM: null, slopeDeg: null, reason: 'start_blocked' };
  const tanMax = Math.tan(maxSlopeDeg * DEG);
  const seen = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0, tail = 0;
  queue[tail++] = s; seen[s] = 1;
  const lat = (r: number) => grid.latMax - (r + 0.5) * grid.dLat;
  const dy = gridDyM(grid);
  // the target's search window, in cells (rows are uniform; columns use the narrowest row in the window)
  const rWin = Math.ceil(maxRadiusM / dy) + 1;
  let best = -1, bestD = Infinity;
  const consider = (n: number) => {
    const r = (n / W) | 0, c = n - r * W;
    if (Math.abs(r - b.r) > rWin) return;
    const p = gridCellLonLat(grid, c, r);
    const d = groundDistanceM(p, to);
    if (d < bestD) { bestD = d; best = n; }
  };
  consider(s);
  while (head < tail) {
    const n = queue[head++];
    const r = (n / W) | 0, c = n - r * W;
    const e0 = elev[n], dxr = gridDxM(grid, r);
    for (let k = 0; k < 8; k++) {
      const c2 = c + DC8[k], r2 = r + DR8[k];
      if (c2 < 0 || c2 >= W || r2 < 0 || r2 >= H) continue;
      const m = r2 * W + c2;
      if (seen[m]) continue;
      const e1 = elev[m];
      if (e1 !== e1 || !(slopeMaxDeg[m] <= maxSlopeDeg)) continue;
      const horiz = DR8[k] === 0 ? dxr : DC8[k] === 0 ? dy : Math.hypot(R_MARS * Math.cos(((lat(r) + lat(r2)) / 2) * DEG) * grid.dLon * DEG, dy);
      if (Math.abs(e1 - e0) > horiz * tanMax) continue;
      seen[m] = 1;
      queue[tail++] = m;
      consider(m);
    }
  }
  if (best < 0 || bestD > maxRadiusM) return { point: null, movedM: null, slopeDeg: null, reason: 'none_within_radius' };
  const br = (best / W) | 0, bc = best - br * W;
  return { point: gridCellLonLat(grid, bc, br), movedM: bestD, slopeDeg: slopeMaxDeg[best] };
}
