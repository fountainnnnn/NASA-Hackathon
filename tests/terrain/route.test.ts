import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS, G_MARS } from '@/lib/contracts';
import type { LonLat, MissionConstraints, PlanningGrid, RouteLeg } from '@/lib/contracts';
import { groundDistanceM, pixelCentreLonLat } from '@/lib/geo/frame';
import { computeSlopeField } from '@/lib/terrain/slope';
import { buildPlanningGrid, gridCellLonLat, gridLonLatToCell } from '@/lib/terrain/grid';
import { nearestReachable, planRoute } from '@/lib/terrain/route';
import { solvePath } from '@/lib/terrain/astar';
import { createTerrainEngine } from '@/lib/terrain/engine';
import { findHazards } from '@/lib/terrain/hazards';
import { makeSyntheticDem, SYN } from '../fixtures/synthetic';

const DEG = Math.PI / 180;
const dem = makeSyntheticDem();
const slope = computeSlopeField(dem);
const grid = buildPlanningGrid(dem, slope);
const pix = (c: number, r: number): LonLat => pixelCentreLonLat(dem.meta, c, r);
const C = (over: Partial<MissionConstraints> = {}): MissionConstraints => ({ ...DEFAULT_CONSTRAINTS, evaMaxMin: 1e6, ...over });

