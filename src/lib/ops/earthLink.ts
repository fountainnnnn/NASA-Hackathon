/**
 * Earth link: one-way light time to Earth and Earth visibility (direct-to-Earth line of sight) at Jezero.
 * All numbers come from NASA JPL Horizons (public/data/earth_link.json, built by scripts/fetch-horizons.mjs).
 *
 * - Light time: Earth centre <-> Mars centre, 1-day grid 2026-01-01..2040-12-31, linear interpolation.
 * - Earth in the sky: Horizons topocentric azimuth/elevation (airless, Earth centre) at Jezero, 1 h grid
 *   2026-11-01..2027-01-31 and 10 min grid 2026-11-14..2026-11-21 (finest grid wins where they overlap).
 *
 * "Above the horizon" is the geometric horizon of a flat local plane (elevation > minElevDeg, default 0). Terrain masking
 * (crater rim, hills) is NOT modelled here; pass a larger `minElevDeg` or combine with the viewshed module.
 * Functions are pure over the loaded dataset: call `loadEarthLink(fetch)` once (or `setEarthLink`), or pass `data`.
 * Outside the data coverage, sky functions return null rather than guessing.
 */

export interface EarthLinkSeries {
  start: string; // ISO UTC of sample 0
  stepMin: number;
  count: number;
  azDeg: number[];
  elDeg: number[];
}

export interface EarthLinkData {
  source: { title: string; url: string; query: unknown; retrieved: string };
  lightTime: { start: string; stepDays: number; count: number; rangeAu: number[]; oneWayMin: number[] };
  earthSky: {
    site: { name: string; latDeg: number; lonEastDeg: number; altKm: number };
    series: EarthLinkSeries[];
  };
}

export type TimeInput = Date | number;
const ms = (t: TimeInput): number => (typeof t === 'number' ? t : t.getTime());
const MIN_MS = 60_000;
const DAY_MS = 86_400_000;

let loaded: EarthLinkData | null = null;

/** Fetch and cache public/data/earth_link.json. Pass `fetch` (or a stub) explicitly. */
export async function loadEarthLink(fetchFn: typeof fetch, url = '/data/earth_link.json'): Promise<EarthLinkData> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`earth_link.json: HTTP ${res.status}`);
  loaded = (await res.json()) as EarthLinkData;
  return loaded;
}

/** Install a dataset directly (tests, server code that reads the file itself). */
export function setEarthLink(data: EarthLinkData | null): void {
  loaded = data;
}

function need(data?: EarthLinkData): EarthLinkData {
  const d = data ?? loaded;
  if (!d) throw new Error('earth link data not loaded: call loadEarthLink(fetch) first');
  return d;
}

/* ------------------------------------------------------------------ light time */

function ltInterp(values: number[], data: EarthLinkData, t: TimeInput): number | null {
  const lt = data.lightTime;
  const x = (ms(t) - Date.parse(lt.start)) / (lt.stepDays * DAY_MS);
  if (!(x >= 0) || x > lt.count - 1) return null;
  const i = Math.min(Math.floor(x), lt.count - 2);
  const f = x - i;
  return values[i] + (values[i + 1] - values[i]) * f;
}

/** One-way Earth<->Mars light time in minutes (linear interpolation); null outside 2026-01-01..2040-12-31. */
export function lightTimeMin(date: TimeInput, data?: EarthLinkData): number | null {
  const d = need(data);
  return ltInterp(d.lightTime.oneWayMin, d, date);
}

/** Earth-Mars range in au (linear interpolation); null outside coverage. */
export function earthRangeAu(date: TimeInput, data?: EarthLinkData): number | null {
  const d = need(data);
  return ltInterp(d.lightTime.rangeAu, d, date);
}

/** Round-trip (question and answer) delay in minutes, ignoring Mission Control turnaround. */
export function roundTripMin(date: TimeInput, data?: EarthLinkData): number | null {
  const t = lightTimeMin(date, data);
  return t === null ? null : 2 * t;
}

/* ------------------------------------------------------------------ Earth in the sky */

const seriesSpan = (s: EarthLinkSeries): [number, number] => {
  const a = Date.parse(s.start);
  return [a, a + (s.count - 1) * s.stepMin * MIN_MS];
};

/** [first, last] UTC ms covered by any Earth-sky series, or null when there is none. */
export function earthSkyCoverage(data?: EarthLinkData): [number, number] | null {
  const spans = need(data).earthSky.series.map(seriesSpan);
  if (!spans.length) return null;
  return [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))];
}

export interface EarthSky {
  azDeg: number;
  elDeg: number;
}

/** Earth azimuth (deg from north, clockwise) and elevation (deg) at Jezero; interpolated on the finest covering grid. */
export function earthSkyAt(date: TimeInput, data?: EarthLinkData): EarthSky | null {
  const t = ms(date);
  let best: EarthLinkSeries | null = null;
  for (const s of need(data).earthSky.series) {
    const [a, b] = seriesSpan(s);
    if (t >= a && t <= b && (!best || s.stepMin < best.stepMin)) best = s;
  }
  if (!best) return null;
  const x = (t - Date.parse(best.start)) / (best.stepMin * MIN_MS);
  const i = Math.min(Math.floor(x), best.count - 2);
  const f = x - i;
  const el = best.elDeg[i] + (best.elDeg[i + 1] - best.elDeg[i]) * f;
  // azimuth along the shortest arc (it wraps at 0/360)
  const a0 = best.azDeg[i];
  let da = best.azDeg[i + 1] - a0;
  if (da > 180) da -= 360;
  else if (da < -180) da += 360;
  return { azDeg: (((a0 + da * f) % 360) + 360) % 360, elDeg: el };
}

