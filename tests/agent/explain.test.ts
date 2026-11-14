import { describe, expect, it } from 'vitest';
import { batteryLine, climbLine, explainRoute, explainTool, lightLine } from '@/lib/agent/explain';

describe('explain: formulas with real numbers', () => {
  it('battery = P x t / C', () => {
    expect(batteryLine(250, 295.8, 2000)).toBe('battery = P_suit × t ÷ C = 250 W × 4.93 h ÷ 2,000 Wh = 61.6 %');
    expect(batteryLine(250, undefined, 2000)).toBeNull();
  });
  it('climb work and light time', () => {
    expect(climbLine(180, 359)).toBe('climb work = m × g × ascent = 180 kg × 3.721 m/s² × 359 m = 240 kJ');
    expect(lightLine(1.316, 10.95)).toBe('light time = range ÷ c = 1.316 au × 499.0 s/au = 10.95 min');
  });
  it('route lines use only constraint and total values', () => {
    const e = explainRoute({ lengthM: 4280, ascentM: 40, maxSlopeDeg: 3.5, walkMin: 85, evaMin: 115, batteryUsedPct: 24 }, { suitPowerW: 250, batteryWh: 2000, crewMassKg: 180, dwellMin: 30, batteryReservePct: 20 });
    expect(e.calcs[0]).toContain('250 W × 1.92 h ÷ 2,000 Wh = 24');
    expect(e.calcs.join('\n')).toContain('85 min walking + 30 min at the target = 115 min');
  });
  it('landing scenario summary and criteria rows', () => {
    const s = explainTool('run_landing_scenario', {}, { samples: 10000, seed: 42, okPercent: 98.1, maxSlopeDeg: 15, slopeP50Deg: 2, slopeP95Deg: 6.3, terrainModel: 'x', engine: 'wasm', ellipse: { semiMajorKm: 3.85, semiMinorKm: 3.3, azimuthDeg: 90 } });
    expect(s.calcs[0]).toContain('10,000 samples, seed 42, ok = 9,810 (98.1 %)');
    const c = explainTool('check_landing_site', {}, { verdict: 'fails-some', criteria: [{ label: 'Latitude', value: 70, unit: 'deg', limit: '<= 60', result: 'fail', sourceTitle: 'MSL' }] });
    expect(c.calcs[0]).toBe('Latitude: 70° vs limit <= 60 → FAIL');
  });
  it('an error result explains nothing but the error', () => {
    expect(explainTool('x', {}, { error: 'e', message: 'bad' })).toEqual({ kv: [['error', 'bad']], calcs: [], sources: [] });
  });
});

/* ------------------------------------------------------------------ structured steps (MarsAgent thread) */
import { batteryCalc, commsCalc, routeRows, routeSteps, sunCalc, verdictLine, walkingCalc } from '@/lib/agent/explain';
import { evaluateGoNoGo } from '@/lib/ops/goNoGo';
import { commsAlongRoute } from '@/lib/ops/viewshed';
import { daylightCheck } from '@/lib/ops/lighting';
import { planSynthetic, synDem } from '../ops/fixtures';

// synthetic test fixture: a real planner route on the synthetic ridge DEM, ops checks run on it
const START = Date.UTC(2026, 10, 15, 12, 0, 0);
function opsFor() {
  const route = planSynthetic();
  const c = route.constraintsUsed;
  const comms = commsAlongRoute(synDem, route, { ...route.from, id: 'habitat', heightM: 10 });
  const daylight = daylightCheck(route, START);
  const goNoGo = evaluateGoNoGo({ route, comms, lighting: daylight, constraints: c });
  const tone = goNoGo.overall === 'go' ? 'go' as const : goNoGo.overall === 'caution' ? 'caution' as const : 'nogo' as const;
  return { route, c, ops: { goNoGo, comms, daylight, startUtcMs: START, mastM: 10, verdict: { word: tone === 'go' ? 'GO' : tone === 'caution' ? 'HOLD' : 'NO GO', tone, reason: 'test' } } };
}

describe('explain: route steps with substituted numbers', () => {
  it('battery recomputation prints P, t, C and the pass / fail against the reserve', () => {
    const b = batteryCalc(300, 101, 2000, 20);
    expect(b.lines[0]).toBe('used = P × t ÷ C = 300 W × 1.68 h ÷ 2,000 Wh = 25.3 %');
    expect(b.lines[1]).toBe('left = 100 % - 25.3 % = 74.8 %  (reserve 20 %)  pass');
    expect(batteryCalc(1500, 101, 2000, 20).pass).toBe(false);
  });
  it('walking time uses each leg\'s own grade and the real per-leg times', () => {
    const { route, c } = opsFor();
    const w = walkingCalc(route, c);
    expect(w[0]).toContain('v(θ) = f × 6 km/h');
    expect(w.some((l) => l.startsWith('outbound: tan θ ='))).toBe(true);
    const sum = route.legs.reduce((a, l) => a + Math.round(l.timeMin), 0);
    expect(w.at(-1)).toContain(`${c.dwellMin} min`);
    expect(sum).toBeGreaterThan(0);
  });
  it('route steps: solver, calculations, verdict; every step has a title and the verdict names each check', () => {
    const { route, c, ops } = opsFor();
    const steps = routeSteps(route, ops, c, route.from, { rangeAu: 1.316, minutes: 10.95 });
    expect(steps[0].kind).toBe('tool');
    expect(steps[0].code?.join('\n')).toContain(`A* on a ${route.gridResM} m grid`);
    expect(steps.map((s) => s.title)).toEqual(expect.arrayContaining(['Walking time', 'Suit battery', 'Comms line of sight from base', 'Sun along the route', 'Earth link delay']));
    const v = steps.at(-1)!;
    expect(v.kind).toBe('verdict');
    expect(v.text).toBe(verdictLine(ops.goNoGo));
    expect(v.text).toMatch(/slope (pass|caution|fail), battery/);
  });
  it('comms and sun lines carry real values (curvature drop, Mars24 MSD and Ls)', () => {
    const { route, ops } = opsFor();
    const cl = commsCalc(route, ops.comms, route.from, 10);
    expect(cl[0]).toContain('mast 10 m (assumption)');
    expect(cl[1]).toMatch(/curvature drop = d² ÷ 2R = \([\d,]+ m\)² ÷ \(2 × 3,396,190 m\) = [\d.]+ m/);
    const sl = sunCalc(route, ops);
    expect(sl[0]).toMatch(/^Mars24: MSD [\d,]+(\.\d)?, Ls [\d.]+°, LTST \d\d:\d\d at the start$/);
  });
  it('card rows: six rows, each with a status tone', () => {
    const { route, c, ops } = opsFor();
    const rows = routeRows(route, ops, c);
    expect(rows).toHaveLength(6);
    expect(rows[0].label).toBe('Round trip');
    expect(rows.every((r) => r.tone)).toBe(true);
  });
});
