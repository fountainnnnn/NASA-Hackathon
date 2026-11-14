/**
 * EVA reach computation (pure, async). Samples bearings around a base, asks the planner for ONE round trip per
 * bearing (to the maximum radius), and reads the farthest point the crew can still return from out of the route the
 * planner returned. One plan per bearing keeps the whole thing at ~24 plans (a few seconds).
 *
 * Frontier point on a returned route: walk the outbound legs vertex by vertex. At vertex v the crew has spent
 * t_out(v) walking out plus one dwell, and would spend t_back(v) walking home along the same path with the planner's
 * reversed-grade Tobler times. The point is reachable if the total fits the battery limit
 * (100 - reserve) and the EVA time limit. This is an approximation of the planner's separately solved return leg.
 * Feasible routes reach the full radius by definition (the planner already checked battery, EVA and slope).
 */
import { R_MARS } from '../../lib/contracts';
import type { LonLat, MissionConstraints, RouteResult } from '../../lib/contracts';
import { groundDistanceM } from '../../lib/geo/frame';
import { toblerKmh } from '../../lib/terrain/astar';
import { legSegments, pctPerSecond } from './model';

const DEG = Math.PI / 180;

export type PlanRoundTrip = (from: LonLat, to: LonLat) => Promise<RouteResult>;

export interface ReachSample {
  bearingDeg: number;
  /** Straight-line ground distance from base to the frontier point, metres (0 = nothing reachable). */
  radiusM: number;
  /** Frontier point (null when radius is 0). */
  point: LonLat | null;
  status: 'full' | 'limited' | 'blocked';
  /** Why it stops short (planner reasons) for limited and blocked bearings. */
  reasons: string[];
  /** Minutes of reserve at turn-back at the frontier point (contours are labelled in these minutes). */
  reserveMinAtFrontier: number | null;
  /** Reserve minutes versus distance along this bearing's route (thinned), for the contour lines. */
  profile: { radiusM: number; reserveMin: number }[];
}

export interface ReachResult {
  center: LonLat;
  maxRadiusM: number;
  samples: ReachSample[];
  plans: number;
  cancelled: boolean;
  ms: number;
}

/** Destination from a point along a bearing on the Mars sphere (small-distance exact great circle). */
export function offsetLonLat(from: LonLat, bearingDeg: number, distM: number): LonLat {
  const d = distM / R_MARS, br = bearingDeg * DEG, la1 = from.lat * DEG, lo1 = from.lon * DEG;
  const sinLa2 = Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br);
  const la2 = Math.asin(Math.max(-1, Math.min(1, sinLa2)));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * sinLa2);
  return { lon: lo2 / DEG, lat: la2 / DEG };
}

export interface ReservePoint { point: LonLat; radiusM: number; reserveMin: number }

/**
 * Minutes of reserve left if the crew turned back at each outbound vertex (min of battery margin and EVA-time
 * margin; negative = cannot get home). Outbound time is the planner's own leg time plus dwell, the walk home reuses
 * the same path with reversed-grade Tobler times.
 */
export function reserveProfile(route: RouteResult, centre: LonLat, c: MissionConstraints = route.constraintsUsed): ReservePoint[] {
  const limitPct = 100 - c.batteryReservePct;
  const perS = pctPerSecond(c);
  const returnLegs = route.roundTrip && route.legs.length > 1 ? 1 : 0;
  const outboundCount = route.legs.length - returnLegs;
  if (outboundCount < 1) return [];
  const dwellS = c.dwellMin * 60;
  const flat: (LonLat & { h: number })[] = [];
  const tOut: number[] = [];
  let t = 0;
  for (let li = 0; li < outboundCount; li++) {
    const leg = route.legs[li];
    const fwd = legSegments(leg, c.suitSpeedFactor, false);
    for (let i = 0; i < leg.path.length; i++) {
      if (i > 0) t += fwd[i - 1].min * 60;
      flat.push(leg.path[i]); tOut.push(t);
    }
    t += dwellS;
  }
  const back: number[] = [0];
  for (let i = 1; i < flat.length; i++) {
    const a = flat[i - 1], b = flat[i];
    const horiz = Math.max(1e-6, groundDistanceM(a, b));
    const dh = a.h - b.h;
    back.push(back[i - 1] + (Math.hypot(horiz, dh) / ((toblerKmh(dh / horiz, c.suitSpeedFactor) * 1000) / 60)) * 60);
  }
  return flat.map((p, i) => {
    const total = tOut[i] + dwellS + back[i];
    const batMin = (limitPct - total * perS) / perS / 60;
    const evaMin = c.evaMaxMin - total / 60;
    return { point: p, radiusM: groundDistanceM(centre, p), reserveMin: Math.min(batMin, evaMin) };
  });
}

