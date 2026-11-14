import { describe, expect, it } from 'vitest';
import type { EdlPhase } from '@/lib/globeContracts';
import {
  LANDING_REVEAL_S, altitudeKmAt, approachFraction, edlEndS, landingDurationS, phaseAt, popScale, revealCount, revealProgress, unpackTouchdowns,
} from '@/components/Scenario/landing';

const src = { title: 'test source', url: 'https://example.invalid' };
const phases: EdlPhase[] = [
  { id: 'a', label: 'Phase A', tStartS: 0, tEndS: 100, altitudeKmStart: 100, altitudeKmEnd: 10, source: src },
  { id: 'b', label: 'Phase B', tStartS: 100, tEndS: 300, altitudeKmStart: 10, altitudeKmEnd: 0, source: src },
];

describe('landing playback maths', () => {
  it('duration is the EDL end plus the reveal window', () => {
    expect(edlEndS(phases)).toBe(300);
    expect(landingDurationS(phases)).toBe(300 + LANDING_REVEAL_S);
  });
  it('phase and altitude come from the cited phases only', () => {
    expect(phaseAt(phases, 50)!.id).toBe('a');
    expect(phaseAt(phases, 100)!.id).toBe('b');
    expect(phaseAt(phases, 5000)!.id).toBe('b');
    expect(altitudeKmAt(phases, 50)).toBeCloseTo(55, 9);
    expect(altitudeKmAt(phases, 200)).toBeCloseTo(5, 9);
  });
  it('approach is monotone from 0 to 1', () => {
    let prev = -1;
    for (let t = 0; t <= 300; t += 15) { const f = approachFraction(t, 300); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
    expect(approachFraction(0, 300)).toBe(0);
    expect(approachFraction(300, 300)).toBe(1);
    expect(approachFraction(9999, 300)).toBe(1);
  });
  it('touchdown points appear only after the EDL and all of them by the end, at any speed', () => {
    const n = 2000;
    expect(revealCount(299, 300, n)).toBe(0);
    expect(revealCount(300 + LANDING_REVEAL_S / 2, 300, n)).toBe(1000);
    expect(revealCount(300 + LANDING_REVEAL_S, 300, n)).toBe(n);
    expect(revealProgress(1e9, 300)).toBe(1);
    // coarse 600x ticks (one tick = 10 s of wall clock) still reach the full count and never exceed it
    let last = 0;
    for (let t = 0; t <= 300 + LANDING_REVEAL_S + 600; t += 600 * 0.016 * 60) { const c = revealCount(t, 300, n); expect(c).toBeGreaterThanOrEqual(last); expect(c).toBeLessThanOrEqual(n); last = c; }
    expect(last).toBe(n);
  });
  it('pop scale rises from 0 to 1', () => {
    expect(popScale(0)).toBe(0);
    expect(popScale(1)).toBe(1);
    expect(popScale(0.5)).toBeGreaterThan(0.5);
  });
  it('colours: ok only when the slope is finite and within the limit', () => {
    const pts = new Float32Array([10, 20, 5, 10, 20, 12, 10, 20, NaN]);
    expect(unpackTouchdowns(pts, 10).map((p) => p.ok)).toEqual([true, false, false]);
  });
});
