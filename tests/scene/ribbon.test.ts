import { describe, expect, it } from 'vitest';
import { resample, ribbonGeometryData } from '../../src/components/Scene/ribbon';

type Pt = [number, number, number];
const path: Pt[] = [[0, 0, 0], [0, 0, -25], [30, 0, -25]];

describe('helmet ground ribbon', () => {
  it('resamples at most every step metres and keeps the corners', () => {
    const p = resample(path, 2);
    for (let i = 1; i < p.length; i++) expect(Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z)).toBeLessThanOrEqual(2 + 1e-9);
    expect(p.some((q) => q.x === 0 && q.z === -25)).toBe(true);
    expect(p[p.length - 1].s).toBeCloseTo(55, 9);
  });
  it('has the same WORLD width everywhere (so it tapers with perspective, unlike a screen-space line)', () => {
    const d = ribbonGeometryData(path, 0.4, 2, 0, () => 0);
    const n = d.position.length / 6;
    for (let i = 0; i < n; i++) {
      const a = [d.position[i * 6], d.position[i * 6 + 2]], b = [d.position[i * 6 + 3], d.position[i * 6 + 5]];
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeCloseTo(0.4, 4);
    }
  });
  it('lies on the ground it is given and carries distance along the walk for the 10 m chevrons', () => {
    const d = ribbonGeometryData(path, 0.4, 2, 100, (x, z) => 0.01 * x - 0.02 * z);
    for (let k = 0; k < d.position.length / 3; k++) expect(d.position[k * 3 + 1]).toBeCloseTo(0.01 * d.position[k * 3] - 0.02 * d.position[k * 3 + 2], 6);
    for (let k = 2; k < d.s.length; k += 2) expect(d.s[k]).toBeGreaterThan(d.s[k - 2]);
    expect(d.s[0]).toBe(100);
    expect(Math.max(...d.t)).toBe(1); expect(Math.min(...d.t)).toBe(-1);
    expect(d.index.length).toBe((d.position.length / 6 - 1) * 6);
  });
});
