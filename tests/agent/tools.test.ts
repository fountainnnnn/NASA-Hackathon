import { describe, expect, it } from 'vitest';
import { ConstraintsPatchSchema, SceneCommandSchema, TOOL_SPECS, executeTool } from '../../src/lib/agent/tools';
import { mockDeps } from './helpers';

describe('schemas', () => {
  it('SceneCommand union rejects unknown types and bad fields', () => {
    expect(SceneCommandSchema.safeParse({ type: 'delete_everything' }).success).toBe(false);
    expect(SceneCommandSchema.safeParse({ type: 'add_pin', lon: 77, lat: 18, label: 'x', kind: 'nope' }).success).toBe(false);
    expect(SceneCommandSchema.safeParse({ type: 'draw_route', routeId: 'R1' }).success).toBe(true);
    expect(SceneCommandSchema.safeParse({ type: 'show_comparison', routeIds: ['R1', 'R2'] }).success).toBe(true);
  });
  it('constraint bounds enforced', () => {
    expect(ConstraintsPatchSchema.safeParse({ maxSlopeDeg: 3 }).success).toBe(false);
    expect(ConstraintsPatchSchema.safeParse({ batteryReservePct: 90 }).success).toBe(false);
    expect(ConstraintsPatchSchema.safeParse({ suitPowerW: 5 }).success).toBe(false);
    expect(ConstraintsPatchSchema.safeParse({}).success).toBe(false);
    expect(ConstraintsPatchSchema.safeParse({ maxSlopeDeg: 20, objective: 'shortest' }).success).toBe(true);
  });
  it('executors return errors for bad args and unknown tools', async () => {
    const { deps } = mockDeps();
    expect(await executeTool('analyze_terrain', { target: 'selected', radiusM: 5 }, deps)).toMatchObject({ error: 'invalid_arguments' });
    expect(await executeTool('find_science_context', { target: 'base', radiusKm: 99 }, deps)).toMatchObject({ error: 'invalid_arguments' });
    expect(await executeTool('nope', {}, deps)).toMatchObject({ error: 'unknown_tool' });
    expect(await executeTool('get_scene_context', '{bad', deps)).toMatchObject({ error: 'invalid_arguments' });
  });
  it('asks for a click when nothing is selected', async () => {
    const { deps } = mockDeps({ selected: null });
    expect(await executeTool('get_location_context', { target: 'selected' }, deps)).toMatchObject({ error: 'no_selected_point' });
  });
});

describe('TOOL_SPECS', () => {
  it('is valid OpenAI function format', () => {
    expect(TOOL_SPECS.length).toBe(20);
    const names = new Set<string>();
    for (const t of TOOL_SPECS) {
      expect(t.type).toBe('function');
      expect(t.function.name).toMatch(/^[a-z_]+$/);
      expect(names.has(t.function.name)).toBe(false);
      names.add(t.function.name);
      expect(t.function.description.length).toBeGreaterThan(10);
      const p = t.function.parameters as { type: string; $schema?: string };
      expect(p.type).toBe('object');
      expect(p.$schema).toBeUndefined();
      JSON.stringify(t);
    }
    for (const n of ['plan_route', 'issue_scene_commands', 'export_mission_plan', 'compare_routes']) expect(names.has(n)).toBe(true);
  });
});

describe('executors', () => {
  it('plan_route uses CURRENT constraints, rounds, and draws the route', async () => {
    const m = mockDeps();
    await executeTool('set_mission_constraints', { maxSlopeDeg: 25 }, m.deps);
    const res = (await executeTool('plan_route', { to: 'selected' }, m.deps)) as any;
    expect(m.terrain.planRoute.mock.calls[0][0].constraints.maxSlopeDeg).toBe(25);
    expect(m.terrain.planRoute.mock.calls[0][0].roundTrip).toBe(true);
    expect(res.id).toBe('R1');
    expect(res.totals.lengthM).toBe(7312);
    expect(res.totals.batteryUsedPct).toBe(34.2);
    expect(res.legs[0]).not.toHaveProperty('path');
    const types = m.applied.flat().map((c) => c.type);
    expect(types).toContain('draw_route');
    expect(types).toContain('show_elevation_profile');
  });
  it('compare_routes reports deltas and violations; export builds GeoJSON', async () => {
    const m = mockDeps();
    await executeTool('plan_route', { to: 'selected' }, m.deps);
    await executeTool('set_mission_constraints', { maxSlopeDeg: 10 }, m.deps);
    await executeTool('plan_route', { to: 'selected', roundTrip: false }, m.deps);
    const cmp = (await executeTool('compare_routes', { routeIds: ['R1', 'R2'] }, m.deps)) as any;
    expect(cmp.deltas.lengthM.delta).toBe(0);
    expect(cmp.violatesCurrentLimits.R1[0]).toMatch(/max slope 11.3 deg exceeds limit 10/);
    expect(cmp.constraintsChanged[0].field).toBe('maxSlopeDeg');
    const exp = (await executeTool('export_mission_plan', { routeId: 'R1' }, m.deps)) as any;
    expect(exp.download).toBe(true);
    expect(exp.geojson.type).toBe('FeatureCollection');
    expect(exp.geojson.features.some((f: any) => f.geometry.type === 'LineString')).toBe(true);
    expect(exp.geojson.properties.assumptions.length).toBeGreaterThan(3);
  });
  it('rejects out-of-bounds coordinates', async () => {
    const { deps } = mockDeps();
    expect(await executeTool('get_location_context', { target: { lon: 10, lat: 10 } }, deps)).toMatchObject({ error: 'out_of_bounds' });
  });
});
