import { describe, expect, it } from 'vitest';
import { computeSlopeField } from '@/lib/terrain/slope';
import { makeInclinedPlaneDem, makeSyntheticDem } from '../fixtures/synthetic';

const DEG = Math.PI / 180;

describe('Horn slope', () => {
  for (const [gx, gy] of [[0.1, 0], [0, 0.25], [0.3, -0.4], [0, 0]]) {
    it(`matches atan(gradient) on an inclined plane gx=${gx} gy=${gy}`, () => {
      const dem = makeInclinedPlaneDem(gx, gy);
      const s = computeSlopeField(dem);
      const expected = Math.atan(Math.hypot(gx, gy)) / DEG;
      const w = dem.meta.width;
      for (let r = 1; r < dem.meta.height - 1; r += 5) {
        for (let c = 1; c < w - 1; c += 5) expect(Math.abs(s[r * w + c] - expected)).toBeLessThan(0.05);
      }
    });
  }

  it('borders and cells next to nodata are NaN; ridge is steep, plain is flat', () => {
    const dem = makeSyntheticDem();
    const s = computeSlopeField(dem);
    const w = dem.meta.width;
    expect(s[0]).toBeNaN();
    expect(s[w * 50]).toBeNaN();
    expect(s[w * 119 + 50]).toBeNaN();
    expect(s[92 * w + 89]).toBeNaN(); // neighbour of hole
    expect(s[66 * w + 20]).toBeGreaterThan(30); // ridge flank
    expect(s[25 * w + 20]).toBeLessThan(2);
  });
});