/** Farthest outbound vertex from which the crew can still get home (reserve >= 0), walking out in order. */
export function frontierOnRoute(route: RouteResult, centre: LonLat = route.from, c: MissionConstraints = route.constraintsUsed): { point: LonLat; reserveMin: number } | null {
  const prof = reserveProfile(route, centre, c);
  let best: ReservePoint | null = null;
  for (const p of prof) { if (p.reserveMin >= 0) best = p; else break; }
  return best ? { point: best.point, reserveMin: best.reserveMin } : null;
}

/** Contour radius (m) at which the turn-back reserve equals levelMin, from a sample's profile (clamped to maxRadiusM). */
export function contourRadius(s: ReachSample, levelMin: number, maxRadiusM: number): number {
  if (s.status === 'blocked') return 0;
  let r = 0;
  for (const p of s.profile) { if (p.reserveMin >= levelMin) r = p.radiusM; else break; }
  return Math.min(r, maxRadiusM);
}

export interface ReachOptions {
  center: LonLat;
  planRoundTrip: PlanRoundTrip;
  /** Number of bearings. Default 24. The first pass issues exactly one plan per bearing. */
  bearings?: number;
  /** Farthest radius tried, metres. */
  maxRadiusM: number;
  /**
   * Hard cap on planner calls. Default 48 = one pass of 24 plus up to 24 retries. Bearings with no path to the maximum
   * radius (slope or map edge) are retried at half and then a quarter of the radius while budget remains, so a steep
   * patch far out does not erase the flat ground in front of it. Pass bearings (24) to disable retries.
   */
  maxPlans?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, partial: ReachSample[]) => void;
  /** Plans run in small batches so the UI stays responsive; the planner usually runs in a worker anyway. Default 4. */
  concurrency?: number;
}

const RETRY_FACTORS = [0.5, 0.25];

export async function computeReach(o: ReachOptions): Promise<ReachResult> {
  const n = Math.max(3, Math.min(48, Math.round(o.bearings ?? 24)));
  const conc = Math.max(1, o.concurrency ?? 4);
  const maxPlans = Math.max(n, o.maxPlans ?? 48);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const samples: (ReachSample | null)[] = new Array(n).fill(null);
  let done = 0, plans = 0;
  const bearingOf = (i: number) => (i * 360) / n;
  const blocked = (b: number, reasons: string[]): ReachSample => ({ bearingDeg: b, radiusM: 0, point: null, status: 'blocked', reasons, reserveMinAtFrontier: null, profile: [] });

  const planAt = async (b: number, radiusM: number): Promise<ReachSample> => {
    const to = offsetLonLat(o.center, b, radiusM);
    try {
      plans++;
      const r = await o.planRoundTrip(o.center, to);
      const prof = r.legs.length ? reserveProfile(r, o.center) : [];
      const thin = thinProfile(prof.map((p) => ({ radiusM: p.radiusM, reserveMin: p.reserveMin })), 48);
      if (r.feasible) {
        return { bearingDeg: b, radiusM, point: to, status: 'full', reasons: [], reserveMinAtFrontier: prof.length ? prof[prof.length - 1].reserveMin : null, profile: thin };
      }
      const fr = r.legs.length ? frontierOnRoute(r, o.center) : null;
      if (fr) {
        return { bearingDeg: b, radiusM: Math.min(groundDistanceM(o.center, fr.point), radiusM), point: fr.point, status: 'limited', reasons: r.reasons, reserveMinAtFrontier: fr.reserveMin, profile: thin };
      }
      return blocked(b, r.reasons);
    } catch {
      return blocked(b, ['planner_error']);
    }
  };

  /** Run `idx` through `fn` with a small worker pool, stopping early on abort or when the plan budget is spent. */
  const pool = async (idx: number[], fn: (i: number) => Promise<void>) => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(conc, idx.length) }, async () => {
      for (;;) {
        if (o.signal?.aborted || plans >= maxPlans) return;
        const k = next++;
        if (k >= idx.length) return;
        await fn(idx[k]);
      }
    }));
  };

  await pool(Array.from({ length: n }, (_, i) => i), async (i) => {
    samples[i] = await planAt(bearingOf(i), o.maxRadiusM);
    done++;
    o.onProgress?.(done, n, samples.filter((x): x is ReachSample => !!x));
  });

  for (const f of RETRY_FACTORS) {
    if (o.signal?.aborted || plans >= maxPlans) break;
    const failed = samples.flatMap((s, i) => (s && s.status === 'blocked' && s.reasons.some((r) => r === 'no_path_slope' || r === 'out_of_bounds') ? [i] : []));
    if (!failed.length) break;
    await pool(failed, async (i) => {
      const prev = samples[i]!;
      const s = await planAt(bearingOf(i), o.maxRadiusM * f);
      if (s.status !== 'blocked') samples[i] = { ...s, status: 'limited', reasons: prev.reasons };
      else samples[i] = { ...prev, reasons: s.reasons.length ? s.reasons : prev.reasons };
      o.onProgress?.(done, n, samples.filter((x): x is ReachSample => !!x));
    });
  }

  const got = samples.filter((x): x is ReachSample => !!x);
  return { center: o.center, maxRadiusM: o.maxRadiusM, samples: got, plans, cancelled: !!o.signal?.aborted && got.length < n, ms: now() - t0 };
}

