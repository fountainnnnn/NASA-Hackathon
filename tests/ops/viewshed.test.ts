import { describe, expect, it } from 'vitest';
import { R_MARS } from '@/lib/contracts';
import { buildTimeline } from '@/lib/ops/timeline';
import { commsAlongRoute, horizonDistanceM, lineOfSight, pairVisibility, viewshedGrid } from '@/lib/ops/viewshed';
import { STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M } from '@/lib/ops/assumptions';
import { makeSmoothDem } from '../fixtures/synthetic';
import { handRoute, LAT_C, LON_C, makeFeatureDem, offset } from './fixtures';

// synthetic test fixture — NOT NASA data
const C = { lon: LON_C, lat: LAT_C };
const flat = makeFeatureDem(600, () => -2500); // 12 km × 12 km flat plain
const flatBig = makeFeatureDem(1000, () => -2500); // 20 km × 20 km (two-height horizon ≈ 7.2 km needs > 6 km of DEM)

describe('line of sight on flat ground (synthetic test fixture) vs the horizon formula', () => {
  it('horizonDistanceM = √(2Rh)', () => {
    expect(horizonDistanceM(2)).toBeCloseTo(Math.sqrt(2 * R_MARS * 2), 9);
    expect(horizonDistanceM(2)).toBeCloseTo(3686, -1);
  });
  it('observer h=2 m sees a ground target (h=0) out to √(2Rh) and not beyond', () => {
    const D = Math.sqrt(2 * R_MARS * 2);
    expect(lineOfSight(flat, C, offset(0.97 * D, 0), 2, 0).visible).toBe(true);
    const far = lineOfSight(flat, C, offset(1.03 * D, 0), 2, 0);
    expect(far.visible).toBe(false);
    expect(far.reason).toBe('terrain');
    expect(far.blockedAtM!).toBeGreaterThan(0.5 * D);
  });
  it('two heights: limit = √(2R·ha) + √(2R·hb) (mast 2 m, suit 1.8 m)', () => {
    const D = Math.sqrt(2 * R_MARS * STATION_MAST_HEIGHT_M) + Math.sqrt(2 * R_MARS * SUIT_ANTENNA_HEIGHT_M);
    for (const bearing of [0, 90, 200]) {
      const at = (f: number) => offset(f * D * Math.sin((bearing * Math.PI) / 180), f * D * Math.cos((bearing * Math.PI) / 180));
      expect(lineOfSight(flatBig, C, at(0.97), STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M).visible).toBe(true);
      expect(lineOfSight(flatBig, C, at(1.03), STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M).visible).toBe(false);
    }
  });
  it('curvature effect: 0.5 m + 0.5 m antennas at 5 km are hidden by curvature alone; a 100 m target is not', () => {
    // a flat-plane model would call both visible (no obstruction exists on the plain)
    expect(lineOfSight(flat, C, offset(5000, 0), 0.5, 0.5).visible).toBe(false);
    expect(lineOfSight(flat, C, offset(5000, 0), 0.5, 100).visible).toBe(true);
    // the sag of the chord at mid path is d(D-d)/2R = 5000²/(8R) ≈ 0.92 m — the clearance at 1 m eye heights reflects it
    const r = lineOfSight(flat, C, offset(3000, 0), 1, 1);
    expect(r.minClearanceM).toBeCloseTo(1 - 3000 * 3000 / (8 * R_MARS), 1);
  });
  it('zero distance is trivially visible; target off the DEM is not', () => {
    expect(lineOfSight(flat, C, C, 2, 2).visible).toBe(true);
    expect(lineOfSight(flat, C, offset(20000, 0), 2, 2)).toMatchObject({ visible: false, reason: 'nodata-endpoint' });
  });
});

