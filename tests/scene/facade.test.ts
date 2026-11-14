import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '../../src/lib/contracts';
import type { Dem, DemMeta } from '../../src/lib/contracts';
import { BASE_LABEL, configureWorld, resetWorldForTests, useWorld, world } from '../../src/state/world';

const meta = {
  width: 10, height: 10, lonMin: 77.3, lonMax: 77.6, latMin: 18.3, latMax: 18.6, dLon: 0.03, dLat: 0.03, hRef: -2500,
} as DemMeta;
const dem: Dem = { meta, elev: new Float32Array(100).fill(-2400) };

describe('world facade', () => {
  const sampleElevation = vi.fn((_d: Dem, lon: number, lat: number) => (lon > 77.55 ? null : -2000 + Math.round((lat - 18.3) * 1000)));
  const toLocal = vi.fn((_m: DemMeta, lon: number, lat: number) => ({ x: (lon - 77.45) * 1000, z: -(lat - 18.45) * 1000 }));
  const toLonLat = vi.fn((_m: DemMeta, x: number, z: number) => ({ lon: 77.45 + x / 1000, lat: 18.45 - z / 1000 }));

  beforeEach(() => {
    resetWorldForTests();
    sampleElevation.mockClear();
    configureWorld({ dem, geo: { sampleElevation, toLocal, toLonLat } });
  });

  it('makePoint takes elevation from the DEM sampler, not from any mesh', () => {
    const p = world.makePoint(77.4, 18.4, 'pick', 'here');
    expect(sampleElevation).toHaveBeenCalledWith(dem, 77.4, 18.4);
    expect(p.elevationM).toBe(-1900);
    expect(p).toMatchObject({ lon: 77.4, lat: 18.4, source: 'pick', label: 'here' });
    expect(p.x).toBeCloseTo(-50);
    expect(p.z).toBeCloseTo(50);
  });

  it('makePoint returns null elevation for nodata and unique ids', () => {
    const a = world.makePoint(77.58, 18.4, 'agent');
    const b = world.makePoint(77.4, 18.4, 'agent');
    expect(a.elevationM).toBeNull();
    expect(a.id).not.toBe(b.id);
  });

  it('seeds the Perseverance landing-site base', () => {
    const snap = world.snapshot();
    expect(snap.base?.label).toBe(BASE_LABEL);
    expect(snap.base).toMatchObject({ lon: 77.45088572, lat: 18.44462715, source: 'preset' });
    expect(snap.demBounds).toEqual({ lonMin: 77.3, lonMax: 77.6, latMin: 18.3, latMax: 18.6 });
    expect(snap.constraints).toEqual(DEFAULT_CONSTRAINTS);
  });

  it('applyCommands goes through the reducer and updates the store', () => {
    const p = world.makePoint(77.4, 18.4, 'agent');
    const route = world.addRoute({
      label: 'r', from: p, to: p, roundTrip: false, legs: [], feasible: true, reasons: [], gridResM: 40, demResM: 20, computeMs: 1,
      totals: { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 },
      constraintsUsed: DEFAULT_CONSTRAINTS,
    });
    expect(route.id).toBe('R1');
    expect(world.getRoute('R1')).toBe(route);
    const res = world.applyCommands([
      { type: 'draw_route', routeId: 'R1' },
      { type: 'add_pin', lon: 99, lat: 18.4, label: 'out', kind: 'info' },
    ]);
    expect(res.applied).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(world.snapshot().visibleRouteIds).toEqual(['R1']);
    expect(useWorld.getState().drawerOpen).toBe(true);
  });

  it('setConstraints clamps to safe ranges and returns the merged value', () => {
    const c = world.setConstraints({ maxSlopeDeg: 99, batteryReservePct: 25, objective: 'shortest' });
    expect(c.maxSlopeDeg).toBe(40);
    expect(c.batteryReservePct).toBe(25);
    expect(c.objective).toBe('shortest');
    expect(world.snapshot().constraints).toEqual(c);
  });
});
