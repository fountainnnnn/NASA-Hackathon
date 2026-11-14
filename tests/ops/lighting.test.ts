import { describe, expect, it } from 'vitest';
import { daylightCheck, latestSafeStart, SOL_MS, sunAlongRoute } from '@/lib/ops/lighting';
import { marsState, sunPosition, sunriseSunset } from '@/lib/ops/mars24';
import { buildTimeline, positionAt } from '@/lib/ops/timeline';
import { handRoute, LAT_C, LON_C, line, planSynthetic } from './fixtures';

// synthetic test fixture — routes are planned on a hand-built DEM; sun is the real Mars24 model at Jezero coordinates
const route = planSynthetic({ evaMaxMin: 1e6 });
const tl = buildTimeline(route);
const MIN = 60_000;
const sun = sunriseSunset(LAT_C, LON_C, Date.UTC(2026, 10, 14, 12));

describe('timeline', () => {
  it('reproduces the planner totals (EVA minutes incl. dwell, distance, battery)', () => {
    expect(route.feasible).toBe(true);
    expect(tl.totalMin).toBeCloseTo(route.totals.evaMin, 6);
    expect(tl.totalDistM).toBeCloseTo(route.totals.lengthM, 6);
    const last = tl.samples[tl.samples.length - 1];
    expect(100 - last.batteryPct).toBeCloseTo(route.totals.batteryUsedPct, 6);
    expect(tl.samples.filter((s) => s.kind === 'target')).toHaveLength(1);
    expect(tl.samples[0].kind).toBe('start');
    expect(last.kind).toBe('end');
    // dwell shows as a time jump at the leg boundary, no distance jump
    const t = tl.samples.find((s) => s.kind === 'target')!;
    const next = tl.samples[t.idx + 1];
    expect(next.tMin - t.tMin).toBeCloseTo(route.constraintsUsed.dwellMin, 9);
    expect(next.distM).toBeCloseTo(t.distM, 9);
  });
  it('one-way route: dwell after the target is counted in totalMin', () => {
    const ow = planSynthetic({ evaMaxMin: 1e6 }, false);
    const otl = buildTimeline(ow);
    expect(otl.totalMin).toBeCloseTo(ow.totals.evaMin, 6);
    expect(otl.samples[otl.samples.length - 1].kind).toBe('target');
  });
  it('positionAt interpolates inside segments and holds during dwell', () => {
    const a = tl.samples[3], b = tl.samples[4];
    const mid = positionAt(tl, (a.tMin + b.tMin) / 2);
    expect(mid.lon).toBeCloseTo((a.lon + b.lon) / 2, 9);
    const t = tl.samples.find((s) => s.kind === 'target')!;
    const during = positionAt(tl, t.tMin + route.constraintsUsed.dwellMin / 2);
    expect(during.lon).toBeCloseTo(t.lon, 9);
    expect(positionAt(tl, -5).lon).toBe(tl.samples[0].lon);
    expect(positionAt(tl, 1e9).lat).toBe(tl.samples[tl.samples.length - 1].lat);
  });
});

describe('sun along the route', () => {
  it('matches a direct Mars24 evaluation at every sample and sweeps azimuth/elevation over a noon EVA', () => {
    const start = sun.noonMs - (tl.totalMin / 2) * MIN;
    const s = sunAlongRoute(route, start);
    expect(s).toHaveLength(tl.samples.length);
    for (const i of [0, 7, s.length - 1]) {
      const p = sunPosition(start + tl.samples[i].tMin * MIN, tl.samples[i].lat, tl.samples[i].lon);
      expect(s[i].elevationDeg).toBeCloseTo(p.elevationDeg, 9);
      expect(s[i].azimuthDeg).toBeCloseTo(p.azimuthDeg, 9);
    }
    expect(Math.max(...s.map((x) => x.elevationDeg))).toBeGreaterThan(sun.maxElevationDeg - 1);
  });
});