describe('line of sight over terrain (synthetic ridge / spike)', () => {
  // E–W wall 30 m high (σ = 2 cells = 40 m) centred 400 m north of the DEM centre
  const ridge = makeFeatureDem(300, (_x, y) => -2500 + 30 * Math.exp(-(((y - 400) / 40) ** 2) / 2));
  it('blocked behind the ridge, clear in front of it, clear when the target stands above the crest', () => {
    const behind = lineOfSight(ridge, C, offset(0, 800), 2, 1.8);
    expect(behind.visible).toBe(false);
    // first sample where the Gaussian flank (30 m, σ 40 m, crest at 400 m) rises above the ~1 m ray: ≈ 310 m
    expect(behind.blockedAtM!).toBeGreaterThan(250);
    expect(behind.blockedAtM!).toBeLessThan(400);
    expect(behind.minClearanceM!).toBeLessThan(0);
    expect(lineOfSight(ridge, C, offset(0, 300), 2, 1.8).visible).toBe(true);
    expect(lineOfSight(ridge, C, offset(300, 0), 2, 1.8).visible).toBe(true); // along the foot, no ridge between
    expect(lineOfSight(ridge, C, offset(0, 800), 2, 120).visible).toBe(true);
  });
  it('a one-pixel spike on the ray is caught (samples every half cell with bilinear heights)', () => {
    // spike pixel centre exactly 200 m east of the centre, +60 m tall
    const spike = makeFeatureDem(200, (x, y) => (Math.abs(x - 210) < 1 && Math.abs(y - 10) < 1 ? -2440 : -2500));
    const a = offset(0, 10), b = offset(400, 10);
    expect(lineOfSight(spike, a, b, 2, 1.8).visible).toBe(false);
  });
  it('nodata between endpoints blocks (conservative); nodata endpoint is reported', () => {
    const hole = makeFeatureDem(200, (x, y) => (Math.abs(x - 200) < 30 && Math.abs(y) < 30 ? NaN : -2500));
    expect(lineOfSight(hole, offset(0, 0), offset(400, 0), 2, 1.8)).toMatchObject({ visible: false, reason: 'nodata-ray' });
    expect(lineOfSight(hole, offset(0, 0), offset(200, 0), 2, 1.8)).toMatchObject({ visible: false, reason: 'nodata-endpoint' });
  });
});

describe('commsAlongRoute: shadow stretches behind a bump', () => {
  // 25 m high Gaussian bump (σ = 40 m) 400 m east of the station; route walks an 800 m-radius arc around the station
  const bump = makeFeatureDem(300, (x, y) => -2500 + 25 * Math.exp(-(((x - 400) ** 2 + y * y) / (2 * 40 * 40))));
  const arc = Array.from({ length: 60 }, (_, i) => {
    const az = ((-40 + (80 * i) / 59) * Math.PI) / 180; // -40° … +40° about east
    return offset(800 * Math.cos(az), 800 * Math.sin(az));
  });
  const route = handRoute([arc]);
  const res = commsAlongRoute(bump, route, C);

  it('records exactly one shadow stretch centred on the bump azimuth, visible at both ends', () => {
    expect(res.visible.length).toBe(arc.length);
    expect(res.visible[0]).toBe(true);
    expect(res.visible[arc.length - 1]).toBe(true);
    expect(res.shadows).toHaveLength(1);
    const sh = res.shadows[0];
    const mid = Math.round((arc.length - 1) / 2);
    expect(sh.startIdx).toBeLessThanOrEqual(mid);
    expect(sh.endIdx).toBeGreaterThanOrEqual(mid);
    // analytic estimate: the bump shades ±w where 25·exp(-w²/2σ²) = ray height ≈ 1.9 m at its distance
    // → w ≈ 91 m at 400 m → ±182 m at 800 m → ≈ 365 m of arc
    expect(sh.maxLengthM).toBeGreaterThan(sh.lengthM);
    expect(sh.lengthM).toBeGreaterThan(300);
    expect(sh.maxLengthM).toBeLessThan(430);
    expect(res.longestShadowM).toBe(sh.lengthM);
  });
  it('flags equal a direct lineOfSight call per vertex; stretch times come from the timeline', () => {
    const tl = buildTimeline(route);
    for (const i of [0, 10, 20, 29, 30, 40, 59]) {
      expect(res.visible[i]).toBe(lineOfSight(bump, C, tl.samples[i], STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M).visible);
    }
    const sh = res.shadows[0];
    expect(sh.startMin).toBeCloseTo(tl.samples[sh.startIdx].tMin, 9);
    expect(sh.endMin).toBeGreaterThan(sh.startMin);
    expect(res.visibleFraction).toBeCloseTo(1 - (sh.endIdx - sh.startIdx + 1) / arc.length, 9);
  });
  it('flat ground within the horizon: no shadows, fraction 1', () => {
    const r = commsAlongRoute(flat, handRoute([[offset(100, 0), offset(1000, 0), offset(2000, 500)]]), C);
    expect(r.shadows).toHaveLength(0);
    expect(r.visibleFraction).toBe(1);
    expect(r.longestShadowM).toBe(0);
  });
  it('flat ground beyond the mast/suit horizon: one trailing shadow', () => {
    const r = commsAlongRoute(flat, handRoute([line2([0, 0], [6000, 0])]), C);
    expect(r.shadows).toHaveLength(1);
    expect(r.shadows[0].endIdx).toBe(r.visible.length - 1);
    expect(r.shadows[0].startIdx).toBeGreaterThan(0);
  });
});

function line2(a: [number, number], b: [number, number]) {
  const n = 60;
  return Array.from({ length: n + 1 }, (_, i) => offset(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n));
}

