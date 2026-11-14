import { describe, expect, it } from 'vitest';
import type { RouteResult } from '@/lib/contracts';
import type { CommsResult, DaylightCheck, ShadowStretch } from '@/lib/opsContracts';
import {
  BATTERY_CAUTION_MARGIN_PCT, COMMS_NOGO_SHADOW_M, EVA_CAUTION_FRACTION, SLOPE_CAUTION_FRACTION, SUN_CAUTION_MARGIN_DEG,
} from '@/lib/ops/assumptions';
import { evaluateGoNoGo } from '@/lib/ops/goNoGo';
import { handRoute, line } from './fixtures';

// synthetic test fixture — hand-set totals, comms and lighting so every rule is exercised in isolation
const base = (over: Partial<RouteResult['totals']> = {}, r: Partial<RouteResult> = {}): RouteResult => ({
  ...handRoute([line([0, 0], [200, 0])]),
  totals: { lengthM: 2000, ascentM: 50, descentM: 50, maxSlopeDeg: 5, walkMin: 60, evaMin: 120, batteryUsedPct: 30, climbWorkKJ: 10, ...over },
  ...r,
});
const shadow = (lengthM: number): ShadowStretch => ({
  startIdx: 2, endIdx: 4, startLeg: 0, startVertex: 2, endLeg: 0, endVertex: 4, lengthM, maxLengthM: lengthM + 40,
  startMin: 3, endMin: 6, start: { lon: 0, lat: 0 }, end: { lon: 0, lat: 0 },
});
const comms = (over: Partial<CommsResult> = {}): CommsResult => ({
  stationId: 'habitat', visible: [true, true, true], shadows: [], visibleFraction: 1, longestShadowM: 0, nodataVertices: 0,
  stationHeightM: 2, suitHeightM: 1.8, ...over,
});
const light = (over: Partial<DaylightCheck> = {}): DaylightCheck => ({
  ok: true, thresholdDeg: 0, minElevationDeg: 30, minElevationAtMin: 0, startElevationDeg: 40, endElevationDeg: 30, firstViolationMin: null, ...over,
});
const item = (g: ReturnType<typeof evaluateGoNoGo>, id: string) => g.items.find((i) => i.id === id)!;

