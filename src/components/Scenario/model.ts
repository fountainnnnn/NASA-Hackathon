/**
 * Scenario timeline model (pure, no three.js, no React). Turns a RouteResult into a walkable timeline.
 *
 * NOTHING here invents a speed for the walking portion. Segment durations come from the route's own model:
 * Tobler speed scaled by constraintsUsed.suitSpeedFactor (same function the planner uses), then normalised so
 * each leg sums exactly to RouteLeg.timeMin. Dwell at each outbound stop is constraintsUsed.dwellMin, as the
 * planner counts it. Battery % at time t = suitPowerW * t / batteryWh (the planner's own energy model).
 */
import { G_MARS } from '../../lib/contracts';
import type { LonLat, MissionConstraints, RouteLeg, RouteResult } from '../../lib/contracts';
import { groundDistanceM } from '../../lib/geo/frame';
import { toblerKmh } from '../../lib/terrain/astar';

/* ------------------------------------------------------------------ assumptions (the ONLY invented numbers) */

/**
 * ASSUMPTION: rover cruise speed in km/h while carrying the crew. Not a NASA figure for any specific vehicle;
 * pressurised and unpressurised rover concepts differ. Change it here and the UI label updates.
 */
export const ROVER_SPEED_KMH = 10;
/** ASSUMPTION: suit life support keeps drawing suitPowerW while riding (conservative; the crew stays suited). */
export const SUIT_DRAWS_ON_ROVER = true;
/** ASSUMPTION: spacing between the two crew along the path, metres (buddy pair, visual and safety separation). */
export const PAIR_SEPARATION_M = 4;

/* ------------------------------------------------------------------ types */

export interface GroundApi {
  /** Vertical exaggeration applied by the host scene (y = (h - hRef) * exag). */
  exag: number;
  toLocal(lon: number, lat: number): { x: number; z: number };
  /** World y for a ground point. hAbs = true elevation above the areoid when known. */
  y(x: number, z: number, hAbs?: number | null): number;
}

export interface Vtx { x: number; z: number; h: number; lon: number; lat: number }
export type SegKind = 'walk' | 'rover' | 'dwell';

export interface Seg {
  kind: SegKind;
  t0: number; t1: number;       // seconds
  d0: number; d1: number;       // odometer metres (3D path length travelled), equal for dwell
  a: Vtx; b: Vtx;
  /** Absolute slope of the segment in degrees (RouteLeg.segSlopeDeg, same values when walking forward). */
  slopeDeg: number;
  leg: number;
  reversed: boolean;
}

export type MarkerKind = 'start' | 'dwell' | 'rover-dropoff' | 'turn-back' | 'return' | 'end';
export interface TimelineMarker { id: string; kind: MarkerKind; tS: number; label: string; v: Vtx; legIndex: number }

export interface WalkSummary {
  walkMin: number; roverMin: number; dwellMin: number; evaMin: number;
  batteryUsedPct: number; reserveLeftPct: number;
  /** Time and battery of the same route with no rover, for comparison. */
  walkOnlyEvaMin: number; walkOnlyBatteryPct: number;
  roverDistM: number; totalDistM: number;
  turnedBack: boolean;
}

export interface Timeline {
  routeId: string;
  segs: Seg[];
  durationS: number;
  distM: number;
  markers: TimelineMarker[];
  constraints: MissionConstraints;
  /** Seconds at which the first outbound leg group ends (start of return leg), or turn-back time. */
  turnAroundS: number | null;
  /** Seconds the rover carries the crew (0 if no rover). */
  roverEndS: number;
  roverDropoff: Vtx | null;
  summary: WalkSummary;
  /** Route-feasibility context for UI. */
  feasible: boolean;
  /** Where the crew turns around when the route is infeasible; null when the route is feasible. */
  turnBack: { tS: number; v: Vtx; batteryPct: number } | null;
}

export interface BuildOptions {
  /** 0..1: fraction of the OUTBOUND distance carried by the rover (0 = walk everything). */
  roverFraction?: number;
  roverKmh?: number;
}

/* ------------------------------------------------------------------ building */

