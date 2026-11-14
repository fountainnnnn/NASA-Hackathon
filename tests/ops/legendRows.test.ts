import { describe, expect, it } from 'vitest';
import { jezeroLegendRows, landingLegendRows } from '../../src/components/Ops/legendRows';
import { REVEAL_DELAY_S } from '../../src/components/Planet/descent';
import type { RouteResult } from '../../src/lib/contracts';

const route = (slopes: number[], pathLen = 3) => ({
  constraintsUsed: { maxSlopeDeg: 15 },
  legs: [{ path: Array.from({ length: pathLen }, (_, i) => ({ lon: i, lat: 0 })), segSlopeDeg: slopes }],
}) as unknown as RouteResult;
const base = { highlights: 0, traverse: false, scenario: false, hirise: false, close: false };

describe('legend rows follow the state', () => {
  it('no route rows without a route', () => {
    const r = jezeroLegendRows({ ...base, route: null });
    expect(r.route).toBe(false); expect(r.fails).toBe(false);
  });
  it('a route with no path draws no route rows', () => { expect(jezeroLegendRows({ ...base, route: route([], 0) }).route).toBe(false); });
  it('"Fails a limit" only when a stretch fails', () => {
    expect(jezeroLegendRows({ ...base, route: route([3, 4]) }).fails).toBe(false);
    expect(jezeroLegendRows({ ...base, route: route([3, 16]) }).fails).toBe(true);
    expect(jezeroLegendRows({ ...base, route: route([3, 4]), highlights: 1 }).fails).toBe(true);
  });
  it('names the imagery under a close camera: HiRISE where it is draped, CTX elsewhere', () => {
    expect(jezeroLegendRows({ ...base, route: null, close: true }).imagery).toMatch(/CTX 6 m/);
    expect(jezeroLegendRows({ ...base, route: null, close: true, hirise: true }).imagery).toMatch(/HiRISE 1\.3 m/);
    expect(jezeroLegendRows({ ...base, route: null }).imagery).toBeNull();
  });
  it('traverse row hidden during walks and reach', () => {
    expect(jezeroLegendRows({ ...base, route: null, traverse: true }).traverse).toBe(true);
    expect(jezeroLegendRows({ ...base, route: null, traverse: true, scenario: true }).traverse).toBe(false);
  });
  it('landing: touchdown dot rows only once the scatter is on screen', () => {
    expect(landingLegendRows(300, 420).dots).toBe(false);
    expect(landingLegendRows(425, 420).dots).toBe(false);
    expect(landingLegendRows(420 + REVEAL_DELAY_S, 420).dots).toBe(true);
  });
});