describe('daylight check', () => {
  it('noon-centred EVA is fine; starting late so the sun sets mid-EVA is not', () => {
    const good = daylightCheck(route, sun.noonMs - (tl.totalMin / 2) * MIN);
    expect(good.ok).toBe(true);
    expect(good.minElevationDeg).toBeGreaterThan(5);
    expect(good.firstViolationMin).toBeNull();
    const bad = daylightCheck(route, sun.sunsetMs! - 30 * MIN);
    expect(bad.ok).toBe(false);
    expect(bad.firstViolationMin).toBeGreaterThan(0);
    expect(bad.firstViolationMin).toBeLessThan(40);
    expect(bad.endElevationDeg).toBeLessThan(0);
    expect(bad.minElevationDeg).toBeLessThan(0);
  });
  it('threshold is configurable (assumption): a 10° minimum fails earlier than 0°', () => {
    const start = sun.sunsetMs! - (tl.totalMin + 20) * MIN;
    expect(daylightCheck(route, start, 0).ok).toBe(true);
    expect(daylightCheck(route, start, 10).ok).toBe(false);
  });
  it('the final dwell is covered (a one-way route ending in dwell at sunset)', () => {
    const ow = buildTimeline(planSynthetic({ evaMaxMin: 1e6, dwellMin: 60 }, false));
    // arrive at the target 10 min before sunset; the 60 min dwell runs into darkness
    const arrive = ow.samples[ow.samples.length - 1].tMin;
    const r = daylightCheck(ow, sun.sunsetMs! - (arrive + 10) * MIN);
    expect(r.ok).toBe(false);
    expect(r.firstViolationMin).toBeGreaterThan(arrive);
  });
});

describe('latestSafeStart', () => {
  const r = latestSafeStart(route, sun.sunriseMs! - 2 * 3600e3)!;
  it('exists, EVA ends right at the elevation threshold, and 3 min later fails', () => {
    expect(r).not.toBeNull();
    expect(r.evaMin).toBeCloseTo(tl.totalMin, 6);
    expect(daylightCheck(route, r.latestStartUtcMs).ok).toBe(true);
    expect(daylightCheck(route, r.latestStartUtcMs + 3 * MIN).ok).toBe(false);
    // the EVA ends within a few minutes of geometric sunset
    expect(Math.abs(r.latestEndUtcMs - sun.sunsetMs!)).toBeLessThan(5 * MIN);
    const last = tl.samples[tl.samples.length - 1];
    expect(Math.abs(sunPosition(r.latestEndUtcMs, last.lat, last.lon).elevationDeg)).toBeLessThan(0.6);
  });
  it('earliest start is at sunrise; window ordering', () => {
    expect(r.earliestStartUtcMs).toBeLessThan(r.latestStartUtcMs);
    expect(Math.abs(r.earliestStartUtcMs - sun.sunriseMs!)).toBeLessThan(5 * MIN);
    expect(r.latestStartUtcMs - r.earliestStartUtcMs).toBeCloseTo(sun.sunsetMs! - sun.sunriseMs! - tl.totalMin * MIN, -5);
  });
  it('higher minimum elevation shrinks the window; an EVA longer than daylight returns null', () => {
    const r10 = latestSafeStart(route, sun.sunriseMs! - 2 * 3600e3, { minElevationDeg: 10 })!;
    expect(r10.latestStartUtcMs).toBeLessThan(r.latestStartUtcMs);
    expect(r10.earliestStartUtcMs).toBeGreaterThan(r.earliestStartUtcMs);
    const long = handRoute([line([0, 0], [100, 0])], { constraints: { dwellMin: 1500 } });
    expect(latestSafeStart(long, sun.sunriseMs! - 2 * 3600e3)).toBeNull();
  });
  it('search window defaults to one sol', () => {
    expect(SOL_MS).toBeCloseTo(88775244.7, -1);
    expect(marsState(r.latestStartUtcMs).msd).toBeGreaterThan(0);
  });
});
