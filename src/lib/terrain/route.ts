import { G_MARS } from '@/lib/contracts';
import type { InfeasibleReason, LonLat, MissionConstraints, PlanningGrid, RouteLeg, RouteResult } from '@/lib/contracts';
import { groundDistanceM } from '../geo/frame';
import { gridCellLonLat, gridLonLatToCell } from './grid';
import { solvePath, toblerKmh } from './astar';

const DEG = Math.PI / 180;

export type PlanRequest = { from: LonLat; to: LonLat; stops?: LonLat[]; roundTrip: boolean; constraints: MissionConstraints };
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
 */
export function planRoute(grid: PlanningGrid, req: PlanRequest): PlanResult {
  const t0 = performance.now();
  const k = req.constraints;
  const pts = [req.from, ...(req.stops ?? []), req.to];
  const base = {
    roundTrip: req.roundTrip, constraintsUsed: k, gridResM: grid.cellResM, demResM: grid.cellResM / 2,
  };
  const empty = (reason: InfeasibleReason): PlanResult => ({
    ...base, legs: [], feasible: false, reasons: [reason],
    totals: { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 },
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

  const specs: [number, number][] = [];
  for (let i = 0; i + 1 < cellIdx.length; i++) specs.push([cellIdx[i], cellIdx[i + 1]]);
  const outboundCount = specs.length;
  if (req.roundTrip) specs.push([cellIdx[cellIdx.length - 1], cellIdx[0]]);

  const params = { maxSlopeDeg: k.maxSlopeDeg, objective: k.objective, suitSpeedFactor: k.suitSpeedFactor };
  const legs: RouteLeg[] = [];
  const failed: [number, number][] = [];
  for (const [a, b] of specs) {
    const res = solvePath(grid, a, b, params);
    if (res.ok) legs.push(buildLeg(grid, res.cells, k.suitSpeedFactor));
    else failed.push([a, b]);
  }

  const reasons: InfeasibleReason[] = [];
  let minFeasibleSlopeDeg: number | null | undefined;
  if (failed.length) {
    reasons.push('no_path_slope');
    // smallest integer slope in (maxSlope, 45] that lets every failed leg through (monotone => bisection)
    let lo = Math.floor(k.maxSlopeDeg) + 1, hi = 46;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const ok = failed.every(([a, b]) => solvePath(grid, a, b, { ...params, maxSlopeDeg: mid }).ok);
      if (ok) hi = mid; else lo = mid + 1;
    }
    minFeasibleSlopeDeg = lo >= 46 ? null : lo;
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
    ...(minFeasibleSlopeDeg !== undefined ? { minFeasibleSlopeDeg } : {}),
    ...(turnBackIndex !== undefined ? { turnBackIndex } : {}),
    computeMs: performance.now() - t0,
  };
}
