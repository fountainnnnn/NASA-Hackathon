/**
 * Monte-Carlo playback (pure, unit-tested in tests/scenario/mcPlayback.test.ts). After the hero lander touches down and the
 * camera pulls back over the ellipse, the SAME seeded touchdowns the scenario computed land one after another, sped up and
 * accelerating, while a counter tallies them. No new random numbers: the kept points are the evenly spaced subset of the
 * draws (engine.ts, MAX_RENDER_POINTS), each standing for N / kept draws, and the counter's tallies are exact where the
 * engine recorded running counts (TS engine) and an unbiased estimate from the kept points otherwise (WASM engine). At the
 * last run every number is the computed result itself.
 *
 * Times are SIMULATED seconds after touchdown on the shared playback clock, so 1×, 10×, 60× and 600× and Replay apply. They
 * are ASSUMPTIONS for the animation only (the EDL timeline ends at touchdown): at the default 60× the testing phase lasts 7 s.
 */
import type { RunningCounts } from './types';

/** Camera holds on the rover after touchdown before pulling back (s). */
export const TOUCHDOWN_HOLD_S = 45;
/** Pull-back from the rover to the whole ellipse (s). */
export const PULLBACK_S = 90;
/** The testing phase starts this long after touchdown, as the pull-back settles (s). */
export const MC_START_S = TOUCHDOWN_HOLD_S + 70;
/** Length of the "Testing 10,000 landings" phase (s). 7 s of wall clock at 60×. */
export const MC_TEST_S = 420;
/** End state after the last run: dots settle, the rover is labelled (s). */
export const MC_SETTLE_S = 60;
export const MC_END_S = MC_START_S + MC_TEST_S;
/** Everything after touchdown: hold, pull-back, testing, settle (s). */
export const POST_TOUCHDOWN_S = MC_END_S + MC_SETTLE_S;
/** Runs land at an accelerating rate: runs(u) = N × u^MC_EASE_POW for testing progress u in 0..1. */
export const MC_EASE_POW = 2.5;
/** Each touchdown falls from this height above the ground (m), drawn as a short streak. */
export const MC_FALL_H_M = 300;
/** Fall time (s, simulated): 0.35 s of wall clock at 60×. */
export const MC_FALL_S = 21;
/** Dust puff lifetime after a touchdown lands (s, simulated). */
export const MC_PUFF_S = 18;

export interface McInput {
  points: Float32Array;
  samples: number;
  maxSlopeDeg: number;
  okFraction?: number;
  nodataFraction?: number;
  slopeP95?: number;
  running?: RunningCounts;
}

export interface McStats {
  /** Draws tallied so far. */
  runs: number;
  samples: number;
  okFraction: number;
  nodataFraction: number;
  /** 95th percentile slope of the touchdowns so far (deg), null without valid slopes. */
  p95: number | null;
  /** True once every run has landed: the numbers are the computed result's. */
  final: boolean;
  /** True when okFraction and nodataFraction are exact running tallies (else estimated from the kept points). */
  exact: boolean;
}

export interface McSchedule {
  samples: number;
  kept: number;
  /** Draws landed at testing progress u (0..1). */
  runsAt(u: number): number;
  /** Testing progress (0..1) at which `runs` draws have landed (inverse of runsAt). */
  progressAt(runs: number): number;
  /** Draw index (1-based run count) that kept point k stands for. */
  runOfKept(k: number): number;
  /** Kept points landed once `runs` draws have landed. */
  keptAt(runs: number): number;
  statsAt(runs: number): McStats;
}

/** Testing progress 0..1 at simulated time t (s after touchdown). */
export const mcProgress = (tAfterTouchdown: number) => Math.min(1, Math.max(0, (tAfterTouchdown - MC_START_S) / MC_TEST_S));

