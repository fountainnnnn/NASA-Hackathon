/**
 * Route timeline: per-vertex elapsed time, cumulative distance and battery for a RouteResult.
 * Re-uses the planner's own speed model (Tobler × suitSpeedFactor, per-segment) and bookkeeping
 * (dwell at every stop/target, battery = elapsed·suitPowerW/batteryWh) so the totals reproduce
 * route.totals.evaMin / batteryUsedPct exactly (tested).
 */
import type { LonLat, RouteResult } from '../contracts';
import type { Timeline, TimelineSample } from '../opsContracts';
import { groundDistanceM } from '../geo/frame';
import { toblerKmh } from '../terrain/astar';

export function buildTimeline(route: RouteResult): Timeline {
  const k = route.constraintsUsed;
  const pctPerMin = (k.suitPowerW / 60) / k.batteryWh * 100;
  const outboundLegs = route.legs.length - (route.roundTrip && route.legs.length > 0 ? 1 : 0);
  const samples: TimelineSample[] = [];
  let t = 0, dist = 0;
  for (let li = 0; li < route.legs.length; li++) {
    const leg = route.legs[li];
    const isOutbound = li < outboundLegs;
    const lastLeg = li === route.legs.length - 1;
    for (let v = 0; v < leg.path.length; v++) {
      if (v > 0) {
        const a = leg.path[v - 1], b = leg.path[v];
        const horiz = groundDistanceM(a, b), dh = b.h - a.h;
        const len3 = Math.hypot(horiz, dh);
        dist += len3;
        t += len3 / (toblerKmh(dh / horiz, k.suitSpeedFactor) * 1000 / 60);
      }
      const last = v === leg.path.length - 1;
      let kind: TimelineSample['kind'] = 'path';
      if (li === 0 && v === 0) kind = 'start';
      else if (last && isOutbound) kind = li === outboundLegs - 1 ? 'target' : 'stop';
      else if (last && lastLeg) kind = 'end';
      const p = leg.path[v];
      samples.push({
        idx: samples.length, leg: li, vertex: v, lon: p.lon, lat: p.lat, h: p.h, distM: dist, tMin: t,
        batteryPct: 100 - t * pctPerMin, dwellAfterMin: last && isOutbound ? k.dwellMin : 0, kind,
      });
      if (last && isOutbound) t += k.dwellMin; // next leg's first vertex departs after the dwell
    }
  }
  const tail = samples[samples.length - 1];
  return {
    routeId: route.id, samples, outboundLegs,
    totalMin: tail ? tail.tMin + tail.dwellAfterMin : 0,
    totalDistM: dist, pctPerMin,
  };
}

/** Position at elapsed minute t (clamped; linear interpolation inside a segment, holds position during dwell). */
export function positionAt(tl: Timeline, tMin: number): LonLat & { h: number } {
  const s = tl.samples;
  if (s.length === 0) throw new Error('empty timeline');
  if (tMin <= s[0].tMin) return { lon: s[0].lon, lat: s[0].lat, h: s[0].h };
  let lo = 0, hi = s.length - 1;
  if (tMin >= s[hi].tMin) return { lon: s[hi].lon, lat: s[hi].lat, h: s[hi].h };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s[mid].tMin <= tMin) lo = mid; else hi = mid; }
  const a = s[lo], b = s[hi];
  const span = b.tMin - a.tMin;
  if (span <= 1e-12 || a.leg !== b.leg) return { lon: a.lon, lat: a.lat, h: a.h }; // dwell between legs
  const f = (tMin - a.tMin) / span;
  return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, h: a.h + (b.h - a.h) * f };
}