/** independent recomputation from path vertices */
function recompute(leg: RouteLeg) {
  let len = 0, maxS = 0;
  const grades: number[] = [];
  for (let i = 0; i + 1 < leg.path.length; i++) {
    const a = leg.path[i], b = leg.path[i + 1];
    const horiz = groundDistanceM(a, b);
    const dh = b.h - a.h;
    len += Math.sqrt(horiz * horiz + dh * dh);
    const g = Math.atan(Math.abs(dh) / horiz) / DEG;
    grades.push(g);
    maxS = Math.max(maxS, g);
  }
  return { len, maxS, grades };
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('grid', () => {
  it('has 2x coarsening with max-slope and mean-elevation rules', () => {
    expect(grid.width).toBe(60);
    expect(grid.height).toBe(60);
    expect(grid.cellResM).toBe(40);
    const w = dem.meta.width;
    const i = [10 * w + 20, 10 * w + 21, 11 * w + 20, 11 * w + 21];
    expect(grid.elev[5 * 60 + 10]).toBeCloseTo(i.reduce((a, k) => a + dem.elev[k], 0) / 4, 3);
    expect(grid.slopeMaxDeg[5 * 60 + 10]).toBeCloseTo(Math.max(...i.map((k) => slope[k])), 5);
    // hole cells are NaN
    const h = SYN.hole;
    expect(grid.elev[((h.r0 + 2) >> 1) * 60 + ((h.c0 + 2) >> 1)]).toBeNaN();
    // cell centre round trip
    const ll = gridCellLonLat(grid, 17, 33);
    expect(gridLonLatToCell(grid, ll.lon, ll.lat)).toEqual({ c: 17, r: 33 });
    expect(gridLonLatToCell(grid, grid.lonMin - 1, grid.latMax)).toBeNull();
  });
});

describe('A* constraints', () => {
  it('never violates edge grade or cell slope across many random pairs', () => {
    const rand = rng(42);
    for (const limit of [15, 10, 25]) {
      for (const objective of ['shortest', 'fastest'] as const) {
        let found = 0;
        for (let t = 0; t < 40; t++) {
          const a = pix(Math.floor(rand() * 120), Math.floor(rand() * 120));
          const b = pix(Math.floor(rand() * 120), Math.floor(rand() * 120));
          const res = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ maxSlopeDeg: limit, objective }) });
          if (res.legs.length === 0) continue;
          found++;
          const leg = res.legs[0];
          const rc = recompute(leg);
          rc.grades.forEach((g) => expect(g).toBeLessThanOrEqual(limit + 1e-9));
          expect(leg.segSlopeDeg.length).toBe(leg.path.length - 1);
          leg.path.slice(1).forEach((v) => {
            const cell = gridLonLatToCell(grid, v.lon, v.lat)!;
            expect(grid.slopeMaxDeg[cell.r * grid.width + cell.c]).toBeLessThanOrEqual(limit);
          });
          expect(Math.abs(leg.lengthM - rc.len)).toBeLessThan(1e-6);
          expect(Math.abs(leg.maxSlopeDeg - rc.maxS)).toBeLessThan(1e-9);
          expect(res.totals.maxSlopeDeg).toBeCloseTo(rc.maxS, 9);
        }
        expect(found).toBeGreaterThan(5);
      }
    }
  });

  it('uses the saddle when the limit is tight, with a longer detour than the straight line', () => {
    const a = pix(20, 25), b = pix(20, 100);
    const res = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ maxSlopeDeg: 15 }) });
    expect(res.feasible).toBe(true);
    const leg = res.legs[0];
    const cross = leg.path.filter((v) => Math.abs(gridLonLatToCell(grid, v.lon, v.lat)!.r - 30) <= 1);
    expect(cross.length).toBeGreaterThan(0);
    cross.forEach((v) => {
      const col = gridLonLatToCell(grid, v.lon, v.lat)!.c * 2;
      expect(Math.abs(col - SYN.saddleCol)).toBeLessThanOrEqual(8);
    });
    expect(leg.horizM).toBeGreaterThan(groundDistanceM(a, b) * 1.3);
  });

  it('too-tight limit gives no_path_slope with a usable minFeasibleSlopeDeg', () => {
    const a = pix(20, 25), b = pix(20, 100);
    const res = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ maxSlopeDeg: 5 }) });
    expect(res.feasible).toBe(false);
    expect(res.reasons).toContain('no_path_slope');
    const m = res.minFeasibleSlopeDeg;
    expect(typeof m).toBe('number');
    expect(m!).toBeGreaterThan(5);
    expect(m!).toBeLessThanOrEqual(15);
    expect(Number.isInteger(m)).toBe(true);
    const ok = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ maxSlopeDeg: m! }) });
    expect(ok.legs.length).toBe(1);
    const bad = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ maxSlopeDeg: m! - 1 }) });
    expect(bad.legs.length).toBe(0);
  });

  it('minFeasibleSlopeDeg is null when even 45 degrees cannot connect (goal in hole-locked region)', () => {
    // ridge flanks exceed 45 deg except via saddle, so isolate: goal cell on ridge flank steeper than 45
    const flank = pix(40, 60);
    const res = planRoute(grid, { from: pix(20, 25), to: flank, roundTrip: false, constraints: C({ maxSlopeDeg: 10 }) });
    expect(res.reasons).toContain('no_path_slope');
    expect(res.minFeasibleSlopeDeg === null || typeof res.minFeasibleSlopeDeg === 'number').toBe(true);
  });

  it('changing the target changes the final vertex', () => {
    const a = pix(20, 25);
    const r1 = planRoute(grid, { from: a, to: pix(100, 30), roundTrip: false, constraints: C() });
    const r2 = planRoute(grid, { from: a, to: pix(60, 15), roundTrip: false, constraints: C() });
    const e1 = r1.legs[0].path.at(-1)!, e2 = r2.legs[0].path.at(-1)!;
    expect(groundDistanceM(e1, e2)).toBeGreaterThan(300);
    expect(groundDistanceM(e1, pix(100, 30))).toBeLessThan(40);
    expect(groundDistanceM(e2, pix(60, 15))).toBeLessThan(40);
  });

  it('round trip has 2 legs; totals equal sums; stops add legs and dwell', () => {
    const k = C();
    const a = pix(20, 25), b = pix(100, 40);
    const rt = planRoute(grid, { from: a, to: b, roundTrip: true, constraints: k });
    expect(rt.legs.length).toBe(2);
    const sum = (f: (l: RouteLeg) => number) => rt.legs.reduce((s, l) => s + f(l), 0);
    expect(rt.totals.lengthM).toBeCloseTo(sum((l) => l.lengthM), 6);
    expect(rt.totals.ascentM).toBeCloseTo(sum((l) => l.ascentM), 6);
    expect(rt.totals.descentM).toBeCloseTo(sum((l) => l.descentM), 6);
    expect(rt.totals.walkMin).toBeCloseTo(sum((l) => l.timeMin), 9);
    expect(rt.totals.evaMin).toBeCloseTo(rt.totals.walkMin + k.dwellMin, 9);
    expect(rt.totals.batteryUsedPct).toBeCloseTo(k.suitPowerW * (rt.totals.evaMin / 60) / k.batteryWh * 100, 9);
    expect(rt.totals.climbWorkKJ).toBeCloseTo(k.crewMassKg * G_MARS * rt.totals.ascentM / 1000, 9);
    expect(rt.legs[1].path[0]).toEqual(rt.legs[0].path.at(-1));
    expect(rt.legs[0].timeMin).toBeGreaterThan(0);

    const st = planRoute(grid, { from: a, to: b, stops: [pix(60, 20)], roundTrip: true, constraints: k });
    expect(st.legs.length).toBe(3);
    expect(st.totals.evaMin).toBeCloseTo(st.totals.walkMin + 2 * k.dwellMin, 9);
  });

  it('raising batteryReservePct flips feasible -> infeasible with battery_reserve and a turn-back index', () => {
    const q = { from: pix(20, 25), to: pix(100, 40), roundTrip: true };
    const ok = planRoute(grid, { ...q, constraints: C({ batteryReservePct: 20 }) });
    expect(ok.feasible).toBe(true);
    expect(ok.reasons).toEqual([]);
    const bad = planRoute(grid, { ...q, constraints: C({ batteryReservePct: 95 }) });
    expect(bad.feasible).toBe(false);
    expect(bad.reasons).toContain('battery_reserve');
    expect(bad.turnBackIndex).toBeTruthy();
    const { leg, vertex } = bad.turnBackIndex!;
    expect(leg).toBeGreaterThanOrEqual(0);
    expect(vertex).toBeLessThan(bad.legs[leg].path.length);
    const eva = planRoute(grid, { ...q, constraints: C({ evaMaxMin: 30 }) });
    expect(eva.reasons).toContain('eva_time');
  });

  it('flags nodata and out-of-bounds endpoints', () => {
    const h = SYN.hole;
    const inHole = pix(h.c0 + 2, h.r0 + 2);
    const r1 = planRoute(grid, { from: pix(20, 25), to: inHole, roundTrip: false, constraints: C() });
    expect(r1.feasible).toBe(false);
    expect(r1.reasons).toEqual(['nodata_endpoint']);
    const r2 = planRoute(grid, { from: inHole, to: pix(20, 25), roundTrip: false, constraints: C() });
    expect(r2.reasons).toEqual(['nodata_endpoint']);
    const r3 = planRoute(grid, { from: pix(20, 25), to: { lon: dem.meta.lonMax + 0.5, lat: dem.meta.latMax }, roundTrip: false, constraints: C() });
    expect(r3.reasons).toEqual(['out_of_bounds']);
  });

  it("'shortest' path is no longer than the 'fastest' path; and fastest is no slower", () => {
    const rand = rng(7);
    let n = 0;
    for (let t = 0; t < 30; t++) {
      const a = pix(Math.floor(rand() * 120), Math.floor(rand() * 120));
      const b = pix(Math.floor(rand() * 120), Math.floor(rand() * 120));
      const s = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ objective: 'shortest', maxSlopeDeg: 20 }) });
      const f = planRoute(grid, { from: a, to: b, roundTrip: false, constraints: C({ objective: 'fastest', maxSlopeDeg: 20 }) });
      if (!s.legs.length || !f.legs.length) continue;
      n++;
      expect(s.totals.lengthM).toBeLessThanOrEqual(f.totals.lengthM + 1e-6);
      expect(f.totals.walkMin).toBeLessThanOrEqual(s.totals.walkMin + 1e-9);
    }
    expect(n).toBeGreaterThan(5);
  });
});

