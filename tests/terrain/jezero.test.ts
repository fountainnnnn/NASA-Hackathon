/**
 * The QA round 1 half-route case on the real Jezero CTX DEM (public/data/dem.i16, skipped when the data is absent):
 * a target on a steep cell used to fail outbound but succeed on the return, and the card summed one leg as a round trip.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import type { DemMeta } from '@/lib/contracts';
import { decodeDem } from '@/lib/geo/frame';
import { computeSlopeField } from '@/lib/terrain/slope';
import { buildPlanningGrid, gridLonLatToCell } from '@/lib/terrain/grid';
import { nearestReachable, planRoute } from '@/lib/terrain/route';
import { solvePath } from '@/lib/terrain/astar';

const demPath = join(process.cwd(), 'public/data/dem.i16');
const BASE = { lon: 77.45088572, lat: 18.44462715 };
/** On a 24° planning cell west of the base (found by the QA probe). */
const STEEP = { lon: 77.41088572, lat: 18.44062715 };

describe.skipIf(!existsSync(demPath))('Jezero DEM: round trips are all or nothing', () => {
  const meta0 = JSON.parse(readFileSync(join(process.cwd(), 'public/data/dem_meta.json'), 'utf8')) as DemMeta;
  const { delta: _d, compression: _c, ...enc } = meta0.encoding; void _d; void _c;
  const raw = readFileSync(demPath);
  const dem = decodeDem({ ...meta0, file: 'dem.i16', encoding: enc }, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const grid = buildPlanningGrid(dem, computeSlopeField(dem));
  const cell = (p: { lon: number; lat: number }) => { const c = gridLonLatToCell(grid, p.lon, p.lat)!; return c.r * grid.width + c.c; };

  it('the steep target fails both ways, the plan has no legs, and 25° is the smallest limit that works', () => {
    const P = { maxSlopeDeg: 15, objective: 'fastest' as const, suitSpeedFactor: 0.6 };
    expect(grid.slopeMaxDeg[cell(STEEP)]).toBeGreaterThan(15);
    expect(solvePath(grid, cell(BASE), cell(STEEP), P).ok).toBe(false);
    expect(solvePath(grid, cell(STEEP), cell(BASE), P).ok).toBe(false);
    const res = planRoute(grid, { from: BASE, to: STEEP, roundTrip: true, constraints: DEFAULT_CONSTRAINTS });
    expect(res.legs).toEqual([]);
    expect(res.totals.lengthM).toBe(0);
    expect(res.targetSlopeDeg!).toBeGreaterThan(15);
    expect(res.minFeasibleSlopeDeg).toBe(Math.ceil(res.targetSlopeDeg!));
  }, 30_000);

  it('the nearest reachable point plans a full round trip whose length is the sum of its legs', () => {
    const near = nearestReachable(grid, BASE, STEEP, 15);
    expect(near.point).not.toBeNull();
    expect(near.movedM!).toBeLessThan(200);
    const res = planRoute(grid, { from: BASE, to: near.point!, roundTrip: true, constraints: DEFAULT_CONSTRAINTS });
    expect(res.legs.length).toBe(2);
    expect(res.totals.lengthM).toBeCloseTo(res.legs[0].lengthM + res.legs[1].lengthM, 6);
  }, 30_000);
});