function vtx(p: LonLat & { h: number }, g: Pick<GroundApi, 'toLocal'>): Vtx {
  const l = g.toLocal(p.lon, p.lat);
  return { x: l.x, z: l.z, h: p.h, lon: p.lon, lat: p.lat };
}

/** Per-segment [3D length m, tobler minutes] of a leg walked forward or reversed, normalised to leg.timeMin. */
export function legSegments(leg: RouteLeg, suitSpeedFactor: number, reversed: boolean): { len: number; min: number; slope: number }[] {
  const out: { len: number; min: number; slope: number }[] = [];
  const n = leg.path.length;
  let raw = 0;
  for (let i = 0; i + 1 < n; i++) {
    const a = leg.path[i], b = leg.path[i + 1];
    const horiz = Math.max(1e-6, groundDistanceM(a, b));
    const dh = reversed ? a.h - b.h : b.h - a.h;
    const len = Math.hypot(horiz, dh);
    const min = len / ((toblerKmh(dh / horiz, suitSpeedFactor) * 1000) / 60);
    raw += min;
    out.push({ len, min, slope: leg.segSlopeDeg[i] ?? (Math.atan(Math.abs(dh) / horiz) * 180) / Math.PI });
  }
  // only the forward pass is normalised to the planner's reported leg time
  if (!reversed && raw > 0 && leg.timeMin > 0) {
    const k = leg.timeMin / raw;
    for (const s of out) s.min *= k;
  }
  return out;
}

export function pctPerSecond(c: MissionConstraints): number {
  return ((c.suitPowerW / 3600) / c.batteryWh) * 100;
}

/** Battery used (%) after tS seconds of EVA, planner model, capped at 100. */
export function batteryUsedAt(tS: number, c: MissionConstraints): number {
  return Math.min(100, Math.max(0, tS) * pctPerSecond(c));
}
export function batteryLeftAt(tS: number, c: MissionConstraints): number {
  return 100 - batteryUsedAt(tS, c);
}

