/**
 * Sun along the route timeline, daylight check and latest-safe-start search (Mars24, see mars24.ts).
 * Sun elevation is geometric (no refraction / disc radius). The EVA minimum elevation is an ASSUMPTION
 * (MIN_SUN_ELEVATION_DEG = 0°, assumptions.ts).
 */
import type { RouteResult } from '../contracts';
import type { DaylightCheck, SafeStartResult, SunSample, Timeline } from '../opsContracts';
import { MIN_SUN_ELEVATION_DEG } from './assumptions';
import { marsState, sunPositionFromState } from './mars24';
import type { SunOptions } from './mars24';
import { buildTimeline } from './timeline';

const MIN_MS = 60_000;
/** One Mars sol in Earth ms (1.0274912517 d). */
export const SOL_MS = 1.0274912517 * 86_400_000;

const asTimeline = (r: RouteResult | Timeline): Timeline => ('samples' in r ? r : buildTimeline(r));

/** Sun elevation/azimuth at every timeline sample for an EVA starting at `startUtc`. */
export function sunAlongRoute(route: RouteResult | Timeline, startUtc: Date | number, opts: SunOptions = {}): SunSample[] {
  const tl = asTimeline(route);
  const t0 = typeof startUtc === 'number' ? startUtc : startUtc.getTime();
  return tl.samples.map((s) => {
    const utcMs = t0 + s.tMin * MIN_MS;
    const p = sunPositionFromState(marsState(utcMs), s.lat, s.lon, opts);
    return { idx: s.idx, tMin: s.tMin, utcMs, elevationDeg: p.elevationDeg, azimuthDeg: p.azimuthDeg };
  });
}

/**
 * EVA daylight check: the sun must stay at or above `minElevationDeg` at every sample from start to the end of
 * the last dwell. A sample is added at the end of each dwell, so dwell periods are covered.
 */
export function daylightCheck(
  route: RouteResult | Timeline, startUtc: Date | number,
  minElevationDeg: number = MIN_SUN_ELEVATION_DEG, opts: SunOptions = {},
): DaylightCheck {
  const tl = asTimeline(route);
  const t0 = typeof startUtc === 'number' ? startUtc : startUtc.getTime();
  const pts = checkPoints(tl, 2).map((p) => ({
    tMin: p.tMin, el: sunPositionFromState(marsState(t0 + p.tMin * MIN_MS), p.lat, p.lon, opts).elevationDeg,
  }));
  let min = Infinity, minAt = 0, firstViolation: number | null = null;
  for (const p of pts) {
    if (p.el < min) { min = p.el; minAt = p.tMin; }
    if (firstViolation === null && p.el < minElevationDeg) firstViolation = p.tMin;
  }
  return {
    ok: firstViolation === null, thresholdDeg: minElevationDeg,
    minElevationDeg: pts.length ? min : NaN, minElevationAtMin: minAt,
    startElevationDeg: pts[0]?.el ?? NaN, endElevationDeg: pts[pts.length - 1]?.el ?? NaN,
    firstViolationMin: firstViolation,
  };
}

/**
 * Check instants for daylight tests: every vertex at least `spacingMin` after the previous kept one, both sides of each
 * dwell, the end of the final dwell, and fill-in points every `spacingMin` while standing still in a dwell (so a long
 * dwell cannot hide a sunset).
 */
function checkPoints(tl: Timeline, spacingMin: number) {
  const pts: { tMin: number; lat: number; lon: number }[] = [];
  const s = tl.samples;
  let lastT = -Infinity;
  const push = (tMin: number, lat: number, lon: number) => { pts.push({ tMin, lat, lon }); lastT = tMin; };
  for (let i = 0; i < s.length; i++) {
    const prevDwell = i > 0 && s[i - 1].dwellAfterMin > 0 && s[i - 1].leg !== s[i].leg;
    if (i === 0 || i === s.length - 1 || s[i].dwellAfterMin > 0 || prevDwell || s[i].tMin - lastT >= spacingMin) push(s[i].tMin, s[i].lat, s[i].lon);
    if (s[i].dwellAfterMin > 0) {
      const end = s[i].tMin + s[i].dwellAfterMin;
      for (let t = s[i].tMin + spacingMin; t < end; t += spacingMin) pts.push({ tMin: t, lat: s[i].lat, lon: s[i].lon });
      lastT = end;
    }
  }
  const last = s[s.length - 1];
  if (last && last.dwellAfterMin > 0) {
    const end = last.tMin + last.dwellAfterMin;
    pts.push({ tMin: end, lat: last.lat, lon: last.lon });
  }
  return pts.sort((a, b) => a.tMin - b.tMin);
}

export interface SafeStartOptions {
  /** Search window [fromUtc, fromUtc + windowMs]; default one sol. */
  windowMs?: number;
  minElevationDeg?: number;
  /** Scan step in minutes (default 2); the boundary is then refined by bisection to ~1 s. */
  stepMin?: number;
  sun?: SunOptions;
}

/**
 * Latest start time (and earliest; clamped to the window start) of the first contiguous run of safe starts at which the entire EVA — including every dwell —
 * stays above the minimum sun elevation. Returns null if no start in the window keeps the whole EVA in daylight.
 */
export function latestSafeStart(
  route: RouteResult | Timeline, fromUtc: Date | number, o: SafeStartOptions = {},
): SafeStartResult | null {
  const tl = asTimeline(route);
  const from = typeof fromUtc === 'number' ? fromUtc : fromUtc.getTime();
  const windowMs = o.windowMs ?? SOL_MS;
  const minEl = o.minElevationDeg ?? MIN_SUN_ELEVATION_DEG;
  const stepMs = (o.stepMin ?? 2) * MIN_MS;
  const pts = checkPoints(tl, 5);
  const ok = (start: number): boolean => {
    for (const p of pts) {
      if (sunPositionFromState(marsState(start + p.tMin * MIN_MS), p.lat, p.lon, o.sun).elevationDeg < minEl) return false;
    }
    return true;
  };
  const refine = (good: number, bad: number): number => {
    let g = good, b = bad;
    while (Math.abs(b - g) > 1000) { const m = (g + b) / 2; if (ok(m)) g = m; else b = m; }
    return g;
  };
  // First contiguous run of safe starts in the window (a second run one sol later is not "the latest" of this day).
  let earliest: number | null = null, latest: number | null = null;
  let prev: { t: number; ok: boolean } | null = null;
  for (let t = from; t <= from + windowMs + 1; t += stepMs) {
    const r = ok(t);
    if (r) {
      if (earliest === null) earliest = prev && !prev.ok ? refine(t, prev.t) : t;
      latest = t;
    } else if (prev?.ok) {
      latest = refine(prev.t, t);
      break;
    }
    prev = { t, ok: r };
  }
  if (earliest === null || latest === null) return null;
  return {
    earliestStartUtcMs: earliest, latestStartUtcMs: latest, latestEndUtcMs: latest + tl.totalMin * MIN_MS,
    thresholdDeg: minEl, evaMin: tl.totalMin,
  };
}
