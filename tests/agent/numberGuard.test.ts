import { describe, expect, it } from 'vitest';
import { findUnverifiedNumbers } from '../../src/lib/agent/numberGuard';

const src = [{ totals: { lengthM: 7312, evaMin: 125, batteryUsedPct: 34.2, maxSlopeDeg: 11.3 }, sol: 412, lon: 77.4513, lat: 18.4438 }];

describe('numberGuard', () => {
  it('flags a planted number not in sources', () => {
    expect(findUnverifiedNumbers('The route is 9.8 km long.', src)).toEqual(['9.8 km']);
  });
  it('accepts unit conversions and rounding', () => {
    expect(findUnverifiedNumbers('Length 7.3 km, i.e. 7,312 m; EVA 2.1 hours (125 min); battery 34%; slope 11.3°.', src)).toEqual([]);
    expect(findUnverifiedNumbers('At 18.44°N, 77.45°E near sol 412.', src)).toEqual([]);
  });
  it('flags a wrong version of a real number', () => {
    expect(findUnverifiedNumbers('Length is 7.3 km but takes 200 min.', src)).toEqual(['200 min']);
  });
  it('ignores list numbers, years, small counts, ids', () => {
    const t = '1. First leg\n2) Second leg\nIn 2021 we used R2 and 3 stops, Sol 999 hmm.';
    expect(findUnverifiedNumbers(t, src)).toEqual(['999']);
  });
});
