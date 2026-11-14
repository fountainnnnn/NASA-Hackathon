import { describe, expect, it } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '../../src/lib/contracts';
import type { RouteResult, SceneCommand } from '../../src/lib/contracts';
import { reduceCommands } from '../../src/lib/scene/commands';
import type { SceneSlice } from '../../src/lib/scene/commands';

const bounds = { lonMin: 77.3, lonMax: 77.6, latMin: 18.3, latMax: 18.6 };
const pt = (lon: number, lat: number) => ({ id: 'P', lon, lat, elevationM: 0, x: 0, z: 0, source: 'pick' as const });
const route: RouteResult = {
  id: 'R1', label: 'test', from: pt(77.4, 18.4), to: pt(77.5, 18.5), roundTrip: true,
  legs: [{
    path: [0, 1, 2, 3].map((i) => ({ lon: 77.4 + i * 0.01, lat: 18.4, h: 0 })),
    lengthM: 1, horizM: 1, ascentM: 0, descentM: 0, maxSlopeDeg: 1, timeMin: 1, segSlopeDeg: [1, 1, 1],
  }],
  totals: { lengthM: 1, ascentM: 0, descentM: 0, maxSlopeDeg: 1, walkMin: 1, evaMin: 1, batteryUsedPct: 1, climbWorkKJ: 0 },
  feasible: true, reasons: [], constraintsUsed: DEFAULT_CONSTRAINTS, gridResM: 40, demResM: 20, computeMs: 1,
};
const base = (): SceneSlice => ({
  annotations: [], annSeq: 0, routes: { R1: route }, visibleRouteIds: [], routeStyles: {}, profileRouteId: null, comparison: null,
  cameraRequest: null, cameraTarget: null,
  layers: { ctx: true, themisDay: false, themisNight: false, geology: false, slope: true, traverse: true, ellipse: true },
});
const run = (cmds: unknown[], s = base()) => reduceCommands(s, cmds as SceneCommand[], bounds);

describe('reduceCommands', () => {
  it('applies valid commands in order', () => {
    const r = run([
      { type: 'add_pin', lon: 77.45, lat: 18.45, label: 'Delta front', kind: 'science' },
      { type: 'draw_route', routeId: 'R1', style: 'alternate' },
      { type: 'highlight_segment', routeId: 'R1', leg: 0, startIdx: 1, endIdx: 3, label: 'Steep' },
      { type: 'show_elevation_profile', routeId: 'R1' },
      { type: 'set_layer_visibility', layer: 'geology', visible: true },
      { type: 'focus_camera', lon: 77.4, lat: 18.4, distanceM: 1200 },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.applied).toBe(6);
    expect(r.state.annotations.map((a) => a.kind)).toEqual(['pin', 'highlight']);
    expect(r.state.visibleRouteIds).toEqual(['R1']);
    expect(r.state.routeStyles.R1).toBe('alternate');
    expect(r.state.profileRouteId).toBe('R1');
    expect(r.state.layers.geology).toBe(true);
    expect(r.state.cameraRequest).toMatchObject({ lon: 77.4, lat: 18.4, distanceM: 1200, nonce: 1 });
  });

  it('does not mutate the input state', () => {
    const s = base();
    run([{ type: 'add_pin', lon: 77.45, lat: 18.45, label: 'x', kind: 'info' }], s);
    expect(s.annotations).toHaveLength(0);
  });

  it('rejects unknown command types', () => {
    const r = run([{ type: 'launch_missiles' }]);
    expect(r.applied).toBe(0);
    expect(r.errors[0]).toMatch(/unknown command type/);
  });

  it('rejects unknown route ids', () => {
    const r = run([
      { type: 'draw_route', routeId: 'R9' },
      { type: 'show_elevation_profile', routeId: 'R9' },
      { type: 'highlight_segment', routeId: 'R9', leg: 0, startIdx: 0, endIdx: 1, label: 'x' },
      { type: 'show_comparison', routeIds: ['R1', 'R9'] },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(4);
    expect(r.state.visibleRouteIds).toEqual([]);
  });

  it('rejects out-of-bounds and non-finite coordinates', () => {
    const r = run([
      { type: 'add_pin', lon: 10, lat: 10, label: 'far', kind: 'info' },
      { type: 'add_pin', lon: Number.NaN, lat: 18.4, label: 'nan', kind: 'info' },
      { type: 'focus_camera', lon: 77.45, lat: 40 },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(3);
    expect(r.state.annotations).toHaveLength(0);
  });

  it('rejects bad highlight ranges, layers and annotation ids', () => {
    const r = run([
      { type: 'highlight_segment', routeId: 'R1', leg: 0, startIdx: 2, endIdx: 9, label: 'x' },
      { type: 'highlight_segment', routeId: 'R1', leg: 3, startIdx: 0, endIdx: 1, label: 'x' },
      { type: 'set_layer_visibility', layer: 'lava', visible: true },
      { type: 'remove_annotation', id: 'nope' },
    ]);
    expect(r.applied).toBe(0);
    expect(r.errors).toHaveLength(4);
  });

  it('applies the valid commands and reports the invalid ones in the same batch', () => {
    const r = run([{ type: 'draw_route', routeId: 'R1' }, { type: 'nope' }]);
    expect(r.applied).toBe(1);
    expect(r.errors).toHaveLength(1);
  });

  it('remove_annotation removes only that annotation', () => {
    const a = run([
      { type: 'add_pin', id: 'keep', lon: 77.45, lat: 18.45, label: 'a', kind: 'info' },
      { type: 'add_pin', id: 'drop', lon: 77.46, lat: 18.45, label: 'b', kind: 'info' },
    ]);
    const r = run([{ type: 'remove_annotation', id: 'drop' }], a.state);
    expect(r.state.annotations.map((x) => x.id)).toEqual(['keep']);
  });

  it('clear_annotations clears pins, highlights and drawn routes but keeps routes in memory', () => {
    const a = run([
      { type: 'add_pin', lon: 77.45, lat: 18.45, label: 'a', kind: 'info' },
      { type: 'draw_route', routeId: 'R1' },
      { type: 'show_elevation_profile', routeId: 'R1' },
    ]);
    const r = run([{ type: 'clear_annotations' }], a.state);
    expect(r.applied).toBe(1);
    expect(r.state.annotations).toEqual([]);
    expect(r.state.visibleRouteIds).toEqual([]);
    expect(r.state.profileRouteId).toBeNull();
    expect(r.state.routes.R1).toBeDefined();
  });
});