function thinProfile<T>(a: T[], max: number): T[] {
  if (a.length <= max) return a;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(a[Math.round((i * (a.length - 1)) / (max - 1))]);
  return out;
}

/** Polygon vertices (local metres relative to centre: x east, z south) of the frontier, ordered by bearing. */
export function frontierPolygonLocal(samples: ReachSample[]): { x: number; z: number; bearingDeg: number }[] {
  return [...samples].sort((a, b) => a.bearingDeg - b.bearingDeg).map((s) => ({
    bearingDeg: s.bearingDeg,
    x: Math.sin(s.bearingDeg * DEG) * s.radiusM,
    z: -Math.cos(s.bearingDeg * DEG) * s.radiusM,
  }));
}

/** Radius at an arbitrary bearing, linearly interpolated between samples (wraps). */
export function radiusAtBearing(samples: ReachSample[], bearingDeg: number): number {
  if (!samples.length) return 0;
  const s = [...samples].sort((a, b) => a.bearingDeg - b.bearingDeg);
  const b = ((bearingDeg % 360) + 360) % 360;
  let i = s.findIndex((q) => q.bearingDeg > b);
  if (i === -1) i = 0;
  const hi = s[i], lo = s[(i - 1 + s.length) % s.length];
  const span = ((hi.bearingDeg - lo.bearingDeg + 360) % 360) || 360;
  const f = ((b - lo.bearingDeg + 360) % 360) / span;
  return lo.radiusM + (hi.radiusM - lo.radiusM) * f;
}

/** Area enclosed by the frontier in km2 (polar integration of the interpolated radius). */
export function reachAreaKm2(samples: ReachSample[]): number {
  const s = [...samples].sort((a, b) => a.bearingDeg - b.bearingDeg);
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    const p = s[i], q = s[(i + 1) % s.length];
    const dth = (((q.bearingDeg - p.bearingDeg + 360) % 360) || 360) * DEG;
    a += 0.5 * p.radiusM * q.radiusM * Math.sin(dth);
  }
  return a / 1e6;
}

/** Radii (m) of one reserve contour at each sample bearing, in sample order sorted by bearing. */
export function contourRadii(samples: ReachSample[], levelMin: number, maxRadiusM: number): { bearingDeg: number; radiusM: number }[] {
  return [...samples].sort((a, b) => a.bearingDeg - b.bearingDeg).map((s) => ({ bearingDeg: s.bearingDeg, radiusM: contourRadius(s, levelMin, maxRadiusM) }));
}

/** Smooth closed contour as `steps` local offsets (x east, z south, metres from the base), radius interpolated by bearing. */
export function contourPolygon(samples: ReachSample[], levelMin: number, maxRadiusM: number, steps = 120): { x: number; z: number; radiusM: number; bearingDeg: number }[] {
  const rs = contourRadii(samples, levelMin, maxRadiusM);
  if (!rs.length) return [];
  const out: { x: number; z: number; radiusM: number; bearingDeg: number }[] = [];
  for (let i = 0; i < steps; i++) {
    const b = (i * 360) / steps;
    let k = rs.findIndex((q) => q.bearingDeg > b);
    if (k === -1) k = 0;
    const hi = rs[k], lo = rs[(k - 1 + rs.length) % rs.length];
    const span = ((hi.bearingDeg - lo.bearingDeg + 360) % 360) || 360;
    const f = ((b - lo.bearingDeg + 360) % 360) / span;
    const r = lo.radiusM + (hi.radiusM - lo.radiusM) * f;
    out.push({ x: Math.sin(b * DEG) * r, z: -Math.cos(b * DEG) * r, radiusM: r, bearingDeg: b });
  }
  return out;
}

/**
 * Contour levels (minutes of reserve at turn-back) chosen from the data: 0 plus a few multiples of a round step,
 * at most four lines above the frontier.
 */
export function contourLevels(samples: ReachSample[]): number[] {
  const maxR = Math.max(0, ...samples.map((s) => (s.profile.length ? s.profile[0].reserveMin : 0)));
  const step = [10, 15, 30, 60, 120, 240].find((st) => maxR / st <= 4) ?? 240;
  const out = [0];
  for (let m = step; m < maxR - step * 0.2; m += step) out.push(m);
  return out;
}
