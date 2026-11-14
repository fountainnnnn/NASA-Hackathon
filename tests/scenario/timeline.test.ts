import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import {
  batteryLeftAt, batteryUsedAt, buildTimeline, nextStop, sampleAtOdometer, sampleAtTime, slopeAhead, ROVER_SPEED_KMH,
} from '@/components/Scenario/model';
import { rulerTicks } from '@/components/Scenario/ruler';
import { SYN_CONSTRAINTS, buildSyntheticRoute, synGround, synLocal } from '@/components/Scenario/synthetic';

const ground = synGround();
const route = buildSyntheticRoute();
const tl = buildTimeline(route, ground);

describe('timeline from the route own model', () => {
  it('the synthetic route is feasible with the preview constraints', () => {
    expect(route.feasible).toBe(true);
  });

  it('total duration = sum of leg times + one dwell per outbound leg', () => {
    const expected = (route.legs.reduce((s, l) => s + l.timeMin, 0) + SYN_CONSTRAINTS.dwellMin * 1) * 60;
    expect(tl.durationS).toBeCloseTo(expected, 3);
    expect(tl.summary.evaMin).toBeCloseTo(route.totals.evaMin, 6);
    expect(tl.summary.batteryUsedPct).toBeCloseTo(route.totals.batteryUsedPct, 6);
  });

  it('distance travelled equals the sum of leg lengths', () => {
    expect(tl.distM).toBeCloseTo(route.legs.reduce((s, l) => s + l.lengthM, 0), 3);
  });

  it('position at the cumulative time of the first k segments is path vertex k', () => {
    const leg = route.legs[0];
    let t = 0;
    const segs = tl.segs.filter((s) => s.leg === 0 && s.kind === 'walk');
    for (let k = 0; k < 25; k++) {
      t = segs[k].t1;
      const p = sampleAtTime(tl, t)!;
      const v = synLocal(leg.path[k + 1].lon, leg.path[k + 1].lat);
      expect(Math.hypot(p.x - v.x, p.z - v.z)).toBeLessThan(1e-6);
      expect(p.h).toBeCloseTo(leg.path[k + 1].h, 6);
    }
  });

  it('the first leg takes exactly leg.timeMin before the dwell', () => {
    const lastWalk = tl.segs.filter((s) => s.leg === 0 && s.kind === 'walk').pop()!;
    expect(lastWalk.t1).toBeCloseTo(route.legs[0].timeMin * 60, 3);
    const dwell = tl.segs.find((s) => s.kind === 'dwell')!;
    expect(dwell.t1 - dwell.t0).toBeCloseTo(SYN_CONSTRAINTS.dwellMin * 60, 6);
  });

  it('interpolates inside a segment and holds position during the dwell', () => {
    const s0 = tl.segs[0];
    const mid = sampleAtTime(tl, (s0.t0 + s0.t1) / 2)!;
    expect(mid.x).toBeCloseTo((s0.a.x + s0.b.x) / 2, 6);
    const dw = tl.segs.find((s) => s.kind === 'dwell')!;
    const a = sampleAtTime(tl, dw.t0 + 1)!, b = sampleAtTime(tl, dw.t1 - 1)!;
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.speedMps).toBe(0);
  });

  it('clamps before the start and after the end', () => {
    const a = sampleAtTime(tl, -50)!, b = sampleAtTime(tl, tl.durationS + 500)!;
    const start = tl.segs[0].a, end = tl.segs[tl.segs.length - 1].b;
    expect(a.x).toBeCloseTo(start.x, 9);
    expect(b.x).toBeCloseTo(end.x, 9);
  });

  it('odometer sampling matches time sampling for the lead', () => {
    const p = sampleAtTime(tl, 1500)!;
    const q = sampleAtOdometer(tl, p.odometerM)!;
    expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1e-6);
  });

  it('slope ahead reports the route segSlopeDeg values', () => {
    const s = slopeAhead(tl, 0, 100);
    expect(s.lengthM).toBeGreaterThan(90);
    expect(s.maxDeg).toBeLessThanOrEqual(route.legs[0].maxSlopeDeg + 1e-9);
  });

  it('next stop is the target with a positive distance', () => {
    const n = nextStop(tl, 10)!;
    expect(n.marker.label).toBe('Target');
    expect(n.distM).toBeGreaterThan(1000);
  });
});

describe('battery', () => {
  const c = DEFAULT_CONSTRAINTS;
  it('matches suitPowerW * t / batteryWh', () => {
    expect(batteryUsedAt(3600, c)).toBeCloseTo((250 * 1) / 2000 * 100, 9);
    expect(batteryLeftAt(3600, c)).toBeCloseTo(100 - 12.5, 9);
  });
  it('caps at 100 and floors at 0', () => {
    expect(batteryUsedAt(1e9, c)).toBe(100);
    expect(batteryUsedAt(-5, c)).toBe(0);
  });
  it('the whole route consumes what the planner says', () => {
    expect(batteryUsedAt(tl.durationS, route.constraintsUsed)).toBeCloseTo(route.totals.batteryUsedPct, 6);
  });
});

