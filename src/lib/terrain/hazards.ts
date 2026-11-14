import type { HazardSegment, RouteResult } from '@/lib/contracts';
import { groundDistanceM } from '../geo/frame';
import { toblerKmh } from './astar';

export type Hazard = Omit<HazardSegment, 'routeId'>;
const MIN_LEN_M = 80;

interface Run { leg: number; s: number; e: number } // segment indices [s, e] inclusive

function runs(flags: boolean[][], ): Run[] {
  const out: Run[] = [];
  flags.forEach((f, leg) => {
    let s = -1;
    for (let i = 0; i <= f.length; i++) {
      if (i < f.length && f[i]) { if (s < 0) s = i; }
      else if (s >= 0) { out.push({ leg, s, e: i - 1 }); s = -1; }
    }
  });
  return out;
}

/**
 * Top-k contiguous stretches (>= 80 m, adjacent segments with slope >= 0.8·limit merged), ranked
 * by max slope then length, kind 'steep'. If no steep stretch exists, returns the slowest
 * stretches (segments slower than 70 % of peak Tobler speed) as kind 'slow'.
 */
export function findHazards(route: RouteResult, k: number, limitDeg: number): Hazard[] {
  const build = (r: Run, kind: Hazard['kind']): Hazard => {
    const leg = route.legs[r.leg];
    let lengthM = 0, slopeLen = 0, maxSlopeDeg = 0;
    for (let i = r.s; i <= r.e; i++) {
      const a = leg.path[i], b = leg.path[i + 1];
      const len = Math.hypot(groundDistanceM(a, b), b.h - a.h);
      lengthM += len; slopeLen += len * leg.segSlopeDeg[i];
      if (leg.segSlopeDeg[i] > maxSlopeDeg) maxSlopeDeg = leg.segSlopeDeg[i];
    }
    const s = leg.path[r.s], e = leg.path[r.e + 1];
    return {
      leg: r.leg, startIdx: r.s, endIdx: r.e + 1, lengthM, meanSlopeDeg: lengthM > 0 ? slopeLen / lengthM : 0,
      maxSlopeDeg, start: { lon: s.lon, lat: s.lat }, end: { lon: e.lon, lat: e.lat }, kind,
    };
  };
  const longEnough = (h: Hazard) => h.lengthM >= MIN_LEN_M;

  const thr = 0.8 * limitDeg;
  const steep = runs(route.legs.map((l) => l.segSlopeDeg.map((s) => s >= thr)))
    .map((r) => build(r, 'steep')).filter(longEnough)
    .sort((a, b) => b.maxSlopeDeg - a.maxSlopeDeg || b.lengthM - a.lengthM);
  if (steep.length) return steep.slice(0, k);

  const f = route.constraintsUsed.suitSpeedFactor;
  const slowFlags = route.legs.map((l) => l.segSlopeDeg.map((_, i) => {
    const a = l.path[i], b = l.path[i + 1];
    const horiz = groundDistanceM(a, b);
    return toblerKmh((b.h - a.h) / horiz, f) < 0.7 * f * 6;
  }));
  // rank slow stretches by mean speed ascending, approximated by mean slope descending
  return runs(slowFlags).map((r) => build(r, 'slow')).filter(longEnough)
    .sort((a, b) => b.meanSlopeDeg - a.meanSlopeDeg || b.lengthM - a.lengthM).slice(0, k);
}