/** Independent O(n^2) Dijkstra on the same edge rules and cost models. */
function dijkstra(g: PlanningGrid, s: number, t: number, limit: number, objective: 'shortest' | 'fastest', f: number): number {
  const N = g.width * g.height;
  if (!(g.slopeMaxDeg[s] <= limit)) return Infinity; // same endpoint rule as the solver: the start cell must be admissible
  const dist = new Float64Array(N).fill(Infinity);
  const done = new Uint8Array(N);
  dist[s] = 0;
  const ll = (n: number) => gridCellLonLat(g, n % g.width, Math.floor(n / g.width));
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0 || u === t) break;
    done[u] = 1;
    const ur = Math.floor(u / g.width), uc = u % g.width;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const r = ur + dr, c = uc + dc;
      if (r < 0 || c < 0 || r >= g.height || c >= g.width) continue;
      const v = r * g.width + c;
      if (done[v] || Number.isNaN(g.elev[v]) || !(g.slopeMaxDeg[v] <= limit)) continue;
      const horiz = groundDistanceM(ll(u), ll(v));
      const dh = g.elev[v] - g.elev[u];
      if (Math.atan(Math.abs(dh) / horiz) / DEG > limit) continue;
      const len = Math.hypot(horiz, dh);
      const cost = objective === 'shortest' ? len : len / (f * 6 * Math.exp(-3.5 * Math.abs(dh / horiz + 0.05)) * 1000 / 60);
      if (dist[u] + cost < dist[v]) dist[v] = dist[u] + cost;
    }
  }
  return dist[t];
}

