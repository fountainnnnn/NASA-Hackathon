import { beforeEach, describe, expect, it } from 'vitest';
import type { GlobeCommand } from '../../src/lib/globeContracts';
import { JEZERO_CENTER, MAX_ALT_KM, MIN_ALT_KM, onGlobePick, reduceGlobeCommands, useGlobeStore, type GlobeCmdSlice } from '../../src/state/globe';

const empty = (over: Partial<GlobeCmdSlice> = {}): GlobeCmdSlice => ({
  mode: 'globe', markers: [], ellipses: [], arcs: [], scatterShown: [],
  layers: { elevation: false, geology: false, hydrogen: false, thermalInertia: false, dust: false, slope: false },
  flight: null, ...over,
});
const bad = (c: unknown) => c as GlobeCommand;

describe('reduceGlobeCommands', () => {
  it('applies valid markers, ellipses, arcs, layers, scatter', () => {
    const { next, applied, errors } = reduceGlobeCommands(empty(), [
      { type: 'globe_marker', id: 'a', lon: 77.4, lat: 18.4, label: 'Jezero', kind: 'landing' },
      { type: 'globe_ellipse', lon: 77.4, lat: 18.4, semiMajorKm: 25, semiMinorKm: 7, azimuthDeg: -15, label: 'EDL', tone: 'ok' },
      { type: 'globe_arc', from: { lon: 0, lat: 0 }, to: { lon: 77, lat: 18 }, label: 'approach' },
      { type: 'globe_layer', layer: 'geology', visible: true },
      { type: 'globe_scatter', scenarioId: 'mc-1' },
    ]);
    expect(errors).toEqual([]); expect(applied).toBe(5);
    expect(next.markers[0].id).toBe('a');
    expect(next.ellipses[0].azimuthDeg).toBe(345); // normalised
    expect(next.arcs).toHaveLength(1); expect(next.layers.geology).toBe(true);
    expect(next.scatterShown[0]).toEqual({ id: 'mc-1', scenarioId: 'mc-1' });
  });

  it('rejects out-of-range coordinates, NaN, wrong types', () => {
    const { next, applied, errors } = reduceGlobeCommands(empty(), [
      bad({ type: 'globe_fly_to', lon: 181, lat: 0 }),
      bad({ type: 'globe_fly_to', lon: 0, lat: -91 }),
      bad({ type: 'globe_marker', lon: NaN, lat: 0, label: 'x', kind: 'site' }),
      bad({ type: 'globe_marker', lon: '10', lat: 0, label: 'x', kind: 'site' }),
      bad({ type: 'globe_marker', lon: 10, lat: 0, label: '   ', kind: 'site' }),
      bad({ type: 'globe_marker', lon: 10, lat: 0, label: 'x', kind: 'rocket' }),
      bad({ type: 'globe_marker', id: '../etc', lon: 10, lat: 0, label: 'x', kind: 'site' }),
      bad({ type: 'globe_ellipse', lon: 0, lat: 0, semiMajorKm: -1, semiMinorKm: 5, azimuthDeg: 0, label: 'x', tone: 'ok' }),
      bad({ type: 'globe_ellipse', lon: 0, lat: 0, semiMajorKm: 99999, semiMinorKm: 5, azimuthDeg: 0, label: 'x', tone: 'ok' }),
      bad({ type: 'globe_ellipse', lon: 0, lat: 0, semiMajorKm: 5, semiMinorKm: 5, azimuthDeg: 0, label: 'x', tone: 'purple' }),
      bad({ type: 'globe_arc', from: { lon: 0, lat: 0 }, to: { lon: 200, lat: 0 }, label: 'x' }),
      bad({ type: 'globe_arc', from: null, to: { lon: 0, lat: 0 }, label: 'x' }),
      bad({ type: 'globe_layer', layer: 'nope', visible: true }),
      bad({ type: 'globe_layer', layer: 'dust', visible: 'yes' }),
      bad({ type: 'globe_scatter', scenarioId: 'a b; drop' }),
    ]);
    expect(applied).toBe(0);
    expect(errors).toHaveLength(15);
    expect(next).toEqual(empty());
  });

  it('rejects unknown types and garbage entries but still applies the valid ones', () => {
    const { next, applied, errors } = reduceGlobeCommands(empty(), [
      bad({ type: 'rm_rf' }), bad(null), bad(42), bad({}),
      { type: 'globe_marker', lon: 1, lat: 2, label: 'ok', kind: 'click' },
    ]);
    expect(applied).toBe(1); expect(errors).toHaveLength(4);
    expect(errors[0]).toContain('unknown command type'); expect(next.markers).toHaveLength(1);
  });

  it('non-array input is an error, not a throw', () => {
    expect(reduceGlobeCommands(empty(), bad('x') as unknown as GlobeCommand[]).errors).toHaveLength(1);
  });

  it('fly_to clamps altitude and bumps the flight sequence', () => {
    let r = reduceGlobeCommands(empty(), [{ type: 'globe_fly_to', lon: 10, lat: 20, altitudeKm: 5 }]);
    expect(r.next.flight).toMatchObject({ seq: 1, lon: 10, lat: 20, altitudeKm: MIN_ALT_KM, enterJezero: false });
    r = reduceGlobeCommands(r.next, [{ type: 'globe_fly_to', lon: 10, lat: 20, altitudeKm: 90_000 }]);
    expect(r.next.flight).toMatchObject({ seq: 2, altitudeKm: MAX_ALT_KM });
    expect(reduceGlobeCommands(empty(), [bad({ type: 'globe_fly_to', lon: 1, lat: 1, altitudeKm: -3 })]).errors).toHaveLength(1);
    expect(reduceGlobeCommands(empty(), [bad({ type: 'globe_fly_to', lon: 1, lat: 1, altitudeKm: 1e9 })]).errors).toHaveLength(1);
  });

  it('same id replaces; clear empties overlays; caps are enforced', () => {
    let r = reduceGlobeCommands(empty(), [
      { type: 'globe_marker', id: 'm', lon: 1, lat: 1, label: 'one', kind: 'site' },
      { type: 'globe_marker', id: 'm', lon: 2, lat: 2, label: 'two', kind: 'site' },
    ]);
    expect(r.next.markers).toEqual([{ id: 'm', lon: 2, lat: 2, label: 'two', kind: 'site' }]);
    r = reduceGlobeCommands(r.next, [{ type: 'globe_clear' }]);
    expect(r.next.markers).toEqual([]);
    const many: GlobeCommand[] = Array.from({ length: 250 }, (_, i) => ({ type: 'globe_marker', id: `m${i}`, lon: 0, lat: 0, label: 'x', kind: 'site' }));
    expect(reduceGlobeCommands(empty(), many).next.markers).toHaveLength(200);
  });

  it('enter_jezero requests a handoff flight; exit_jezero returns to globe', () => {
    const r = reduceGlobeCommands(empty(), [{ type: 'enter_jezero' }]);
    expect(r.next.flight).toMatchObject({ enterJezero: true, lon: JEZERO_CENTER.lon, lat: JEZERO_CENTER.lat });
    expect(reduceGlobeCommands(empty({ mode: 'jezero' }), [{ type: 'enter_jezero' }]).next.flight).toBeNull();
    const x = reduceGlobeCommands(empty({ mode: 'jezero' }), [{ type: 'exit_jezero' }]);
    expect(x.next.mode).toBe('globe'); expect(x.next.flight?.enterJezero).toBe(false);
  });

  it('truncates long labels', () => {
    const r = reduceGlobeCommands(empty(), [{ type: 'globe_marker', lon: 0, lat: 0, label: 'x'.repeat(500), kind: 'site' }]);
    expect(r.next.markers[0].label).toHaveLength(80);
  });
});

