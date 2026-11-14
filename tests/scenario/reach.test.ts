import { describe, expect, it } from 'vitest';
import type { LonLat, RouteResult } from '@/lib/contracts';
import {
  computeReach, contourPolygon, contourRadius, frontierOnRoute, offsetLonLat, reachAreaKm2, reserveProfile,
} from '@/components/Scenario/reach';
import type { PlanRoundTrip } from '@/components/Scenario/reach';
import { groundDistanceM } from '@/lib/geo/frame';
import { SYN_CONSTRAINTS, makeSyntheticPlanner, synLonLat } from '@/components/Scenario/synthetic';

const centre: LonLat = synLonLat(-700, 700);

describe('offsetLonLat', () => {
  it('moves the requested ground distance along the bearing', () => {
    for (const b of [0, 90, 180, 270, 45]) {
      const p = offsetLonLat(centre, b, 1500);
      expect(groundDistanceM(centre, p)).toBeCloseTo(1500, 0);
    }
    expect(offsetLonLat(centre, 0, 1000).lat).toBeGreaterThan(centre.lat);
    expect(offsetLonLat(centre, 90, 1000).lon).toBeGreaterThan(centre.lon);
  });
});

describe('computeReach with a mocked planner', () => {
  it('with retries disabled issues exactly one plan per bearing (24) and reports progress', async () => {
    let calls = 0;
    const inner = makeSyntheticPlanner();
    const planner: PlanRoundTrip = (a, b) => { calls++; return inner(a, b); };
    const prog: number[] = [];
    const r = await computeReach({ center: centre, planRoundTrip: planner, maxRadiusM: 2800, maxPlans: 24, onProgress: (d) => prog.push(d) });
    expect(calls).toBe(24);
    expect(r.plans).toBe(24);
    expect(r.samples).toHaveLength(24);
    expect(prog[prog.length - 1]).toBe(24);
  });

  it('never exceeds the plan budget and retries blocked bearings at shorter radii', async () => {
    let calls = 0;
    const inner = makeSyntheticPlanner();
    const planner: PlanRoundTrip = (a, b) => { calls++; return inner(a, b); };
    const first = await computeReach({ center: centre, planRoundTrip: inner, maxRadiusM: 2800, maxPlans: 24 });
    const r = await computeReach({ center: centre, planRoundTrip: planner, maxRadiusM: 2800 });
    expect(calls).toBeLessThanOrEqual(48);
    expect(calls).toBe(r.plans);
    const blockedBefore = first.samples.filter((s) => s.status === 'blocked').length;
    const blockedAfter = r.samples.filter((s) => s.status === 'blocked').length;
    expect(blockedBefore).toBeGreaterThan(0);
    expect(blockedAfter).toBeLessThan(blockedBefore);
    for (const s of r.samples.filter((q) => q.reasons.includes('no_path_slope') && q.status === 'limited')) expect(s.radiusM).toBeLessThan(2800);
  });

  it('feasible bearings reach the full radius, slope-blocked bearings reach zero, battery-limited are partial', async () => {
    const r = await computeReach({ center: centre, planRoundTrip: makeSyntheticPlanner(), maxRadiusM: 2800 });
    const kinds = new Set(r.samples.map((s) => s.status));
    expect(kinds.has('blocked') || kinds.has('limited')).toBe(true);
    for (const s of r.samples) {
      if (s.status === 'full') expect(s.radiusM).toBe(2800);
      if (s.status === 'blocked') { expect(s.radiusM).toBe(0); expect(s.point).toBeNull(); }
      if (s.status === 'limited') { expect(s.radiusM).toBeGreaterThan(0); expect(s.radiusM).toBeLessThanOrEqual(2800); expect(s.reserveMinAtFrontier!).toBeGreaterThanOrEqual(0); }
    }
  });

  it('a battery-limited bearing stops at the last vertex with reserve >= 0', async () => {
    const plan = makeSyntheticPlanner();
    const r = await computeReach({ center: centre, planRoundTrip: plan, maxRadiusM: 2800 });
    const lim = r.samples.find((q) => q.status === 'limited');
    expect(lim).toBeDefined();
    const route = await plan(centre, offsetLonLat(centre, lim!.bearingDeg, 2800));
    const prof = reserveProfile(route, centre);
    const idx = prof.findIndex((p) => p.reserveMin < 0);
    expect(idx).toBeGreaterThan(0);
    expect(prof[idx - 1].reserveMin).toBeGreaterThanOrEqual(0);
    expect(frontierOnRoute(route, centre)!.reserveMin).toBeCloseTo(prof[idx - 1].reserveMin, 9);
    expect(lim!.radiusM).toBeCloseTo(prof[idx - 1].radiusM, 6);
  });

  it('reserve contours are nested: more reserve required means a smaller radius', async () => {
    const r = await computeReach({ center: centre, planRoundTrip: makeSyntheticPlanner(), maxRadiusM: 2800 });
    for (const s of r.samples) {
      const r0 = contourRadius(s, 0, 2800), r30 = contourRadius(s, 30, 2800), r60 = contourRadius(s, 60, 2800);
      expect(r30).toBeLessThanOrEqual(r0 + 1e-9);
      expect(r60).toBeLessThanOrEqual(r30 + 1e-9);
    }
    const poly = contourPolygon(r.samples, 0, 2400, 96);
    expect(poly).toHaveLength(96);
    expect(reachAreaKm2(r.samples)).toBeGreaterThan(0);
    expect(reachAreaKm2(r.samples)).toBeLessThanOrEqual((Math.PI * 2.8 * 2.8) + 0.01);
  });

  it('cancel stops issuing plans and marks the result cancelled', async () => {
    const ac = new AbortController();
    let calls = 0;
    const inner = makeSyntheticPlanner(SYN_CONSTRAINTS, 5);
    const planner: PlanRoundTrip = (a, b) => { calls++; if (calls === 6) ac.abort(); return inner(a, b); };
    const r = await computeReach({ center: centre, planRoundTrip: planner, maxRadiusM: 2800, signal: ac.signal, concurrency: 2 });
    expect(r.cancelled).toBe(true);
    expect(calls).toBeLessThan(24);
    expect(r.samples.length).toBeLessThan(24);
  });

  it('a planner that throws becomes a blocked bearing instead of failing the whole run', async () => {
    const planner: PlanRoundTrip = async () => { throw new Error('boom'); };
    const r = await computeReach({ center: centre, planRoundTrip: planner, maxRadiusM: 1000, bearings: 8 });
    expect(r.samples.every((s) => s.status === 'blocked')).toBe(true);
  });

  it('works with an entirely hand-made RouteResult', async () => {
    const res = (feasible: boolean): RouteResult => ({ ...(({} as unknown) as RouteResult), feasible, legs: [], reasons: feasible ? [] : ['no_path_slope'], constraintsUsed: SYN_CONSTRAINTS, roundTrip: true });
    const planner: PlanRoundTrip = async (_a, b) => res(b.lat > centre.lat);
    const r = await computeReach({ center: centre, planRoundTrip: planner, maxRadiusM: 500, bearings: 4 });
    const byB = Object.fromEntries(r.samples.map((s) => [s.bearingDeg, s.status]));
    expect(byB[0]).toBe('full');
    expect(byB[180]).toBe('blocked');
  });
});

describe('contour levels', () => {
  it('start at 0 and use a round step with at most four lines above the frontier', async () => {
    const { contourLevels } = await import('@/components/Scenario/reach');
    const r = await computeReach({ center: centre, planRoundTrip: makeSyntheticPlanner(), maxRadiusM: 2800 });
    const lv = contourLevels(r.samples);
    expect(lv[0]).toBe(0);
    expect(lv.length).toBeLessThanOrEqual(5);
    const step = lv[1];
    lv.slice(1).forEach((m, i) => expect(m).toBe(step * (i + 1)));
  });
});
