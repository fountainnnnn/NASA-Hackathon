/* eslint-disable @typescript-eslint/no-explicit-any */
// Globe tool tests: mocked deps + the synthetic global fixture (synthetic test fixture, not Mars data).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobeCommandSchema, TOOL_SPECS, compactForModel, executeTool } from '../../src/lib/agent/tools';
import { createGlobalScience } from '../../src/lib/globalSci';
import type { GlobalScienceApi } from '../../src/lib/globalSci';
import type { GlobeCommand } from '../../src/lib/globeContracts';
import { clearScenarios, getScenario, gridSlopeSource, registerScenarioSources } from '../../src/lib/scenario';
import type { ToolDeps } from '../../src/lib/contracts';
import { fixtureFetch } from '../globalSci/fixtures';
import { mockDeps } from './helpers';

let sci: GlobalScienceApi;
beforeAll(async () => { sci = createGlobalScience(fixtureFetch()); await sci.load(); });

function globeDeps(mode: 'globe' | 'jezero' = 'globe', withSci = true) {
  const m = mockDeps();
  const issued: GlobeCommand[][] = [];
  const globe = {
    applyGlobeCommands: vi.fn((c: GlobeCommand[]) => { issued.push(c); return { applied: c.length, errors: [] as string[] }; }),
    snapshot: vi.fn(() => ({ mode, clicked: null, hovered: null })),
  };
  const deps = { ...(m.deps as object), globe, ...(withSci ? { globalSci: sci } : {}) } as unknown as ToolDeps;
  return { deps, globe, issued };
}
const types = (c: GlobeCommand[]) => c.map((x) => x.type);

beforeEach(() => { clearScenarios(); });

describe('globe tool specs', () => {
  it('registers the new tools with JSON-schema parameters', () => {
    const names = TOOL_SPECS.map((t) => t.function.name);
    for (const n of ['get_site_conditions', 'check_landing_site', 'run_landing_scenario', 'show_edl_timeline', 'compare_sites', 'globe_commands', 'go_to_jezero', 'plan_route']) {
      expect(names).toContain(n);
    }
    const run = TOOL_SPECS.find((t) => t.function.name === 'run_landing_scenario')!.function.parameters as { properties: Record<string, { maximum?: number; minimum?: number }> };
    expect(run.properties.samples.maximum).toBe(20000);
    expect(run.properties.maxSlopeDeg.minimum).toBe(5);
    expect(run.properties.maxSlopeDeg.maximum).toBe(30);
  });
  it('GlobeCommandSchema is an allowlist of exactly the GlobeCommand union', () => {
    expect(GlobeCommandSchema.safeParse({ type: 'globe_fly_to', lon: 1, lat: 2 }).success).toBe(true);
    expect(GlobeCommandSchema.safeParse({ type: 'enter_jezero' }).success).toBe(true);
    expect(GlobeCommandSchema.safeParse({ type: 'rm_rf' }).success).toBe(false);
    expect(GlobeCommandSchema.safeParse({ type: 'globe_marker', lon: 200, lat: 0, label: 'x', kind: 'site' }).success).toBe(false);
    expect(GlobeCommandSchema.safeParse({ type: 'globe_marker', lon: 0, lat: 0, label: 'x', kind: 'evil' }).success).toBe(false);
    expect(GlobeCommandSchema.safeParse({ type: 'globe_layer', layer: 'dust', visible: true }).success).toBe(true);
    expect(GlobeCommandSchema.safeParse({ type: 'globe_layer', layer: 'ctx', visible: true }).success).toBe(false);
  });
});

describe('argument validation', () => {
  it.each([
    ['get_site_conditions', { lon: 181, lat: 0 }],
    ['get_site_conditions', { lon: 0 }],
    ['check_landing_site', { lon: 0, lat: 91 }],
    ['run_landing_scenario', { lon: 0, lat: 0, samples: 20001 }],
    ['run_landing_scenario', { lon: 0, lat: 0, maxSlopeDeg: 4 }],
    ['run_landing_scenario', { lon: 0, lat: 0, maxSlopeDeg: 31 }],
    ['run_landing_scenario', { lon: 0, lat: 0, ellipse: { semiMajorKm: -1, semiMinorKm: 1 } }],
    ['compare_sites', { a: { lon: 0, lat: 0 } }],
    ['globe_commands', { commands: [] }],
    ['globe_commands', { commands: [{ type: 'nope' }] }],
  ])('%s rejects %j', async (name, args) => {
    const { deps, globe } = globeDeps();
    const r = (await executeTool(name, args, deps)) as { error?: string };
    expect(r.error).toBe('invalid_arguments');
    expect(globe.applyGlobeCommands).not.toHaveBeenCalled();
  });
});