export function buildTimeline(route: RouteResult, ground: Pick<GroundApi, 'toLocal'>, opts: BuildOptions = {}): Timeline {
  const c = route.constraintsUsed;
  const rf = Math.min(1, Math.max(0, opts.roverFraction ?? 0));
  const roverMps = ((opts.roverKmh ?? ROVER_SPEED_KMH) * 1000) / 3600;
  const returnLegs = route.roundTrip && route.legs.length > 1 ? 1 : 0;
  const outboundCount = route.legs.length - returnLegs;
  const dwellS = c.dwellMin * 60;

  // ---- 1. natural (forward) sequence of steps: walk segments and dwells, all with walking durations
  interface Step { seg: Seg; legIndex: number; vIndex: number }
  const steps: Step[] = [];
  let t = 0, d = 0;
  const markers: TimelineMarker[] = [];
  const segPerLeg: { len: number; min: number; slope: number }[][] = route.legs.map((l) => legSegments(l, c.suitSpeedFactor, false));

  // rover covers the first rf of outbound distance
  const outLen = route.legs.slice(0, outboundCount).reduce((s, l, i) => s + segPerLeg[i].reduce((q, x) => q + x.len, 0), 0);
  const roverBudget = rf * outLen;
  let roverUsed = 0;
  let roverEndS = 0;
  let roverDrop: Vtx | null = null;

  route.legs.forEach((leg, li) => {
    const segs = segPerLeg[li];
    for (let i = 0; i < segs.length; i++) {
      const a = vtx(leg.path[i], ground), b = vtx(leg.path[i + 1], ground);
      const s = segs[i];
      const onRover = li < outboundCount && roverUsed + s.len <= roverBudget + 1e-9 && rf > 0;
      let dur = s.min * 60;
      if (onRover) { dur = s.len / roverMps; roverUsed += s.len; }
      const seg: Seg = { kind: onRover ? 'rover' : 'walk', t0: t, t1: t + dur, d0: d, d1: d + s.len, a, b, slopeDeg: s.slope, leg: li, reversed: false };
      steps.push({ seg, legIndex: li, vIndex: i + 1 });
      t += dur; d += s.len;
      if (onRover) { roverEndS = t; roverDrop = b; }
    }
    if (li < outboundCount) {
      const end = leg.path.length ? vtx(leg.path[leg.path.length - 1], ground) : null;
      if (end) {
        const isTarget = li === outboundCount - 1;
        markers.push({ id: `stop-${li}`, kind: 'dwell', tS: t, label: isTarget ? 'Target' : `Stop ${li + 1}`, v: end, legIndex: li });
        if (dwellS > 0) steps.push({ seg: { kind: 'dwell', t0: t, t1: t + dwellS, d0: d, d1: d, a: end, b: end, slopeDeg: 0, leg: li, reversed: false }, legIndex: li, vIndex: leg.path.length - 1 });
        t += dwellS;
      }
    }
  });
  if (roverDrop && roverEndS > 0) {
    markers.push({ id: 'rover-dropoff', kind: 'rover-dropoff', tS: roverEndS, label: 'Rover drop off', v: roverDrop, legIndex: 0 });
  }
  const firstPt = route.legs[0]?.path[0];
  if (firstPt) markers.unshift({ id: 'start', kind: 'start', tS: 0, label: 'Base', v: vtx(firstPt, ground), legIndex: 0 });

  // ---- 2. turn back when the route is infeasible by battery
  const tb = route.turnBackIndex;
  let turnBack: Timeline['turnBack'] = null;
  let segsOut: Seg[] = steps.map((s) => s.seg);
  let turnAroundS: number | null = null;

  if (returnLegs && outboundCount >= 1) {
    // start of the return leg
    const rs = steps.find((s) => s.legIndex === outboundCount);
    if (rs) {
      turnAroundS = rs.seg.t0;
      markers.push({ id: 'return', kind: 'return', tS: rs.seg.t0, label: 'Start return', v: rs.seg.a, legIndex: outboundCount });
    }
  }

  let turnedAround = false;
  if (!route.feasible && route.reasons.includes('battery_reserve') && tb && tb.leg >= outboundCount && returnLegs) {
    // the reserve line is crossed on the way home: nothing to turn around from, the crew keeps walking home but the line is marked
    const rl = route.legs[tb.leg];
    const v = rl?.path[tb.vertex];
    const hit = v && steps.find((x) => x.legIndex === tb.leg && x.vIndex === tb.vertex && x.seg.kind !== 'dwell');
    if (v && hit) {
      turnBack = { tS: hit.seg.t1, v: vtx(v, ground), batteryPct: batteryUsedAt(hit.seg.t1, c) };
      markers.push({ id: 'turn-back', kind: 'turn-back', tS: hit.seg.t1, label: 'Reserve line crossed on the way home', v: turnBack.v, legIndex: tb.leg });
    }
  } else if (!route.feasible && route.reasons.includes('battery_reserve') && tb) {
    turnedAround = true;
    // keep steps up to (leg, vertex), then retrace the same path back to the start with reversed-grade Tobler times
    const cut = steps.findIndex((s) => s.legIndex === tb.leg && s.vIndex === tb.vertex && s.seg.kind !== 'dwell');
    let kept: Seg[];
    if (cut >= 0) kept = steps.slice(0, cut + 1).map((s) => s.seg);
    else if (tb.vertex === 0 && tb.leg === 0) kept = [];
    else {
      // vertex at the very end of a leg during dwell: keep through the walk, the dwell is truncated below
      const lastWalk = steps.findIndex((s) => s.legIndex === tb.leg && s.vIndex === tb.vertex);
      kept = lastWalk >= 0 ? steps.slice(0, lastWalk + 1).map((s) => s.seg) : steps.map((s) => s.seg);
    }
    const cutT = kept.length ? kept[kept.length - 1].t1 : 0;
    const cutV = kept.length ? kept[kept.length - 1].b : (segsOut[0]?.a ?? null);
    const back: Seg[] = [];
    let tt = cutT, dd = kept.length ? kept[kept.length - 1].d1 : 0;
    for (let i = kept.length - 1; i >= 0; i--) {
      const k = kept[i];
      if (k.kind === 'dwell') continue;
      const horiz = Math.max(1e-6, groundDistanceM(k.b, k.a));
      const dh = k.a.h - k.b.h;
      const len = Math.hypot(horiz, dh);
      const dur = len / ((toblerKmh(dh / horiz, c.suitSpeedFactor) * 1000) / 60) * 60;
      back.push({ kind: 'walk', t0: tt, t1: tt + dur, d0: dd, d1: dd + len, a: k.b, b: k.a, slopeDeg: k.slopeDeg, leg: k.leg, reversed: true });
      tt += dur; dd += len;
    }
    segsOut = [...kept, ...back];
    if (cutV) {
      turnBack = { tS: cutT, v: cutV, batteryPct: batteryUsedAt(cutT, c) };
      const keepM = markers.filter((m) => m.tS < cutT - 1e-9 && m.kind !== 'return');
      markers.length = 0;
      markers.push(...keepM);
      markers.push({ id: 'turn-back', kind: 'turn-back', tS: cutT, label: 'Turn back, reserve reached', v: cutV, legIndex: tb.leg });
      turnAroundS = cutT;
    }
  }

  const last = segsOut[segsOut.length - 1];
  const durationS = last ? last.t1 : 0;
  const distM = last ? last.d1 : 0;
  if (last) markers.push({ id: 'end', kind: 'end', tS: durationS, label: 'Back at base', v: last.b, legIndex: last.leg });
  markers.sort((a, b) => a.tS - b.tS);

  // ---- 3. summary (rover vs walk only)
  const walkSegS = segsOut.filter((s) => s.kind === 'walk').reduce((q, s) => q + (s.t1 - s.t0), 0);
  const roverSegS = segsOut.filter((s) => s.kind === 'rover').reduce((q, s) => q + (s.t1 - s.t0), 0);
  const dwellSegS = segsOut.filter((s) => s.kind === 'dwell').reduce((q, s) => q + (s.t1 - s.t0), 0);
  const roverDistM = segsOut.filter((s) => s.kind === 'rover').reduce((q, s) => q + (s.d1 - s.d0), 0);
  const evaMin = durationS / 60;
  // power on the rover: the planner model draws suitPowerW the whole EVA; if the suit were off on the rover it would be lower
  const powerS = SUIT_DRAWS_ON_ROVER ? durationS : durationS - roverSegS;
  const batteryUsedPct = Math.min(100, powerS * pctPerSecond(c));
  const walkOnlyEva = route.totals.evaMin;
  const summary: WalkSummary = {
    walkMin: walkSegS / 60, roverMin: roverSegS / 60, dwellMin: dwellSegS / 60, evaMin,
    batteryUsedPct, reserveLeftPct: 100 - batteryUsedPct,
    walkOnlyEvaMin: walkOnlyEva, walkOnlyBatteryPct: route.totals.batteryUsedPct,
    roverDistM, totalDistM: distM, turnedBack: turnedAround,
  };

  return {
    routeId: route.id, segs: segsOut, durationS, distM, markers, constraints: c, turnAroundS,
    roverEndS, roverDropoff: roverDrop, summary, feasible: route.feasible, turnBack,
  };
}

