import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '@/lib/contracts';
import { evaluateGoNoGo } from '@/lib/ops/goNoGo';
import { commsAlongRoute } from '@/lib/ops/viewshed';
import { daylightCheck } from '@/lib/ops/lighting';
import { buildReport, cellText, type ReportInput } from '@/lib/report/build';
import { routeGeoJson, toJson, toMarkdown } from '@/lib/report/export';
import { planSynthetic, synDem } from '../ops/fixtures';

// synthetic test fixture: a real planner route on the synthetic ridge DEM (not NASA data)
const START = Date.UTC(2026, 10, 15, 12, 0, 0);
function input(withRoute = true): ReportInput {
  const route = withRoute ? planSynthetic() : null;
  let ops: ReportInput['ops'] = null;
  if (route) {
    const comms = commsAlongRoute(synDem, route, { ...route.from, id: 'habitat', heightM: 10 });
    const daylight = daylightCheck(route, START);
    const goNoGo = evaluateGoNoGo({ route, comms, lighting: daylight, constraints: route.constraintsUsed });
    ops = { goNoGo, comms, daylight, startUtcMs: START, mastM: 10, verdict: { word: 'NO GO', tone: 'nogo', reason: 'Radio shadow of 1.1 km.' } };
  }
  return {
    generatedAt: START, route, ops, constraints: route?.constraintsUsed ?? DEFAULT_CONSTRAINTS, base: route ? { ...route.from, elevationM: -2567 } : null,
    earth: { rangeAu: 1.316054, minutes: 10.95 }, landing: null, scenario: null,
    validation: { count: 708, medianResidualM: -1.063, meanResidualM: -0.891, p95AbsResidualM: 6.442 },
    turns: [{ seq: 1, question: 'Plan a round trip', origin: 'drag', engine: 'deterministic', startedAt: START, endedAt: START + 120,
      steps: [{ kind: 'tool', title: 'plan_round_trip', meta: '96 ms', code: ['from a to b'], raw: { args: { a: 1 }, result: { b: 2 } } }], narration: [{ text: 'Planning', tMs: 96 }] }],
  };
}

describe('mission planning report', () => {
  it('has the eight sections in order, from the session state', () => {
    const r = buildReport(input());
    expect(r.sections.map((s) => s.title)).toEqual([
      'Summary and verdict', 'Inputs and constraints', 'Route legs', 'Calculations', 'Go / no-go rules', 'Data sources and validation', 'Assumptions and limits', 'Agent trace',
    ]);
    expect(r.id).toBe('HM-2026-11-15-R1');
    expect(r.verdict?.word).toBe('NO GO');
    const calcs = r.sections[3].calcs!.map((c) => c.title);
    expect(calcs[0]).toMatch(/Walking speed/);
    expect(calcs).toEqual(expect.arrayContaining([expect.stringMatching(/Suit battery/), expect.stringMatching(/Earth link/)]));
    expect(r.sections[5].notes![0]).toContain('708 Perseverance waypoints, median offset 1.1 m');
    expect(r.mocks).toEqual([]);
  });
  it('marks missing values Mock instead of inventing them', () => {
    const r = buildReport({ ...input(false), earth: null });
    expect(r.mocks.length).toBeGreaterThanOrEqual(2);
    const summary = r.sections[0].tables[0].rows.map((row) => row.map(cellText).join(' | '));
    expect(summary.every((l) => /Mock/.test(l))).toBe(true);
    expect(r.sections[3].calcs!.some((c) => c.note === 'Mock')).toBe(true);
  });
  it('Markdown carries every section, the formulas and no em dashes', () => {
    const md = toMarkdown(buildReport(input()));
    for (let n = 1; n <= 8; n++) expect(md).toContain(`## ${n}. `);
    expect(md).toContain('used = P × t ÷ C');
    expect(md).not.toMatch(/—/);
  });
  it('JSON has inputs, tool calls with args and results, formulas and the trace', () => {
    const inp = input();
    const j = JSON.parse(toJson(buildReport(inp), inp));
    expect(j.schema).toBe('heymars.report.v1');
    expect(j.inputs.constraints.maxSlopeDeg).toBe(15);
    expect(j.toolCalls[0]).toMatchObject({ name: 'plan_round_trip', raw: { args: { a: 1 }, result: { b: 2 } } });
    expect(j.formulas.length).toBeGreaterThan(3);
    expect(j.trace[0].narration[0]).toEqual({ text: 'Planning', durationMs: 96 });
  });
  it('GeoJSON: one LineString per leg with per-vertex elevation, plus start and target', () => {
    const inp = input();
    const g = JSON.parse(routeGeoJson(inp.route, inp.ops));
    const legs = g.features.filter((f: { properties: { leg?: string } }) => f.properties.leg);
    expect(legs.length).toBe(inp.route!.legs.length);
    expect(legs[0].geometry.type).toBe('LineString');
    expect(legs[0].geometry.coordinates[0]).toHaveLength(3);
    expect(legs[0].geometry.coordinates.length).toBe(inp.route!.legs[0].path.length);
    expect(g.features.some((f: { properties: { role?: string } }) => f.properties.role === 'target')).toBe(true);
  });
});