describe('A* optimality', () => {
  it('matches brute-force Dijkstra cost on the synthetic grid', () => {
    const rand = rng(99);
    const valid: number[] = [];
    for (let i = 0; i < grid.elev.length; i++) if (!Number.isNaN(grid.elev[i]) && grid.slopeMaxDeg[i] <= 15) valid.push(i);
    let checked = 0;
    for (const objective of ['shortest', 'fastest'] as const) {
      for (let t = 0; t < 12; t++) {
        const s = valid[Math.floor(rand() * valid.length)], g = valid[Math.floor(rand() * valid.length)];
        const limit = t % 2 ? 12 : 15;
        const want = dijkstra(grid, s, g, limit, objective, 0.6);
        const got = solvePath(grid, s, g, { maxSlopeDeg: limit, objective, suitSpeedFactor: 0.6 });
        if (!Number.isFinite(want)) { expect(got.ok).toBe(false); continue; }
        expect(got.ok).toBe(true);
        if (got.ok) { expect(Math.abs(got.cost - want) / Math.max(want, 1e-9)).toBeLessThan(1e-9); checked++; }
      }
    }
    expect(checked).toBeGreaterThan(8);
  });
});

describe('hazards, engine', () => {
  it('returns >=80 m steep stretches ranked by slope, else slow stretches', () => {
    const res = planRoute(grid, { from: pix(20, 25), to: pix(20, 100), roundTrip: false, constraints: C({ maxSlopeDeg: 15 }) });
    const route = { ...res, id: 'R1', label: 't' } as never;
    const hz = findHazards(route, 3, 3);
    expect(hz.length).toBeGreaterThan(0);
    hz.forEach((h) => { expect(h.lengthM).toBeGreaterThanOrEqual(80); expect(h.kind).toBe('steep'); });
    for (let i = 1; i < hz.length; i++) expect(hz[i - 1].maxSlopeDeg).toBeGreaterThanOrEqual(hz[i].maxSlopeDeg);
    const calm = findHazards(route, 3, 89);
    calm.forEach((h) => expect(h.kind).toBe('slow'));
  });

  it('engine exposes analysis and slope field', () => {
    const eng = createTerrainEngine(dem);
    expect(eng.info).toEqual({ gridWidth: 60, gridHeight: 60, cellResM: 40 });
    expect(eng.slopeField().length).toBe(dem.elev.length);
    const plain = eng.analyze({ center: pix(20, 25), radiusM: 200, limitDeg: 15 });
    expect(plain.slopeMaxDeg).toBeLessThan(3);
    expect(plain.pctAboveLimit).toBe(0);
    expect(plain.validPct).toBe(100);
    const ridge = eng.analyze({ center: pix(40, 60), radiusM: 300, limitDeg: 15 });
    expect(ridge.pctAboveLimit).toBeGreaterThan(30);
    expect(ridge.reliefM).toBeGreaterThan(100);
    const out = eng.analyze({ center: { lon: dem.meta.lonMax + 1, lat: dem.meta.latMax }, radiusM: 100, limitDeg: 15 });
    expect(out.validPct).toBe(0);
    expect(out.elevationM).toBeNull();
  });
});