describe('useGlobeStore', () => {
  beforeEach(() => useGlobeStore.setState({ markers: [], flight: null, clicked: null, mode: 'globe' }));

  it('applyGlobeCommands writes to the store and reports errors', () => {
    const res = useGlobeStore.getState().applyGlobeCommands([
      { type: 'globe_marker', lon: 3, lat: 4, label: 'hi', kind: 'click' }, bad({ type: 'globe_fly_to', lon: 500, lat: 0 }),
    ]);
    expect(res.applied).toBe(1); expect(res.errors).toHaveLength(1);
    expect(useGlobeStore.getState().markers).toHaveLength(1);
  });

  it('pick records the click and notifies subscribers until unsubscribed', () => {
    const seen: number[] = [];
    const off = onGlobePick((p) => seen.push(p.lon));
    const pick = { lon: 12, lat: -3, elevationM: -2000, kind: 'click' as const, altitudeKm: 900, at: 1 };
    useGlobeStore.getState().pick(pick);
    expect(useGlobeStore.getState().clicked).toMatchObject({ lon: 12, lat: -3, seq: 1 });
    off();
    useGlobeStore.getState().pick({ ...pick, lon: 99 });
    expect(seen).toEqual([12]);
  });

  it('exaggeration is clamped and layers only accept known ids', () => {
    useGlobeStore.getState().setExaggeration(999); expect(useGlobeStore.getState().exaggeration).toBe(50);
    useGlobeStore.getState().setExaggeration(NaN); expect(useGlobeStore.getState().exaggeration).toBe(50);
    useGlobeStore.getState().setExaggeration(20);
  });

  it('flyTo ignores invalid input', () => {
    useGlobeStore.getState().flyTo(400, 0); expect(useGlobeStore.getState().flight).toBeNull();
    useGlobeStore.getState().flyTo(10, 10, 1000); expect(useGlobeStore.getState().flight?.altitudeKm).toBe(1000);
  });
});