describe('executors issue the right commands', () => {
  it('get_site_conditions: facts + a probe marker', async () => {
    const { deps, issued } = globeDeps();
    const r = (await executeTool('get_site_conditions', { lon: 77.5, lat: 18.4 }, deps)) as any;
    expect(r.placeName).toBe('Jezero Test');
    expect(typeof r.elevationM).toBe('number');
    expect(r.layers[0]).toMatchObject({ id: 'thermalInertia', unit: 'J m-2 s-0.5 K-1' });
    expect(r.provenance.elevation.kind).toBe('observed');
    expect(r.globe).toEqual({ applied: 1, errors: [] });
    expect(issued[0]).toEqual([expect.objectContaining({ type: 'globe_marker', kind: 'click', lon: 77.5, lat: 18.4 })]);
  });

  it('check_landing_site: verdict, cited criteria, marker + ellipse + fly-to', async () => {
    const { deps, issued } = globeDeps();
    const r = (await executeTool('check_landing_site', { lon: 10.5, lat: 10.5 }, deps)) as any;
    expect(['meets-all', 'fails-some', 'insufficient-data']).toContain(r.verdict);
    expect(r.criteria.find((c: any) => c.id === 'latitude')).toMatchObject({ result: 'pass', sourceUrl: expect.stringMatching(/^https:/) });
    expect(r.caveat).toMatch(/Curiosity/);
    expect(types(issued[0])).toEqual(['globe_marker', 'globe_ellipse', 'globe_fly_to']);
    const ell = issued[0][1] as Extract<GlobeCommand, { type: 'globe_ellipse' }>;
    expect(ell.semiMajorKm).toBeCloseTo(3.85);
    expect(ell.tone).toBe(r.verdict === 'meets-all' ? 'ok' : r.verdict === 'fails-some' ? 'bad' : 'warn');
  });

  it('check_landing_site at high latitude fails and draws a bad ellipse', async () => {
    const { deps, issued } = globeDeps();
    const r = (await executeTool('check_landing_site', { lon: 10.5, lat: 75.5 }, deps)) as any;
    expect(r.verdict).toBe('fails-some');
    expect((issued[0][1] as any).tone).toBe('bad');
  });

  it('run_landing_scenario: stats, stored scenario, scatter + ellipse commands, no raw arrays', async () => {
    registerScenarioSources({ global: gridSlopeSource({ width: 4, height: 4, lonMin: -180, latMax: 90, dLon: 90, dLat: 45, wrapLon: true, slope: new Float32Array(16).fill(1), demResM: 1850 }) });
    const { deps, issued } = globeDeps();
    const r = (await executeTool('run_landing_scenario', { lon: 10.5, lat: 10.5, samples: 2000, maxSlopeDeg: 10 }, deps)) as any;
    expect(r.error).toBeUndefined();
    expect(r.scenarioId).toMatch(/^S\d+$/);
    expect(getScenario(r.scenarioId)?.result.samples).toBe(2000);
    expect(r.okPercent).toBeGreaterThanOrEqual(0);
    expect(r.okPercent).toBeLessThanOrEqual(100);
    expect(r.terrainModel).toMatch(/global DEM/);
    expect(r.note).toMatch(/Coarse global DEM/);
    expect(r.provenance.slopeLimit.kind).toBe('assumption');
    expect(JSON.stringify(r)).not.toMatch(/"points"/);
    expect(types(issued[0])).toEqual(['globe_ellipse', 'globe_scatter', 'globe_fly_to']);
    expect(issued[0][1]).toMatchObject({ scenarioId: r.scenarioId });
    // determinism through the tool: same args -> same stats
    const r2 = (await executeTool('run_landing_scenario', { lon: 10.5, lat: 10.5, samples: 2000, maxSlopeDeg: 10 }, deps)) as any;
    expect(r2.okPercent).toBe(r.okPercent);
    expect(r2.slopeP95Deg).toBe(r.slopeP95Deg);
    expect(r2.scenarioId).not.toBe(r.scenarioId);
  });

  it('run_landing_scenario honours an ellipse override and a flat DEM gives ~100%', async () => {
    registerScenarioSources({ global: gridSlopeSource({ width: 4, height: 4, lonMin: -180, latMax: 90, dLon: 90, dLat: 45, wrapLon: true, slope: new Float32Array(16).fill(1), demResM: 1850 }) });
    const { deps, issued } = globeDeps();
    const r = (await executeTool('run_landing_scenario', { lon: 0, lat: 0, samples: 500, ellipse: { semiMajorKm: 10, semiMinorKm: 5, azimuthDeg: 90 } }, deps)) as any;
    expect(r.ellipse).toMatchObject({ semiMajorKm: 10, semiMinorKm: 5, azimuthDeg: 90, usedDefault: false });
    expect(r.okPercent).toBe(100);
    expect((issued[0][0] as any).tone).toBe('ok');
  });

  it('show_edl_timeline: sourced phases, schematic arc, touchdown marker', async () => {
    const { deps, issued } = globeDeps();
    const r = (await executeTool('show_edl_timeline', { lon: 77.45, lat: 18.44 }, deps)) as any;
    const ids = r.phases.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['entry_interface', 'peak_heating', 'parachute_deploy', 'heat_shield_separation', 'trn_radar', 'powered_descent', 'sky_crane', 'touchdown']));
    expect(r.phases.find((p: any) => p.id === 'parachute_deploy')).toMatchObject({ tStartS: 240, altitudeKmStart: 11 });
    expect(r.trackNote).toMatch(/schematic/);
    expect(types(issued[0])).toEqual(['globe_arc', 'globe_marker', 'globe_fly_to']);
    const arc = issued[0][0] as Extract<GlobeCommand, { type: 'globe_arc' }>;
    expect(arc.to).toEqual({ lon: 77.45, lat: 18.44 });
    expect(arc.from.lon).toBeLessThan(77.45);
  });

  it('compare_sites: both sides, deltas B minus A, markers + arc', async () => {
    const { deps, issued } = globeDeps();
    const r = (await executeTool('compare_sites', { a: { lon: 10.5, lat: 10.5 }, b: { lon: 10.5, lat: 20.5 } }, deps)) as any;
    expect(r.deltas.elevationM).toBe(r.b.elevationM - r.a.elevationM);
    expect(r.deltas.elevationM).toBeCloseTo(100, -1);
    expect(r.distanceKm).toBeGreaterThan(500);
    expect(types(issued[0])).toEqual(['globe_marker', 'globe_marker', 'globe_arc']);
    expect(r.a.verdict).toBeDefined();
  });

  it('globe_commands applies the allowlisted commands as given', async () => {
    const { deps, globe } = globeDeps();
    const cmds: GlobeCommand[] = [{ type: 'globe_layer', layer: 'dust', visible: true }, { type: 'globe_clear' }];
    const r = (await executeTool('globe_commands', { commands: cmds }, deps)) as any;
    expect(globe.applyGlobeCommands).toHaveBeenCalledWith(cmds);
    expect(r.applied).toBe(2);
  });

  it('go_to_jezero issues enter_jezero and points at the walk tools', async () => {
    const { deps, issued } = globeDeps('jezero');
    const r = (await executeTool('go_to_jezero', {}, deps)) as any;
    expect(issued[0]).toEqual([{ type: 'enter_jezero' }]);
    expect(r.mode).toBe('jezero');
    expect(r.note).toMatch(/plan_route/);
  });
});