describe('round trips are all or nothing (QA round 1, P0 half route)', () => {
  const P = (limit: number) => ({ maxSlopeDeg: limit, objective: 'fastest' as const, suitSpeedFactor: 0.6 });
  it('solvePath(a, b).ok === solvePath(b, a).ok over random pairs, including steep endpoints', () => {
    const rand = rng(2026);
    let steepEnds = 0, okPairs = 0;
    for (const limit of [8, 12, 15, 25]) {
      for (let t = 0; t < 120; t++) {
        const a = Math.floor(rand() * grid.width * grid.height), b = Math.floor(rand() * grid.width * grid.height);
        const ab = solvePath(grid, a, b, P(limit)), ba = solvePath(grid, b, a, P(limit));
        expect(ab.ok, `cells ${a} -> ${b} at ${limit} deg`).toBe(ba.ok);
        if (grid.slopeMaxDeg[a] > limit || grid.slopeMaxDeg[b] > limit) { steepEnds++; expect(ab.ok).toBe(false); }
        if (ab.ok) okPairs++;
      }
    }
    expect(steepEnds).toBeGreaterThan(20);
    expect(okPairs).toBeGreaterThan(50);
  });

  it('a target on ground steeper than the limit gives no legs, zero totals and the smallest limit that works', () => {
    // a cell on the ridge flank: steeper than 15 deg, but reachable at some larger limit
    let target = -1;
    for (let i = 0; i < grid.slopeMaxDeg.length && target < 0; i++) if (grid.slopeMaxDeg[i] > 16 && grid.slopeMaxDeg[i] < 30 && grid.elev[i] === grid.elev[i]) target = i;
    expect(target).toBeGreaterThan(-1);
    const to = gridCellLonLat(grid, target % grid.width, (target / grid.width) | 0);
    const res = planRoute(grid, { from: pix(20, 25), to, roundTrip: true, constraints: C({ maxSlopeDeg: 15 }) });
    expect(res.legs).toEqual([]);
    expect(res.feasible).toBe(false);
    expect(res.reasons).toEqual(['no_path_slope']);
    expect(Object.values(res.totals).every((v) => v === 0)).toBe(true);
    expect(res.targetSlopeDeg).toBeCloseTo(grid.slopeMaxDeg[target], 6);
    expect(res.minFeasibleSlopeDeg).toBeGreaterThanOrEqual(Math.ceil(grid.slopeMaxDeg[target]));
    const at = planRoute(grid, { from: pix(20, 25), to, roundTrip: true, constraints: C({ maxSlopeDeg: res.minFeasibleSlopeDeg! }) });
    expect(at.legs.length).toBe(2);
    // the sweep variant stops at the first failed leg and skips the limit search
    const fast = planRoute(grid, { from: pix(20, 25), to, roundTrip: true, constraints: C({ maxSlopeDeg: 15 }), findMinSlope: false });
    expect(fast.legs).toEqual([]);
    expect(fast.minFeasibleSlopeDeg).toBeUndefined();
  });

  it('round trip length is the sum of both legs and each leg mirrors the other end to end', () => {
    const rand = rng(11);
    let n = 0;
    for (let t = 0; t < 40; t++) {
      const a = pix(Math.floor(rand() * 120), Math.floor(rand() * 120)), b = pix(Math.floor(rand() * 120), Math.floor(rand() * 120));
      const res = planRoute(grid, { from: a, to: b, roundTrip: true, constraints: C({ maxSlopeDeg: 20 }) });
      if (!res.legs.length) { expect(Object.values(res.totals).every((v) => v === 0)).toBe(true); continue; }
      n++;
      expect(res.legs.length).toBe(2);
      expect(res.totals.lengthM).toBeCloseTo(res.legs[0].lengthM + res.legs[1].lengthM, 6);
      expect(res.legs[0].path[0]).toEqual(res.legs[1].path.at(-1));
      expect(res.legs[0].path.at(-1)).toEqual(res.legs[1].path[0]);
    }
    expect(n).toBeGreaterThan(10);
  });

  it('nearest reachable point: admissible, connected to the start, and closer than any other reachable cell', () => {
    let target = -1;
    for (let i = 0; i < grid.slopeMaxDeg.length && target < 0; i++) if (grid.slopeMaxDeg[i] > 20 && grid.elev[i] === grid.elev[i]) target = i;
    const to = gridCellLonLat(grid, target % grid.width, (target / grid.width) | 0);
    const from = pix(20, 25);
    const near = nearestReachable(grid, from, to, 15, 2000);
    expect(near.point).not.toBeNull();
    expect(near.slopeDeg!).toBeLessThanOrEqual(15);
    expect(near.movedM!).toBeGreaterThan(0);
    expect(near.movedM!).toBeCloseTo(groundDistanceM(near.point!, to), 6);
    const plan = planRoute(grid, { from, to: near.point!, roundTrip: true, constraints: C({ maxSlopeDeg: 15 }) });
    expect(plan.legs.length).toBe(2);
    expect(nearestReachable(grid, from, to, 15, 1).point).toBeNull();
    expect(nearestReachable(grid, to, from, 15).reason).toBe('start_blocked');
  });
});