function percentileSorted(a: number[], q: number): number | null {
  if (!a.length) return null;
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

export function monteCarloSchedule(inp: McInput): McSchedule {
  const N = Math.max(1, Math.floor(inp.samples));
  const kept = Math.floor(inp.points.length / 3);
  const run = inp.running && inp.running.runs.length === kept ? inp.running : null;
  // kept point k is the last draw of its slot: run index ceil((k + 1) N / kept) (engine.ts keeps an evenly spaced subset)
  const runOfKept = (k: number) => (run ? run.runs[k] : Math.ceil(((k + 1) * N) / kept - 1e-9));
  const keptAt = (runs: number) => {
    if (runs <= 0 || kept === 0) return 0;
    if (runs >= N) return kept;
    let lo = 0, hi = kept; // first k whose run index is beyond `runs`
    while (lo < hi) { const mid = (lo + hi) >> 1; if (runOfKept(mid) <= runs) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const runsAt = (u: number) => (u <= 0 ? 0 : u >= 1 ? N : Math.min(N, Math.round(N * Math.pow(u, MC_EASE_POW))));
  const progressAt = (runs: number) => (runs <= 0 ? 0 : runs >= N ? 1 : Math.pow(runs / N, 1 / MC_EASE_POW));
  // kept slopes in draw order, for the running p95 (sorted prefix, cached by length)
  const slopes = Array.from({ length: kept }, (_, k) => inp.points[k * 3 + 2]);
  let cacheM = -1, cacheP: number | null = null;
  const p95Kept = (m: number) => {
    if (m === cacheM) return cacheP;
    const v = slopes.slice(0, m).filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
    cacheM = m; cacheP = percentileSorted(v, 0.95);
    return cacheP;
  };
  const statsAt = (runs: number): McStats => {
    const r = Math.max(0, Math.min(N, Math.round(runs)));
    if (r >= N) {
      const m = kept;
      const est = { ok: 0, nd: 0 };
      for (let k = 0; k < m; k++) { const s = slopes[k]; if (!Number.isFinite(s)) est.nd++; else if (s <= inp.maxSlopeDeg) est.ok++; }
      return {
        runs: N, samples: N, final: true, exact: inp.okFraction != null,
        okFraction: inp.okFraction ?? (m ? est.ok / m : 0),
        nodataFraction: inp.nodataFraction ?? (m ? est.nd / m : 0),
        p95: inp.slopeP95 != null && Number.isFinite(inp.slopeP95) ? inp.slopeP95 : p95Kept(m),
      };
    }
    const m = keptAt(r);
    if (run) {
      if (m === 0) return { runs: 0, samples: N, okFraction: 0, nodataFraction: 0, p95: null, final: false, exact: true };
      const n = run.runs[m - 1];
      return { runs: n, samples: N, okFraction: run.ok[m - 1] / n, nodataFraction: run.nodata[m - 1] / n, p95: p95Kept(m), final: false, exact: true };
    }
    let ok = 0, nd = 0;
    for (let k = 0; k < m; k++) { const s = slopes[k]; if (!Number.isFinite(s)) nd++; else if (s <= inp.maxSlopeDeg) ok++; }
    return { runs: r, samples: N, okFraction: m ? ok / m : 0, nodataFraction: m ? nd / m : 0, p95: p95Kept(m), final: false, exact: false };
  };
  return { samples: N, kept, runsAt, progressAt, runOfKept, keptAt, statsAt };
}

/** Counter line for the stage overlay, e.g. "Run 3,412 of 10,000   99.2 % within 15°   p95 slope 6.3°". */
export function mcCounterParts(s: McStats, maxSlopeDeg: number): { run: string; ok: string; p95: string } {
  const nf = (x: number) => x.toLocaleString('en-US');
  return {
    run: `Run ${nf(s.runs)} of ${nf(s.samples)}`,
    ok: `${(Math.round(s.okFraction * 1000) / 10).toFixed(1)} % within ${maxSlopeDeg}°`,
    p95: s.p95 == null ? 'p95 slope n/a' : `p95 slope ${s.p95.toFixed(1)}°`,
  };
}
