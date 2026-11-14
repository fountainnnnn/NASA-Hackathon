import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import { computeSlopeField } from '@/lib/terrain/slope';
import { buildPlanningGrid, gridCellLonLat } from '@/lib/terrain/grid';
import { planRoute } from '@/lib/terrain/route';
import { solvePath } from '@/lib/terrain/astar';
import { makeSmoothDem } from '../fixtures/synthetic';

describe('performance', () => {
  it('800x800 smooth grid solves corner-to-corner in < 1500 ms', () => {
    const dem = makeSmoothDem(1600);
    const grid = buildPlanningGrid(dem, computeSlopeField(dem));
    expect(grid.width).toBe(800);
    expect(grid.height).toBe(800);
    const a = gridCellLonLat(grid, 2, 2), b = gridCellLonLat(grid, 797, 797);
    for (const objective of ['fastest', 'shortest'] as const) {
      const t0 = performance.now();
      const res = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: { ...DEFAULT_CONSTRAINTS, objective, evaMaxMin: 1e9 } });
      const ms = performance.now() - t0;
      console.log(`corner-to-corner ${objective}: ${ms.toFixed(0)} ms, ${res.legs[0]?.path.length} vertices`);
      expect(res.legs.length).toBe(1);
      expect(ms).toBeLessThan(1500);
    }
  }, 60000);

  it('worst case (unreachable goal forces full-grid expansion) stays < 1500 ms', () => {
    const dem = makeSmoothDem(1600, 5);
    const grid = buildPlanningGrid(dem, computeSlopeField(dem));
    const goal = 797 * 800 + 797;
    // wall the goal in: its eight neighbours violate the limit, so every reachable cell is expanded before giving up
    // (a goal cell that itself violates the limit is now rejected up front by the endpoint rule)
    for (const d of [-801, -800, -799, -1, 1, 799, 800, 801]) grid.slopeMaxDeg[goal + d] = 89;
    for (const objective of ['fastest', 'shortest'] as const) {
      const t0 = performance.now();
      const res = solvePath(grid, 2 * 800 + 2, goal, { maxSlopeDeg: 15, objective, suitSpeedFactor: 0.6 });
      const ms = performance.now() - t0;
      console.log(`full expansion ${objective}: ${ms.toFixed(0)} ms, expanded ${res.expanded}`);
      expect(res.ok).toBe(false);
      expect(res.expanded).toBeGreaterThan(500000);
      expect(ms).toBeLessThan(1500);
    }
  }, 60000);
});
