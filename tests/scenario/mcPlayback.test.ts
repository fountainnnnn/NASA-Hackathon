import { describe, expect, it } from 'vitest';
import { runScenarioTs } from '../../src/lib/scenario/engine';
import { gridSlopeSource } from '../../src/lib/scenario/sources';
import { MC_END_S, MC_START_S, MC_TEST_S, POST_TOUCHDOWN_S, mcCounterParts, mcProgress, monteCarloSchedule } from '../../src/lib/scenario/playback';
import { LANDING_REVEAL_S } from '../../src/components/Scenario/landing';
import type { LandingScenarioRequest } from '../../src/lib/globeContracts';

// a slope ramp: 0° in the west to 30° in the east, so the share within 15° is about a half
const W = 200, H = 100;
const slope = new Float32Array(W * H).map((_, i) => ((i % W) / W) * 30);
const src = gridSlopeSource({ width: W, height: H, lonMin: 77.2, latMax: 18.6, dLon: 0.4 / W, dLat: 0.2 / H, wrapLon: false, slope, demResM: 20 });
const req: LandingScenarioRequest = { center: { lon: 77.4, lat: 18.5 }, semiMajorKm: 3.85, semiMinorKm: 3.3, azimuthDeg: 75, samples: 10_000, maxSlopeDeg: 15, seed: 2026, dem: 'jezero20m' };

describe('Monte-Carlo playback replays the computed seeded draws', () => {
  const res = runScenarioTs(req, src);
  const sched = monteCarloSchedule({ points: res.points, samples: res.samples, maxSlopeDeg: 15, okFraction: res.okFraction, nodataFraction: res.nodataFraction, slopeP95: res.slopeP95, running: res.running });

  it('the engine records exact running tallies at every kept point, ending at the result', () => {
    expect(res.running.runs.length).toBe(2000);
    expect(res.running.runs[1999]).toBe(10_000);
    expect(res.running.ok[1999] / 10_000).toBeCloseTo(res.okFraction, 12);
    expect(res.running.nodata[1999] / 10_000).toBeCloseTo(res.nodataFraction, 12);
    for (let k = 1; k < 2000; k++) expect(res.running.runs[k]).toBeGreaterThan(res.running.runs[k - 1]);
  });
  it('runs land at an accelerating rate, monotone, all of them by the end', () => {
    expect(sched.runsAt(0)).toBe(0);
    expect(sched.runsAt(1)).toBe(10_000);
    expect(sched.runsAt(0.5)).toBeLessThan(2500); // slow start, fast finish
    let prev = 0;
    for (let u = 0; u <= 1; u += 0.01) { const r = sched.runsAt(u); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
    for (const r of [1, 37, 5000, 9999]) expect(sched.runsAt(sched.progressAt(r))).toBeCloseTo(r, -1);
  });
  it('kept points appear in draw order, one per N / kept runs', () => {
    expect(sched.keptAt(0)).toBe(0);
    expect(sched.keptAt(5)).toBe(1);
    expect(sched.keptAt(5000)).toBe(1000);
    expect(sched.keptAt(10_000)).toBe(2000);
  });
  it('running numbers are exact tallies, and the last run shows the computed result', () => {
    const mid = sched.statsAt(3412);
    expect(mid.exact).toBe(true);
    expect(mid.runs).toBeLessThanOrEqual(3412);
    expect(mid.runs).toBeGreaterThan(3412 - 5);
    const end = sched.statsAt(10_000);
    expect(end).toMatchObject({ final: true, runs: 10_000, okFraction: res.okFraction, nodataFraction: res.nodataFraction, p95: res.slopeP95 });
  });
  it('without running tallies (WASM engine) it estimates from the kept points and still ends on the result', () => {
    const est = monteCarloSchedule({ points: res.points, samples: 10_000, maxSlopeDeg: 15, okFraction: res.okFraction, nodataFraction: res.nodataFraction, slopeP95: res.slopeP95 });
    const mid = est.statsAt(5000);
    expect(mid.exact).toBe(false);
    expect(Math.abs(mid.okFraction - sched.statsAt(5000).okFraction)).toBeLessThan(0.05);
    expect(est.statsAt(10_000).okFraction).toBe(res.okFraction);
  });
  it('counter text and timing', () => {
    const p = mcCounterParts({ runs: 3412, samples: 10_000, okFraction: 0.9921, nodataFraction: 0, p95: 6.31, final: false, exact: true }, 15);
    expect(`${p.run}   ${p.ok}   ${p.p95}`).toBe('Run 3,412 of 10,000   99.2 % within 15°   p95 slope 6.3°');
    expect(mcProgress(MC_START_S - 1)).toBe(0);
    expect(mcProgress(MC_END_S)).toBe(1);
    expect(MC_TEST_S / 60).toBeGreaterThanOrEqual(6); // 6 to 8 s of wall clock at the default 60x
    expect(MC_TEST_S / 60).toBeLessThanOrEqual(8);
    expect(LANDING_REVEAL_S).toBe(POST_TOUCHDOWN_S);
  });
});
