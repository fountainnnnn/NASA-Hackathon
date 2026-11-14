/**
 * SYNTHETIC test data for the scenario preview page and tests. NOT NASA data, NOT Jezero.
 * A generated height field, a hand-drawn route over it, and a fake round-trip planner.
 * Coordinates sit near Jezero only so the lon/lat maths is exercised at a realistic latitude.
 */
import { DEFAULT_CONSTRAINTS, G_MARS } from '../../lib/contracts';
import type { DemMeta, LonLat, MissionConstraints, RouteLeg, RouteResult, WorldPoint } from '../../lib/contracts';
import { groundDistanceM, toLocal, toLonLat } from '../../lib/geo/frame';
import { toblerKmh } from '../../lib/terrain/astar';
import type { PlanRoundTrip } from './reach';
import type { GroundApi } from './model';

const DEG = Math.PI / 180;

export const SYN_HALF_M = 4000;
export const SYN_EXAG = 1.6;
export const SYN_CONSTRAINTS: MissionConstraints = { ...DEFAULT_CONSTRAINTS, batteryWh: 700 };
export const SYN_BASE = { x: -700, z: 700 };
export const SYN_TARGET = { x: -300, z: -450 };

const META = (() => {
  const lonC = 77.45, latC = 18.44, half = SYN_HALF_M * 1.2;
  const dLat = (half / 3_396_190) / DEG, dLon = dLat / Math.cos(latC * DEG);
  return { lonMin: lonC - dLon, lonMax: lonC + dLon, latMin: latC - dLat, latMax: latC + dLat } as DemMeta;
})();

export const synLocal = (lon: number, lat: number) => toLocal(META, lon, lat);
export const synLonLat = (x: number, z: number): LonLat => toLonLat(META, x, z);

const g2 = (d: number, s: number) => Math.exp(-((d / s) ** 2));

/** Synthetic height (m, absolute; hRef = 0) at local metres (x east, z south). */
export function synHeight(x: number, z: number): number {
  let h = 18 * Math.sin(x / 410) * Math.cos(z / 360) + 9 * Math.sin(x / 170 + z / 230) + 4 * Math.sin(z / 95 + x / 140);
  const crater = (cx: number, cz: number, R: number, rim: number, depth: number) => {
    const r = Math.hypot(x - cx, z - cz);
    return (r < R ? -depth * (1 - (r / R) ** 2) : 0) + rim * g2(r - R, R * 0.115);
  };
  h += crater(800, -500, 950, 95, 40);
  h += crater(-1300, -1500, 380, 38, 22);
  h += 70 * g2(Math.hypot(x + 1900, z - 900), 520);
  h += 40 * g2(Math.hypot(x - 1900, z - 1700), 420);
  return h;
}

export function synGround(exag = SYN_EXAG): GroundApi {
  return { exag, toLocal: synLocal, y: (x, z, h) => (h == null ? synHeight(x, z) : h) * exag };
}

/* ------------------------------------------------------------------ route building (mirrors the planner's own formulas) */

type XZ = [number, number];