/* ------------------------------------------------------------------ sampling */

export interface Sample {
  x: number; z: number; h: number;
  /** direction of travel as atan2(dx, -dz): 0 = north (-z), pi/2 = east (+x), compass-style radians */
  headingRad: number;
  slopeDeg: number;
  mode: SegKind;
  odometerM: number;
  segIndex: number;
  leg: number;
  reversed: boolean;
  /** metres per second of the current segment (0 when dwelling) */
  speedMps: number;
}

function findByTime(segs: Seg[], tS: number): number {
  let lo = 0, hi = segs.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= tS) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function headingOf(a: Vtx, b: Vtx): number { return Math.atan2(b.x - a.x, -(b.z - a.z)); }

function make(segs: Seg[], i: number, f: number): Sample {
  const s = segs[i];
  const x = s.a.x + (s.b.x - s.a.x) * f, z = s.a.z + (s.b.z - s.a.z) * f, h = s.a.h + (s.b.h - s.a.h) * f;
  let heading = headingOf(s.a, s.b);
  if (s.kind === 'dwell' || (s.a.x === s.b.x && s.a.z === s.b.z)) {
    // face along the path: previous moving segment, else next
    let j = i - 1;
    while (j >= 0 && segs[j].a.x === segs[j].b.x && segs[j].a.z === segs[j].b.z) j--;
    if (j < 0) { j = i + 1; while (j < segs.length && segs[j].a.x === segs[j].b.x && segs[j].a.z === segs[j].b.z) j++; }
    if (j >= 0 && j < segs.length) heading = headingOf(segs[j].a, segs[j].b);
  }
  const dur = s.t1 - s.t0;
  return {
    x, z, h, headingRad: heading, slopeDeg: s.slopeDeg, mode: s.kind,
    odometerM: s.d0 + (s.d1 - s.d0) * f, segIndex: i, leg: s.leg, reversed: s.reversed,
    speedMps: s.kind === 'dwell' || dur <= 0 ? 0 : (s.d1 - s.d0) / dur,
  };
}

