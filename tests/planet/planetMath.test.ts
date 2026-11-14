import { describe, expect, it } from 'vitest';
import {
  TERRAIN_DATUM_OFFSET_M, ctxAlpha, globeLightBlend, effectiveExaggeration, elevationFromHeight, flightDurationS, heightFromElevation, inJezero,
  landingViewpoint, liftBucket, liftForRangeM, pitchForAltitudeKm, rangeForAltitudeM, roundAltKm, retryEachFrame,
} from '../../src/components/Planet/planetMath';

describe('terrain datum', () => {
  it('round-trips MOLA elevation and tile height', () => {
    expect(heightFromElevation(-2540)).toBe(-2540 + TERRAIN_DATUM_OFFSET_M);
    expect(elevationFromHeight(heightFromElevation(1234))).toBe(1234);
  });
});

describe('jezero hand-off region', () => {
  it('knows the 20 m coverage and a margin', () => {
    expect(inJezero(77.45, 18.44)).toBe(true);
    expect(inJezero(77.1, 18.44)).toBe(false);
    expect(inJezero(77.13, 18.44, 0.05)).toBe(true);
    expect(inJezero(-59, -14)).toBe(false);
  });
});

describe('camera framing', () => {
  it('looks straight down from orbit and obliquely near the ground', () => {
    expect(pitchForAltitudeKm(9000)).toBe(-90);
    expect(pitchForAltitudeKm(400)).toBeCloseTo(-90, 5);
    expect(pitchForAltitudeKm(30)).toBeCloseTo(-35, 5);
    expect(pitchForAltitudeKm(5)).toBeCloseTo(-35, 5);
    expect(pitchForAltitudeKm(100)).toBeGreaterThan(-90);
    expect(pitchForAltitudeKm(100)).toBeLessThan(-35);
  });
  it('range gives the requested height', () => {
    expect(rangeForAltitudeM(10, -30)).toBeCloseTo(20_000, 3);
    expect(rangeForAltitudeM(500, -90)).toBeCloseTo(500_000, 3);
  });
  it('landing view is east of the site, 25 to 35 degrees, 15 to 25 km for a Mars 2020 sized ellipse', () => {
    const v = landingViewpoint({ semiMajorKm: 7.7 });
    expect(v.headingDeg).toBe(270);
    expect(Math.abs(v.pitchDeg)).toBeGreaterThanOrEqual(25);
    expect(Math.abs(v.pitchDeg)).toBeLessThanOrEqual(35);
    expect(v.rangeM).toBeGreaterThanOrEqual(15_000);
    expect(v.rangeM).toBeLessThanOrEqual(25_000);
    expect(landingViewpoint().rangeM).toBeGreaterThanOrEqual(15_000);
  });
  it('flight time stays in a sensible band', () => {
    expect(flightDurationS(5)).toBeGreaterThanOrEqual(1.2);
    expect(flightDurationS(10_000, 500)).toBeLessThanOrEqual(4.6);
  });
});

describe('imagery and relief by altitude', () => {
  it('CTX fades in between 1200 and 300 km', () => {
    expect(ctxAlpha(5000)).toBe(0);
    expect(ctxAlpha(1200)).toBe(0);
    expect(ctxAlpha(300)).toBe(1);
    expect(ctxAlpha(20)).toBe(1);
    const m = ctxAlpha(700);
    expect(m).toBeGreaterThan(0); expect(m).toBeLessThan(1);
  });
  it('the sun is local near the ground and camera-relative for the whole disc', () => {
    expect(globeLightBlend(15)).toBe(0);
    expect(globeLightBlend(300)).toBe(0);
    expect(globeLightBlend(9000)).toBe(1);
  });
  it('real terrain is shown true near the ground', () => {
    expect(effectiveExaggeration(20, 50)).toBe(1);
    expect(effectiveExaggeration(20, 9000)).toBeGreaterThan(1);
    expect(effectiveExaggeration(20, 9000)).toBeLessThan(3);
    expect(effectiveExaggeration(1, 9000)).toBe(1);
  });
});

describe('overlay lift and rounding', () => {
  it('lift grows with range, bounded', () => {
    expect(liftForRangeM(100)).toBe(4);
    expect(liftForRangeM(20_000)).toBeCloseTo(80, 5);
    expect(liftForRangeM(1e9)).toBe(1500);
    expect(liftBucket(20_000)).not.toBe(liftBucket(80_000));
  });
  it('altitude rounding', () => {
    expect(roundAltKm(1234.4)).toBe(1234);
    expect(roundAltKm(12.34)).toBe(12.3);
  });
});

describe('relief shading', () => {
  it('is full near the ground and off for whole-disc views', async () => {
    const { reliefShading } = await import('../../src/components/Planet/planetMath');
    expect(reliefShading(500)).toBe(1);
    expect(reliefShading(9000)).toBe(0);
    expect(reliefShading(3500)).toBeGreaterThan(0); expect(reliefShading(3500)).toBeLessThan(1);
  });
});

describe('retryEachFrame (first globe click after load is never lost)', () => {
  /** A fake render loop and timer queue, driven by hand. */
  const rig = () => {
    const frames = new Set<() => void>();
    const timers: { f: () => void; ms: number; live: boolean }[] = [];
    return {
      onFrame: (cb: () => void) => { frames.add(cb); return () => { frames.delete(cb); }; },
      timers: { set: (f: () => void, ms: number) => { const t = { f, ms, live: true }; timers.push(t); return t; }, clear: (id: unknown) => { (id as { live: boolean }).live = false; } },
      frame: () => [...frames].forEach((f) => f()),
      expire: () => timers.filter((t) => t.live).forEach((t) => { t.live = false; t.f(); }),
      frameCount: () => frames.size,
    };
  };
  it('resolves at once when the ground is already pickable', async () => {
    const r = rig();
    await expect(retryEachFrame(() => 7, r.onFrame, 2000, r.timers)).resolves.toBe(7);
    expect(r.frameCount()).toBe(0);
  });
  it('retries each frame until the picker is ready, then stops listening', async () => {
    const r = rig();
    let ready = false, calls = 0;
    const p = retryEachFrame(() => { calls++; return ready ? { lon: 1 } : null; }, r.onFrame, 2000, r.timers);
    r.frame(); r.frame();
    expect(calls).toBe(3);
    ready = true;
    r.frame();
    await expect(p).resolves.toEqual({ lon: 1 });
    expect(r.frameCount()).toBe(0);
    r.expire(); // the deadline was cleared: no extra attempt
    expect(calls).toBe(4);
  });
  it('gives up after the timeout with one last try, even when no frame arrives', async () => {
    const r = rig();
    let calls = 0;
    const p = retryEachFrame(() => { calls++; return null; }, r.onFrame, 2000, r.timers);
    r.expire();
    await expect(p).resolves.toBeNull();
    expect(calls).toBe(2);
    expect(r.frameCount()).toBe(0);
  });
});