describe('turn back when the reserve would be hit', () => {
  const tight = buildSyntheticRoute({ ...SYN_CONSTRAINTS, batteryWh: 100 });
  const tlt = buildTimeline(tight, ground);

  it('the route is infeasible by battery and has a turn-back index', () => {
    expect(tight.feasible).toBe(false);
    expect(tight.reasons).toContain('battery_reserve');
    expect(tight.turnBackIndex).toBeTruthy();
  });

  it('turn-back happens at the planner vertex and at the reserve limit', () => {
    const tb = tight.turnBackIndex!;
    const v = tight.legs[tb.leg].path[tb.vertex];
    const l = synLocal(v.lon, v.lat);
    expect(tlt.turnBack).not.toBeNull();
    expect(Math.hypot(tlt.turnBack!.v.x - l.x, tlt.turnBack!.v.z - l.z)).toBeLessThan(1e-6);
    const limit = 100 - tight.constraintsUsed.batteryReservePct;
    expect(tlt.turnBack!.batteryPct).toBeGreaterThan(limit);
    expect(tlt.turnBack!.batteryPct).toBeLessThanOrEqual(limit + 5);
  });

  it('after the turn-back the crew retraces the path back to the start', () => {
    const at = sampleAtTime(tlt, tlt.turnBack!.tS)!;
    const later = sampleAtTime(tlt, tlt.turnBack!.tS + 60)!;
    // moving back toward the start: distance to the start shrinks
    const s = tlt.segs[0].a;
    expect(Math.hypot(later.x - s.x, later.z - s.z)).toBeLessThan(Math.hypot(at.x - s.x, at.z - s.z));
    expect(sampleAtTime(tlt, tlt.durationS)!.x).toBeCloseTo(s.x, 6);
    expect(tlt.segs.some((x) => x.reversed)).toBe(true);
    expect(tlt.markers.some((m) => m.kind === 'turn-back')).toBe(true);
    expect(tlt.summary.turnedBack).toBe(true);
  });

  it('if the reserve line is crossed on the way home the crew keeps walking home and the line is marked', () => {
    const late = buildSyntheticRoute({ ...SYN_CONSTRAINTS, batteryWh: 450 });
    const tll = buildTimeline(late, ground);
    expect(late.turnBackIndex!.leg).toBe(1);
    expect(tll.turnBack).not.toBeNull();
    expect(tll.summary.turnedBack).toBe(false);
    expect(tll.segs.some((x) => x.reversed)).toBe(false);
    expect(tll.durationS).toBeCloseTo((late.legs.reduce((q, l) => q + l.timeMin, 0) + late.constraintsUsed.dwellMin) * 60, 3);
  });

  it('a feasible route has no turn-back marker', () => {
    expect(tl.turnBack).toBeNull();
    expect(tl.markers.some((m) => m.kind === 'turn-back')).toBe(false);
  });
});

describe('rover assist', () => {
  const rv = buildTimeline(route, ground, { roverFraction: 0.5 });
  it('shortens the trip and records the drop off', () => {
    expect(rv.roverEndS).toBeGreaterThan(0);
    expect(rv.durationS).toBeLessThan(tl.durationS);
    expect(rv.roverDropoff).not.toBeNull();
  });
  it('carries about the requested share of the outbound distance at the assumed speed', () => {
    const out = tl.segs.filter((s) => s.leg === 0 && s.kind !== 'dwell').reduce((q, s) => q + (s.d1 - s.d0), 0);
    expect(rv.summary.roverDistM).toBeGreaterThan(0.45 * out);
    expect(rv.summary.roverDistM).toBeLessThanOrEqual(0.5 * out + 1e-6);
    expect(rv.summary.roverMin * 60).toBeCloseTo(rv.summary.roverDistM / ((ROVER_SPEED_KMH * 1000) / 3600), 3);
  });
  it('leaves the RouteResult untouched and reports the walk-only comparison', () => {
    expect(rv.summary.walkOnlyEvaMin).toBeCloseTo(route.totals.evaMin, 9);
    expect(rv.summary.batteryUsedPct).toBeLessThan(rv.summary.walkOnlyBatteryPct);
  });
  it('zero fraction means no rover', () => {
    expect(buildTimeline(route, ground, { roverFraction: 0 }).roverEndS).toBe(0);
  });
});

describe('route ruler', () => {
  it('ticks every 100 m and every 10 minutes of moving time', () => {
    const ticks = rulerTicks(tl);
    const d = ticks.filter((t) => t.kind === 'distance');
    const m = ticks.filter((t) => t.kind === 'time');
    expect(d[0].odometerM).toBe(100);
    expect(d[1].odometerM).toBe(200);
    expect(m.map((t) => t.label).slice(0, 2)).toEqual(['10 min', '20 min']);
    const movingMin = route.legs.reduce((q, l) => q + l.timeMin, 0);
    expect(m.length).toBe(Math.floor(movingMin / 10 + 1e-9));
  });
});