describe('go / no-go', () => {
  it('everything comfortable → overall go, six items in order, each with source and rule', () => {
    const g = evaluateGoNoGo({ route: base(), comms: comms(), lighting: light() });
    expect(g.items.map((i) => i.id)).toEqual(['slope', 'battery', 'eva-time', 'daylight', 'comms', 'data']);
    expect(g.overall).toBe('go');
    expect(g.blockers).toEqual([]);
    expect(g.cautions).toEqual([]);
    for (const i of g.items) { expect(i.source.length).toBeGreaterThan(10); expect(i.rule.length).toBeGreaterThan(10); }
    expect(item(g, 'slope')).toMatchObject({ value: 5, limit: 15, unit: 'deg' });
    expect(item(g, 'battery')).toMatchObject({ value: 70, limit: 20 });
    expect(item(g, 'eva-time')).toMatchObject({ value: 120, limit: 360 });
  });

  it('slope: caution at ≥80% of limit, no-go above, no-go when the planner found no path', () => {
    const lim = 15;
    expect(item(evaluateGoNoGo({ route: base({ maxSlopeDeg: SLOPE_CAUTION_FRACTION * lim }), comms: comms(), lighting: light() }), 'slope').status).toBe('caution');
    expect(item(evaluateGoNoGo({ route: base({ maxSlopeDeg: SLOPE_CAUTION_FRACTION * lim - 0.1 }), comms: comms(), lighting: light() }), 'slope').status).toBe('go');
    expect(item(evaluateGoNoGo({ route: base({ maxSlopeDeg: 15 }), comms: comms(), lighting: light() }), 'slope').status).toBe('caution');
    expect(item(evaluateGoNoGo({ route: base({ maxSlopeDeg: 15.5 }), comms: comms(), lighting: light() }), 'slope').status).toBe('no-go');
    const g = evaluateGoNoGo({ route: base({}, { feasible: false, reasons: ['no_path_slope'], legs: [] }), comms: comms(), lighting: light() });
    expect(item(g, 'slope')).toMatchObject({ status: 'no-go', value: null });
    expect(g.overall).toBe('no-go');
  });

  it('battery: remaining vs reserve with a caution band', () => {
    const k = (used: number) => item(evaluateGoNoGo({ route: base({ batteryUsedPct: used }), comms: comms(), lighting: light() }), 'battery');
    expect(k(100 - 20 - BATTERY_CAUTION_MARGIN_PCT + 1).status).toBe('caution');
    expect(k(100 - 20 - BATTERY_CAUTION_MARGIN_PCT).status).toBe('go'); // remaining = reserve + margin exactly
    expect(k(75).status).toBe('caution');
    expect(k(80).status).toBe('caution'); // exactly at reserve is allowed (planner rule: used > 100−reserve is infeasible)
    expect(k(80.5).status).toBe('no-go');
    expect(k(80.5).value).toBe(19.5);
    expect(item(evaluateGoNoGo({ route: base({}, { reasons: ['battery_reserve'], feasible: false }), comms: comms(), lighting: light() }), 'battery').status).toBe('no-go');
  });

  it('EVA time: caution above 85% of the limit, no-go above the limit', () => {
    const e = (m: number) => item(evaluateGoNoGo({ route: base({ evaMin: m }), comms: comms(), lighting: light() }), 'eva-time').status;
    expect(e(EVA_CAUTION_FRACTION * 360)).toBe('go');
    expect(e(EVA_CAUTION_FRACTION * 360 + 1)).toBe('caution');
    expect(e(360)).toBe('caution');
    expect(e(361)).toBe('no-go');
  });

  it('daylight: no-go if the check failed, caution within the margin, caution when not evaluated', () => {
    const d = (l: DaylightCheck | null) => item(evaluateGoNoGo({ route: base(), comms: comms(), lighting: l }), 'daylight');
    expect(d(light({ ok: false, minElevationDeg: -3, firstViolationMin: 90 })).status).toBe('no-go');
    expect(d(light({ minElevationDeg: SUN_CAUTION_MARGIN_DEG - 0.5 })).status).toBe('caution');
    expect(d(light({ minElevationDeg: SUN_CAUTION_MARGIN_DEG + 0.5 })).status).toBe('go');
    const none = d(null);
    expect(none).toMatchObject({ status: 'caution', value: null, provenance: 'unavailable' });
    expect(none.source).toMatch(/not evaluated/);
  });

  it('comms: go without shadow, caution for a short shadow, no-go beyond the limit, caution when no station', () => {
    const c = (cm: CommsResult | null) => item(evaluateGoNoGo({ route: base(), comms: cm, lighting: light() }), 'comms');
    expect(c(comms()).status).toBe('go');
    expect(c(comms({ shadows: [shadow(120)], longestShadowM: 120 }))).toMatchObject({ status: 'caution', value: 120, limit: COMMS_NOGO_SHADOW_M });
    expect(c(comms({ shadows: [shadow(120), shadow(COMMS_NOGO_SHADOW_M)], longestShadowM: COMMS_NOGO_SHADOW_M })).status).toBe('caution');
    expect(c(comms({ shadows: [shadow(COMMS_NOGO_SHADOW_M + 1)], longestShadowM: COMMS_NOGO_SHADOW_M + 1 })).status).toBe('no-go');
    expect(c(null).status).toBe('caution');
  });

  it('data: no-go on DEM-nodata vertices or unreachable endpoints; caution if inputs are missing', () => {
    const dd = (r: RouteResult, cm: CommsResult | null, l: DaylightCheck | null) => item(evaluateGoNoGo({ route: r, comms: cm, lighting: l }), 'data');
    expect(dd(base(), comms(), light())).toMatchObject({ status: 'go', value: 100 });
    expect(dd(base(), null, light()).status).toBe('caution');
    expect(dd(base(), comms(), null).status).toBe('caution');
    const gap = dd(base(), comms({ nodataVertices: 1 }), light());
    expect(gap.status).toBe('no-go');
    expect(gap.value).toBeCloseTo(66.7, 1);
    expect(dd(base({}, { reasons: ['nodata_endpoint'], feasible: false, legs: [] }), comms(), light())).toMatchObject({ status: 'no-go', value: 0 });
    expect(dd(base({}, { reasons: ['out_of_bounds'], feasible: false, legs: [] }), comms(), light()).status).toBe('no-go');
  });

  it('overall is the worst item; blockers/cautions list the ids', () => {
    const g = evaluateGoNoGo({
      route: base({ maxSlopeDeg: 13, evaMin: 400 }), comms: comms({ shadows: [shadow(50)], longestShadowM: 50 }), lighting: light(),
    });
    expect(item(g, 'slope').status).toBe('caution');
    expect(item(g, 'eva-time').status).toBe('no-go');
    expect(item(g, 'comms').status).toBe('caution');
    expect(g.overall).toBe('no-go');
    expect(g.blockers).toEqual(['eva-time']);
    expect(g.cautions).toEqual(['slope', 'comms']);
  });

  it('uses explicit constraints when given (limits come from MissionConstraints, not constants)', () => {
    const r = base({ maxSlopeDeg: 10, batteryUsedPct: 50, evaMin: 200 });
    const tight = evaluateGoNoGo({ route: r, comms: comms(), lighting: light(), constraints: { ...r.constraintsUsed, maxSlopeDeg: 8, batteryReservePct: 60, evaMaxMin: 150 } });
    expect(tight.blockers).toEqual(['slope', 'battery', 'eva-time']);
    expect(item(tight, 'slope').limit).toBe(8);
    expect(item(tight, 'battery').limit).toBe(60);
    expect(item(tight, 'eva-time').limit).toBe(150);
  });
});