describe('pairVisibility', () => {
  const ridge = makeFeatureDem(300, (_x, y) => -2500 + 30 * Math.exp(-(((y - 400) / 40) ** 2) / 2));
  const stay = (e: number, n: number) => buildTimeline(handRoute([[offset(e, n), offset(e + 1, n)]]));
  it('two suits on the same side see each other; across the ridge they do not; flat ground within range does', () => {
    const near = pairVisibility(ridge, stay(0, 0), stay(200, 0), 0);
    expect(near.visible).toBe(true);
    const across = pairVisibility(ridge, stay(0, 0), stay(0, 800), 0);
    expect(across.visible).toBe(false);
    expect(across.a.lat).toBeLessThan(across.b.lat);
    expect(pairVisibility(flat, stay(0, 0), stay(0, 3000), 0).visible).toBe(true);
  });
  it('uses positions at time t (one party walks behind the ridge)', () => {
    const walker = buildTimeline(handRoute([line2([0, 100], [0, 800])]));
    const total = walker.samples[walker.samples.length - 1].tMin;
    const fixed = stay(0, 0);
    expect(pairVisibility(ridge, fixed, walker, 0).visible).toBe(true);
    expect(pairVisibility(ridge, fixed, walker, total).visible).toBe(false);
    expect(pairVisibility(ridge, fixed, walker, total / 2).a).toBeDefined();
  });
});

describe('viewshedGrid', () => {
  it('flat ground: cutoff at the mast+target horizon; inside all visible, beyond all hidden', () => {
    const hs = 0.5, ht = 0.5, step = 40;
    const vs = viewshedGrid(flat, C, 5000, step, { stationHeightM: hs, targetHeightM: ht });
    const lim = horizonDistanceM(hs) + horizonDistanceM(ht); // ≈ 3686 m
    const n = (vs.width - 1) / 2;
    let badIn = 0, badOut = 0, inside = 0, outside = 0;
    for (let j = 0; j < vs.width; j++) for (let i = 0; i < vs.width; i++) {
      const d = Math.hypot((i - n) * step, (n - j) * step);
      const v = vs.mask[j * vs.width + i];
      if (d > 5000) { expect(v).toBe(0); continue; }
      if (d < 0.97 * lim) { inside++; if (v !== 1) badIn++; } else if (d > 1.03 * lim) { outside++; if (v !== 2) badOut++; }
    }
    expect(inside).toBeGreaterThan(1000); expect(outside).toBeGreaterThan(1000);
    expect(badIn).toBe(0);
    expect(badOut).toBe(0);
    expect(vs.visibleCount + vs.hiddenCount).toBeGreaterThan(inside + outside);
  });
  it('ridge: cells behind the wall are hidden, cells in front visible; agrees with lineOfSight', () => {
    const ridge = makeFeatureDem(300, (_x, y) => -2500 + 30 * Math.exp(-(((y - 400) / 40) ** 2) / 2));
    const vs = viewshedGrid(ridge, C, 1500, 40);
    const n = (vs.width - 1) / 2;
    const at = (x: number, y: number) => vs.mask[(n - Math.round(y / 40)) * vs.width + (n + Math.round(x / 40))];
    expect(at(0, 200)).toBe(1);
    expect(at(0, 800)).toBe(2);
    expect(at(0, 1000)).toBe(2);
    expect(at(-600, -300)).toBe(1);
    let agree = 0, total = 0;
    for (let j = 0; j < vs.width; j += 3) for (let i = 0; i < vs.width; i += 3) {
      const v = vs.mask[j * vs.width + i];
      if (v === 0) continue;
      const los = lineOfSight(ridge, C, offset((i - n) * 40, (n - j) * 40), STATION_MAST_HEIGHT_M, SUIT_ANTENNA_HEIGHT_M).visible;
      total++; if (los === (v === 1)) agree++;
    }
    expect(total).toBeGreaterThan(400);
    expect(agree / total).toBeGreaterThan(0.98);
  });
  it('performance: 5 km radius at 40 m step runs in < 1.5 s', () => {
    const dem = makeSmoothDem(1000); // 20 km × 20 km undulating synthetic terrain
    const station = { lon: 77.4, lat: 18.4 };
    viewshedGrid(dem, station, 1000, 40); // warm-up
    const t0 = performance.now();
    const vs = viewshedGrid(dem, station, 5000, 40);
    const ms = performance.now() - t0;
    console.log(`viewshedGrid 5 km @ 40 m: ${ms.toFixed(0)} ms, ${vs.width}x${vs.height}, visible ${vs.visibleCount}, hidden ${vs.hiddenCount}`);
    expect(vs.width).toBe(251);
    expect(ms).toBeLessThan(1500);
    expect(vs.visibleCount).toBeGreaterThan(0);
    expect(vs.hiddenCount).toBeGreaterThan(0);
  });
});