/** Position of the lead astronaut at mission time tS (clamped to the timeline). */
export function sampleAtTime(tl: Timeline, tS: number): Sample | null {
  const segs = tl.segs;
  if (!segs.length) return null;
  const t = Math.min(tl.durationS, Math.max(0, tS));
  const i = findByTime(segs, t);
  const s = segs[i];
  const dur = s.t1 - s.t0;
  return make(segs, i, dur > 0 ? Math.min(1, (t - s.t0) / dur) : 1);
}

/** Position after travelling odometer metres (clamped). Used for the trailing partner. */
export function sampleAtOdometer(tl: Timeline, odo: number): Sample | null {
  const segs = tl.segs;
  if (!segs.length) return null;
  const o = Math.min(tl.distM, Math.max(0, odo));
  // binary search on d0 among moving segments
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].d0 <= o) lo = mid; else hi = mid - 1;
  }
  // step over dwell (zero length) segments, preferring a moving one that contains o
  let i = lo;
  while (i < segs.length - 1 && (segs[i].kind === 'dwell' || segs[i].d1 <= o) && segs[i + 1].d0 <= o + 1e-9) i++;
  while (i > 0 && segs[i].kind === 'dwell') i--;
  const s = segs[i];
  const len = s.d1 - s.d0;
  return make(segs, i, len > 0 ? Math.min(1, (o - s.d0) / len) : 1);
}

/** Slope (deg) of the next `aheadM` metres of path from the odometer position (length-weighted mean of segment slopes). */
export function slopeAhead(tl: Timeline, odo: number, aheadM = 100): { meanDeg: number; maxDeg: number; lengthM: number } {
  let acc = 0, len = 0, max = 0;
  const end = odo + aheadM;
  for (const s of tl.segs) {
    if (s.kind === 'dwell' || s.d1 <= odo) continue;
    if (s.d0 >= end) break;
    const l = Math.min(s.d1, end) - Math.max(s.d0, odo);
    if (l <= 0) continue;
    acc += s.slopeDeg * l; len += l;
    if (s.slopeDeg > max) max = s.slopeDeg;
  }
  return { meanDeg: len > 0 ? acc / len : 0, maxDeg: max, lengthM: len };
}

/** Next dwell/turn marker after tS, with the path distance to it. */
export function nextStop(tl: Timeline, tS: number): { marker: TimelineMarker; distM: number; etaS: number } | null {
  const cur = sampleAtTime(tl, tS);
  if (!cur) return null;
  const m = tl.markers.find((k) => k.tS > tS + 1e-9 && k.kind !== 'start' && k.kind !== 'rover-dropoff' && k.kind !== 'return');
  if (!m) return null;
  const at = sampleAtTime(tl, m.tS);
  return { marker: m, distM: Math.max(0, (at?.odometerM ?? cur.odometerM) - cur.odometerM), etaS: m.tS - tS };
}

/** Climb work (kJ) for crew mass over ascent, planner model (informational). */
export function climbWorkKJ(massKg: number, ascentM: number): number { return (massKg * G_MARS * ascentM) / 1000; }