/** True when Earth is above `minElevDeg` at Jezero; null outside the data coverage. */
export function earthAboveHorizon(date: TimeInput, minElevDeg = 0, data?: EarthLinkData): boolean | null {
  const s = earthSkyAt(date, data);
  return s === null ? null : s.elDeg > minElevDeg;
}

export interface EarthCrossing {
  ms: number;
  type: 'rise' | 'set';
}

const SCAN_STEP_MS = 5 * MIN_MS;

/** Horizon crossings in (t0, t1], found on a 5-minute scan and bisected to 1 s on the interpolated elevation. */
function crossings(t0: number, t1: number, minEl: number, data?: EarthLinkData): EarthCrossing[] {
  const out: EarthCrossing[] = [];
  const el = (t: number) => earthSkyAt(t, data)!.elDeg - minEl;
  let a = t0;
  let ea = el(a);
  while (a < t1) {
    const b = Math.min(a + SCAN_STEP_MS, t1);
    const eb = el(b);
    if ((ea > 0) !== (eb > 0)) {
      let lo = a, hi = b;
      const upward = eb > 0;
      while (hi - lo > 1000) {
        const mid = (lo + hi) / 2;
        if ((el(mid) > 0) === upward) hi = mid;
        else lo = mid;
      }
      out.push({ ms: Math.round((lo + hi) / 2), type: upward ? 'rise' : 'set' });
    }
    a = b;
    ea = eb;
  }
  return out;
}

export interface NextRiseSet {
  /** Earth above the horizon at `date`. */
  aboveNow: boolean;
  /** Next rise after `date` (UTC ms), or null when none occurs inside the search window / coverage. */
  riseMs: number | null;
  /** Next set after `date` (UTC ms). */
  setMs: number | null;
}

/** Next Earth rise and set at Jezero after `date`; searches up to `maxHours` ahead, limited to data coverage. null outside coverage. */
export function nextEarthRiseSet(date: TimeInput, minElevDeg = 0, maxHours = 72, data?: EarthLinkData): NextRiseSet | null {
  const t = ms(date);
  const cov = earthSkyCoverage(data);
  if (!cov || t < cov[0] || t > cov[1]) return null;
  const end = Math.min(t + maxHours * 60 * MIN_MS, cov[1]);
  const list = crossings(t, end, minElevDeg, data);
  return {
    aboveNow: earthAboveHorizon(t, minElevDeg, data) as boolean,
    riseMs: list.find((c) => c.type === 'rise')?.ms ?? null,
    setMs: list.find((c) => c.type === 'set')?.ms ?? null,
  };
}

export interface EarthWindowSegment {
  startMs: number;
  endMs: number;
  minutes: number;
  /** true = direct-to-Earth line of sight, false = gap (Earth below the horizon). */
  visible: boolean;
}

export interface EarthWindow {
  startMs: number;
  endMs: number;
  durationMin: number;
  /** Minutes of the EVA with Earth above the horizon. */
  visibleMin: number;
  /** Minutes with Earth below the horizon. */
  gapMin: number;
  /** Contiguous visible and gap segments covering the whole EVA, in order. */
  segments: EarthWindowSegment[];
  /** Just the gaps (convenience). */
  gaps: EarthWindowSegment[];
  /** Longest single gap in minutes. */
  longestGapMin: number;
}

/** Earth visibility during an EVA of `durationMin` starting at `startUtc`; null if any part is outside the data coverage. */
export function earthWindowDuringEva(startUtc: TimeInput, durationMin: number, minElevDeg = 0, data?: EarthLinkData): EarthWindow | null {
  const t0 = ms(startUtc);
  const t1 = t0 + durationMin * MIN_MS;
  const cov = earthSkyCoverage(data);
  if (!cov || t0 < cov[0] || t1 > cov[1] || !(durationMin >= 0)) return null;

  const cuts = [t0, ...crossings(t0, t1, minElevDeg, data).map((c) => c.ms), t1];
  const segments: EarthWindowSegment[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b <= a) continue;
    // classify by the midpoint (robust at the edges)
    const visible = earthSkyAt((a + b) / 2, data)!.elDeg > minElevDeg;
    segments.push({ startMs: a, endMs: b, minutes: (b - a) / MIN_MS, visible });
  }
  if (durationMin === 0) {
    const v = earthSkyAt(t0, data)!.elDeg > minElevDeg;
    segments.push({ startMs: t0, endMs: t0, minutes: 0, visible: v });
  }
  const gaps = segments.filter((s) => !s.visible);
  const visibleMin = segments.filter((s) => s.visible).reduce((n, s) => n + s.minutes, 0);
  return {
    startMs: t0, endMs: t1, durationMin, visibleMin, gapMin: durationMin - visibleMin,
    segments, gaps, longestGapMin: gaps.reduce((m, g) => Math.max(m, g.minutes), 0),
  };
}