describe('graceful failures', () => {
  it('reports missing global data and missing globe instead of throwing', async () => {
    const { deps } = globeDeps('globe', false);
    expect(await executeTool('get_site_conditions', { lon: 0, lat: 0 }, deps)).toMatchObject({ error: 'global_data_unavailable' });
    expect(await executeTool('check_landing_site', { lon: 0, lat: 0 }, deps)).toMatchObject({ error: 'global_data_unavailable' });
    const m = mockDeps();
    expect(await executeTool('globe_commands', { commands: [{ type: 'globe_clear' }] }, m.deps)).toMatchObject({ error: 'no_globe' });
    expect(await executeTool('go_to_jezero', {}, m.deps)).toMatchObject({ error: 'no_globe' });
  });
  it('still answers when the globe facade is absent (globe: null)', async () => {
    const m = mockDeps();
    const deps = { ...(m.deps as object), globalSci: sci } as unknown as ToolDeps;
    const r = (await executeTool('get_site_conditions', { lon: 0, lat: 0 }, deps)) as any;
    expect(r.globe).toBeNull();
    expect(r.elevationM).not.toBeNull();
  });
  it('existing Jezero tools keep working with extended deps', async () => {
    const { deps } = globeDeps();
    const r = (await executeTool('plan_route', { to: { lon: 77.5, lat: 18.5 } }, deps)) as any;
    expect(r.feasible).toBe(true);
  });
  it('compactForModel passes new results through unchanged', async () => {
    const x = { a: 1 };
    expect(compactForModel('get_site_conditions', x)).toBe(x);
  });
});