describe('report after QA round 1', () => {
  it('a no-path plan reports no legs, no route maths and the smallest limit that works, never a one-leg round trip', () => {
    const base = input();
    const r0 = base.route!;
    const route = { ...r0, legs: [], feasible: false, reasons: ['no_path_slope' as const], minFeasibleSlopeDeg: 25, targetSlopeDeg: 24.03,
      totals: { lengthM: 0, ascentM: 0, descentM: 0, maxSlopeDeg: 0, walkMin: 0, evaMin: 0, batteryUsedPct: 0, climbWorkKJ: 0 } };
    const goNoGo = evaluateGoNoGo({ route, comms: null, lighting: null, constraints: route.constraintsUsed });
    const ops = { ...base.ops!, goNoGo, comms: null, daylight: null, verdict: { word: 'NO GO', tone: 'nogo' as const, reason: 'No path stays under 15°; 25° would work.' } };
    const r = buildReport({ ...base, route, ops });
    const all = JSON.stringify(r);
    expect(r.verdict?.word).toBe('NO GO');
    expect(r.mocks).toEqual([]);
    const summary = r.sections[0].tables[0].rows.map((row) => row.map(cellText).join(' | '));
    expect(summary.some((l) => /Target slope.*\| 24° \| <= 15° \| fail/.test(l))).toBe(true);
    expect(summary.some((l) => /Smallest slope limit with a path \| 25°/.test(l))).toBe(true);
    expect(all).not.toMatch(/Round trip distance|Outbound|sun elevation \d+° at the start/);
    expect(r.sections[3].calcs!.map((c) => c.title)).toContain('Route search');
    const g = JSON.parse(routeGeoJson(route, ops));
    expect(g.features.filter((f: { geometry: { type: string } }) => f.geometry.type === 'LineString')).toHaveLength(0);
    expect(g.properties).toMatchObject({ feasible: false, legCount: 0, roundTripLengthM: 0 });
  });
  it('legs table sums to the round trip, with ascent to 0.1 m so the legs add up to the climb formula', () => {
    const r = buildReport(input());
    const rows = r.sections[2].tables[0].rows.map((row) => row.map(cellText));
    const km = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    const sum = rows.find((x) => /sum of legs/.test(x[0]))!;
    expect(km(rows[0][1]) + km(rows[1][1])).toBeCloseTo(km(sum[1]), 1);
    expect(km(rows[0][2]) + km(rows[1][2])).toBeCloseTo(km(sum[2]), 1);
    const climb = r.sections[3].calcs!.find((c) => /climbing/i.test(c.title))!.lines[0];
    expect(climb).toContain(`× ${sum[2]} =`);
  });
  it('includes the landing simulation and the science at the target when the session has them; trace times are filled', () => {
    const base = input();
    const r = buildReport({
      ...base,
      scenario: { site: { lon: 77.45, lat: 18.44 }, samples: 10000, okPercent: 98.7, maxSlopeDeg: 15, slopeP50Deg: 2.1, slopeP95Deg: 6.4, terrainModel: 'Jezero CTX DEM, 20 m posting', engine: 'wasm', ellipse: { semiMajorKm: 3.85, semiMinorKm: 3.3, azimuthDeg: 0 } },
      science: { target: { lon: base.route!.to.lon, lat: base.route!.to.lat }, unit: { symbol: 'Jd', name: 'Delta, upper' }, site: { name: 'Three Forks sample depot', distanceKm: 0.61 },
        ground: { sol: 418, distanceM: 1234, photos: [{ id: 'N1', url: 'https://mars.nasa.gov/x.jpg', camera: 'NAVCAM_RIGHT', cameraFull: 'Navigation Camera Right', credit: 'NASA/JPL-Caltech', earthDate: '2022-04-30' }] } },
      turns: [{ ...base.turns[0], steps: [...base.turns[0].steps, { kind: 'calculation', title: 'Suit battery', durMs: 0.2 }, { kind: 'calculation', title: 'Comms', durMs: 14.4 }] }],
    });
    const heads = r.sections[0].tables.map((t) => t.head[0]);
    expect(heads).toEqual(expect.arrayContaining(['Landing simulation', 'Science at target']));
    const land = r.sections[0].tables.find((t) => t.head[0] === 'Landing simulation')!.rows.map((x) => x.map(cellText).join(' | '));
    expect(land).toContain('Ellipse | 7.7 by 6.6 km (semi-axes 3.85 and 3.3 km)');
    const sci = r.sections[0].tables.find((t) => t.head[0] === 'Science at target')!.rows.map((x) => x.map(cellText).join(' | '));
    expect(sci[0]).toContain('Delta, upper (Jd)');
    expect(sci[2]).toMatch(/Sol 418, Navigation Camera Right, 1\.23 km from the target/);
    const times = r.sections[7].tables[0].rows.map((x) => cellText(x[3]));
    expect(times.slice(-2)).toEqual(['under 1 ms', '14 ms']);
  });
});