function catmull(pts: XZ[], stepM: number): XZ[] {
  const out: XZ[] = [];
  const P = (i: number) => pts[Math.min(pts.length - 1, Math.max(0, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.round(len / stepM));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function legFromXZ(xz: XZ[], suitSpeedFactor: number): RouteLeg {
  const path = xz.map(([x, z]) => ({ ...synLonLat(x, z), h: synHeight(x, z) }));
  let lengthM = 0, horizM = 0, ascentM = 0, descentM = 0, maxSlopeDeg = 0, timeMin = 0;
  const segSlopeDeg: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    const horiz = groundDistanceM(a, b), dh = b.h - a.h, len3 = Math.hypot(horiz, dh);
    const slope = Math.atan(Math.abs(dh) / horiz) / DEG;
    lengthM += len3; horizM += horiz;
    if (dh > 0) ascentM += dh; else descentM -= dh;
    if (slope > maxSlopeDeg) maxSlopeDeg = slope;
    segSlopeDeg.push(slope);
    timeMin += len3 / (toblerKmh(dh / horiz, suitSpeedFactor) * 1000 / 60);
  }
  return { path, lengthM, horizM, ascentM, descentM, maxSlopeDeg, timeMin, segSlopeDeg };
}

const wp = (id: string, x: number, z: number, label: string): WorldPoint => {
  const ll = synLonLat(x, z);
  return { id, ...ll, elevationM: synHeight(x, z), x, z, source: 'preset', label };
};

/** Same totals, battery and turn-back logic as lib/terrain/route.ts, on synthetic legs. */
export function assembleRoute(id: string, legs: RouteLeg[], from: WorldPoint, to: WorldPoint, k: MissionConstraints): RouteResult {
  const outboundCount = legs.length - 1;
  let lengthM = 0, ascentM = 0, descentM = 0, maxSlopeDeg = 0, walkMin = 0;
  for (const l of legs) {
    lengthM += l.lengthM; ascentM += l.ascentM; descentM += l.descentM; walkMin += l.timeMin;
    if (l.maxSlopeDeg > maxSlopeDeg) maxSlopeDeg = l.maxSlopeDeg;
  }
  const evaMin = walkMin + k.dwellMin * outboundCount;
  const pctPerMin = (k.suitPowerW / 60) / k.batteryWh * 100;
  const batteryUsedPct = evaMin * pctPerMin;
  const climbWorkKJ = k.crewMassKg * G_MARS * ascentM / 1000;
  const limit = 100 - k.batteryReservePct;
  const reasons: RouteResult['reasons'] = [];
  let turnBackIndex: RouteResult['turnBackIndex'];
  if (batteryUsedPct > limit) {
    reasons.push('battery_reserve');
    turnBackIndex = null;
    let t = 0;
    outer: for (let li = 0; li < legs.length; li++) {
      const leg = legs[li];
      let tl = 0;
      for (let v = 1; v < leg.path.length; v++) {
        const a = leg.path[v - 1], b = leg.path[v];
        const horiz = groundDistanceM(a, b), dh = b.h - a.h;
        tl += Math.hypot(horiz, dh) / (toblerKmh(dh / horiz, k.suitSpeedFactor) * 1000 / 60);
        if ((t + tl) * pctPerMin > limit) { turnBackIndex = { leg: li, vertex: v }; break outer; }
      }
      t += tl;
      if (li < outboundCount) {
        t += k.dwellMin;
        if (t * pctPerMin > limit) { turnBackIndex = { leg: li, vertex: leg.path.length - 1 }; break; }
      }
    }
  }
  if (evaMin > k.evaMaxMin) reasons.push('eva_time');
  return {
    id, label: 'Synthetic route', from, to, roundTrip: true, legs,
    totals: { lengthM, ascentM, descentM, maxSlopeDeg, walkMin, evaMin, batteryUsedPct, climbWorkKJ },
    feasible: reasons.length === 0, reasons, ...(turnBackIndex !== undefined ? { turnBackIndex } : {}),
    constraintsUsed: k, gridResM: 40, demResM: 20, computeMs: 0,
  };
}

const OUT_CTRL: XZ[] = [[SYN_BASE.x, SYN_BASE.z], [-620, 420], [-520, 120], [-420, -200], [SYN_TARGET.x, SYN_TARGET.z]];
const BACK_CTRL: XZ[] = [[SYN_TARGET.x, SYN_TARGET.z], [-200, -250], [-330, 60], [-480, 380], [SYN_BASE.x, SYN_BASE.z]];

/** The demo round trip. Pass a smaller batteryWh to make it infeasible and see the turn-back behaviour. */
export function buildSyntheticRoute(constraints: MissionConstraints = SYN_CONSTRAINTS): RouteResult {
  const out = legFromXZ(catmull(OUT_CTRL, 40), constraints.suitSpeedFactor);
  const back = legFromXZ(catmull(BACK_CTRL, 40), constraints.suitSpeedFactor);
  return assembleRoute('SYN1', [out, back], wp('A', SYN_BASE.x, SYN_BASE.z, 'Synthetic base'), wp('B', SYN_TARGET.x, SYN_TARGET.z, 'Synthetic target'), constraints);
}

/** FAKE planner for the preview and tests: straight line out, same line back, blocked by slope or the map edge. */
export function makeSyntheticPlanner(constraints: MissionConstraints = SYN_CONSTRAINTS, delayMs = 0): PlanRoundTrip {
  return async (from: LonLat, to: LonLat) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const a = synLocal(from.lon, from.lat), b = synLocal(to.lon, to.lat);
    const fromP = wp('A', a.x, a.z, 'from'), toP = wp('B', b.x, b.z, 'to');
    const base = { id: 'SYNP', label: 'Synthetic plan', from: fromP, to: toP, roundTrip: true, constraintsUsed: constraints, gridResM: 40, demResM: 20, computeMs: 0 };
    const empty = (reason: RouteResult['reasons'][number]): RouteResult => ({
      ...base, legs: [], totals: { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 }, feasible: false, reasons: [reason],
    });
    if (Math.abs(b.x) > SYN_HALF_M || Math.abs(b.z) > SYN_HALF_M) return empty('out_of_bounds');
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.round(len / 40));
    const xz: XZ[] = Array.from({ length: n + 1 }, (_, i) => [a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n]);
    const out = legFromXZ(xz, constraints.suitSpeedFactor);
    if (out.maxSlopeDeg > constraints.maxSlopeDeg) return empty('no_path_slope');
    const back = legFromXZ([...xz].reverse(), constraints.suitSpeedFactor);
    return assembleRoute('SYNP', [out, back], fromP, toP, constraints);
  };
}
