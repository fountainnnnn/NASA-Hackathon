/**
 * Globe store (Zustand). Owns everything the Mars globe scene renders and the allowlisted command reducer
 * (`applyGlobeCommands`) the agent / companion / orchestrator drive it with.
 * Imports are relative so this file is unit-testable without a bundler alias.
 */
import { create } from 'zustand';
import type { LonLat } from '../lib/contracts';
import type { GlobalLayerId, GlobalManifest, GlobeCommand } from '../lib/globeContracts';

export const MIN_ALT_KM = 150;
export const MAX_ALT_KM = 25_000;
export const JEZERO_ENTER_ALT_KM = 200;
export const DEFAULT_EXAGGERATION = 20;
export const MIN_EXAGGERATION = 1;
export const MAX_EXAGGERATION = 50;
/** Where "enter_jezero" flies: centre of the 20 m coverage (CTX DEM bounds). */
export const JEZERO_CENTER: LonLat = { lon: (77.1605 + 77.699) / 2, lat: (18.211 + 18.7212) / 2 };
export const GLOBE_LAYER_IDS: GlobalLayerId[] = ['elevation', 'geology', 'hydrogen', 'thermalInertia', 'dust', 'slope'];

const MAX_MARKERS = 200, MAX_ELLIPSES = 100, MAX_ARCS = 100, MAX_LABEL = 80, MAX_ELLIPSE_KM = 3000;

export type GlobeMode = 'globe' | 'jezero';
export type GlobeDataStatus = 'loading' | 'ready' | 'unavailable';

export interface GlobeMarker { id: string; lon: number; lat: number; label: string; kind: 'click' | 'site' | 'landing' | 'hazard' }
export interface GlobeEllipse { id: string; lon: number; lat: number; semiMajorKm: number; semiMinorKm: number; azimuthDeg: number; label: string; tone: 'ok' | 'warn' | 'bad' }
export interface GlobeArc { id: string; from: LonLat; to: LonLat; label: string }
export interface GlobeScatterRef { id: string; scenarioId: string }
/** Packed [lon, lat, slopeDeg] × n. slope NaN = no data (drawn grey). */
export interface ScatterSet { points: Float32Array; maxSlopeDeg: number }
export interface GlobeView { lon: number; lat: number; altitudeKm: number }
export interface GlobeFlight { seq: number; lon: number; lat: number; altitudeKm: number; /** hand off to the Jezero planner on arrival */ enterJezero: boolean }
/** What a click / double-click on the planet resolved to. Mars-fixed, east-positive, planetocentric. */
export interface GlobePick extends LonLat { elevationM: number | null; kind: 'click' | 'dblclick'; altitudeKm: number; at: number }

export interface GlobeState {
  mode: GlobeMode;
  status: GlobeDataStatus;
  statusDetail: string | null;
  manifest: GlobalManifest | null;
  hovered: LonLat | null;
  clicked: (LonLat & { seq: number }) | null;
  markers: GlobeMarker[];
  ellipses: GlobeEllipse[];
  arcs: GlobeArc[];
  scatterShown: GlobeScatterRef[];
  scatter: Record<string, ScatterSet>;
  layers: Record<GlobalLayerId, boolean>;
  exaggeration: number;
  /** Current camera (written by the canvas at ≤10 Hz). */
  view: GlobeView;
  /** Pending camera flight; the canvas consumes it when `seq` changes. */
  flight: GlobeFlight | null;

  setMode(m: GlobeMode): void;
  setStatus(s: GlobeDataStatus, detail?: string | null): void;
  setManifest(m: GlobalManifest | null): void;
  setHovered(p: LonLat | null): void;
  /** Record a click and notify `onGlobePick` listeners. */
  pick(p: GlobePick): void;
  setLayer(id: GlobalLayerId, visible: boolean): void;
  setExaggeration(v: number): void;
  setView(v: GlobeView): void;
  flyTo(lon: number, lat: number, altitudeKm?: number, enterJezero?: boolean): void;
  /** Register a scenario's touchdown samples (so `globe_scatter` can show them). maxSlopeDeg splits cyan/red. */
  setScatter(scenarioId: string, points: Float32Array, maxSlopeDeg?: number): void;
  clearScatter(scenarioId?: string): void;
  /** Take one marker off the globe (for example a verdict tag that is out of date). */
  removeMarker(id: string): void;
  /** Allowlisted command reducer. Invalid commands are skipped and reported; valid ones still apply. */
  applyGlobeCommands(cmds: GlobeCommand[]): { applied: number; errors: string[] };
}

/* ------------------------------------------------------------------ pick subscription */

export type GlobePickListener = (p: GlobePick) => void;
const pickListeners = new Set<GlobePickListener>();
/** Subscribe to clicks / double-clicks on the globe. Returns an unsubscribe function. */
export function onGlobePick(cb: GlobePickListener): () => void {
  pickListeners.add(cb);
  return () => { pickListeners.delete(cb); };
}

/* ------------------------------------------------------------------ pure validation / reducer */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validLon = (v: unknown): v is number => isNum(v) && v >= -180 && v <= 180;
const validLat = (v: unknown): v is number => isNum(v) && v >= -90 && v <= 90;
const idOk = (v: unknown): v is string => typeof v === 'string' && /^[\w.:-]{1,64}$/.test(v);
const clampAlt = (a: number) => Math.min(MAX_ALT_KM, Math.max(MIN_ALT_KM, a));
const MARKER_KINDS = ['click', 'site', 'landing', 'hazard'] as const;
const TONES = ['ok', 'warn', 'bad'] as const;

/** The slice of state the reducer reads and writes. */
export interface GlobeCmdSlice {
  mode: GlobeMode;
  markers: GlobeMarker[]; ellipses: GlobeEllipse[]; arcs: GlobeArc[]; scatterShown: GlobeScatterRef[];
  layers: Record<GlobalLayerId, boolean>;
  flight: GlobeFlight | null;
}

let idCounter = 0;
const nextId = (p: string) => `${p}-${++idCounter}`;

function upsert<T extends { id: string }>(list: T[], item: T, max: number): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  const next = i >= 0 ? list.map((x, j) => (j === i ? item : x)) : [...list, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

function label(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, MAX_LABEL);
}

/** Returns the next slice patch, or throws Error(message) for an invalid command. */
function reduceOne(s: GlobeCmdSlice, cmd: GlobeCommand): Partial<GlobeCmdSlice> {
  const c = cmd as unknown as Record<string, unknown>;
  const flightSeq = (s.flight?.seq ?? 0) + 1;
  switch (c.type) {
    case 'globe_fly_to': {
      if (!validLon(c.lon) || !validLat(c.lat)) throw new Error('lon must be -180..180 and lat -90..90');
      let alt = 3000;
      if (c.altitudeKm !== undefined) {
        if (!isNum(c.altitudeKm) || c.altitudeKm <= 0 || c.altitudeKm > 100_000) throw new Error('altitudeKm must be a positive number');
        alt = clampAlt(c.altitudeKm);
      }
      return { flight: { seq: flightSeq, lon: c.lon, lat: c.lat, altitudeKm: alt, enterJezero: false } };
    }
    case 'globe_marker': {
      if (!validLon(c.lon) || !validLat(c.lat)) throw new Error('lon must be -180..180 and lat -90..90');
      const l = label(c.label); if (!l) throw new Error('label must be a non-empty string');
      if (!(MARKER_KINDS as readonly unknown[]).includes(c.kind)) throw new Error('unknown marker kind');
      if (c.id !== undefined && !idOk(c.id)) throw new Error('invalid id');
      const m: GlobeMarker = { id: (c.id as string | undefined) ?? nextId('marker'), lon: c.lon, lat: c.lat, label: l, kind: c.kind as GlobeMarker['kind'] };
      return { markers: upsert(s.markers, m, MAX_MARKERS) };
    }
    case 'globe_ellipse': {
      if (!validLon(c.lon) || !validLat(c.lat)) throw new Error('lon must be -180..180 and lat -90..90');
      const a = c.semiMajorKm, b = c.semiMinorKm;
      if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0 || a > MAX_ELLIPSE_KM || b > MAX_ELLIPSE_KM) throw new Error(`semi-axes must be > 0 and ≤ ${MAX_ELLIPSE_KM} km`);
      if (!isNum(c.azimuthDeg)) throw new Error('azimuthDeg must be a number');
      const l = label(c.label); if (!l) throw new Error('label must be a non-empty string');
      if (!(TONES as readonly unknown[]).includes(c.tone)) throw new Error('unknown tone');
      if (c.id !== undefined && !idOk(c.id)) throw new Error('invalid id');
      const e: GlobeEllipse = {
        id: (c.id as string | undefined) ?? nextId('ellipse'), lon: c.lon, lat: c.lat, semiMajorKm: a, semiMinorKm: b,
        azimuthDeg: ((c.azimuthDeg % 360) + 360) % 360, label: l, tone: c.tone as GlobeEllipse['tone'],
      };
      return { ellipses: upsert(s.ellipses, e, MAX_ELLIPSES) };
    }
    case 'globe_scatter': {
      if (!idOk(c.scenarioId)) throw new Error('scenarioId must be a short identifier');
      if (c.id !== undefined && !idOk(c.id)) throw new Error('invalid id');
      const ref: GlobeScatterRef = { id: (c.id as string | undefined) ?? c.scenarioId, scenarioId: c.scenarioId };
      return { scatterShown: upsert(s.scatterShown, ref, 20) };
    }
    case 'globe_arc': {
      const f = c.from as Record<string, unknown> | undefined, t = c.to as Record<string, unknown> | undefined;
      if (!f || !t || !validLon(f.lon) || !validLat(f.lat) || !validLon(t.lon) || !validLat(t.lat)) throw new Error('from/to need lon -180..180 and lat -90..90');
      const l = label(c.label); if (!l) throw new Error('label must be a non-empty string');
      if (c.id !== undefined && !idOk(c.id)) throw new Error('invalid id');
      const arc: GlobeArc = { id: (c.id as string | undefined) ?? nextId('arc'), from: { lon: f.lon as number, lat: f.lat as number }, to: { lon: t.lon as number, lat: t.lat as number }, label: l };
      return { arcs: upsert(s.arcs, arc, MAX_ARCS) };
    }
    case 'globe_layer': {
      if (!(GLOBE_LAYER_IDS as readonly unknown[]).includes(c.layer)) throw new Error('unknown layer');
      if (typeof c.visible !== 'boolean') throw new Error('visible must be boolean');
      return { layers: { ...s.layers, [c.layer as GlobalLayerId]: c.visible } };
    }
    case 'globe_clear':
      return { markers: [], ellipses: [], arcs: [], scatterShown: [] };
    case 'enter_jezero':
      if (s.mode === 'jezero') return {};
      return { flight: { seq: flightSeq, ...JEZERO_CENTER, altitudeKm: JEZERO_ENTER_ALT_KM + 10, enterJezero: true } };
    case 'exit_jezero':
      if (s.mode === 'globe') return {};
      return { mode: 'globe', flight: { seq: flightSeq, ...JEZERO_CENTER, altitudeKm: 700, enterJezero: false } };
    default:
      throw new Error(`unknown command type "${String(c.type)}"`);
  }
}

/** Pure reducer: apply every valid command in order; collect an error string per rejected one. */
export function reduceGlobeCommands(slice: GlobeCmdSlice, cmds: GlobeCommand[]): { next: GlobeCmdSlice; applied: number; errors: string[] } {
  let cur = slice, applied = 0;
  const errors: string[] = [];
  if (!Array.isArray(cmds)) return { next: slice, applied: 0, errors: ['commands must be an array'] };
  cmds.forEach((cmd, i) => {
    const type = cmd && typeof cmd === 'object' ? String((cmd as { type?: unknown }).type) : typeof cmd;
    try {
      if (!cmd || typeof cmd !== 'object') throw new Error('command must be an object');
      cur = { ...cur, ...reduceOne(cur, cmd) };
      applied++;
    } catch (e) {
      errors.push(`command ${i} (${type}): ${(e as Error).message}`);
    }
  });
  return { next: cur, applied, errors };
}

/* ------------------------------------------------------------------ store */

const DEFAULT_LAYERS: Record<GlobalLayerId, boolean> = { elevation: false, geology: false, hydrogen: false, thermalInertia: false, dust: false, slope: false };

export const useGlobeStore = create<GlobeState>((set, get) => ({
  mode: 'globe',
  status: 'loading',
  statusDetail: null,
  manifest: null,
  hovered: null,
  clicked: null,
  markers: [],
  ellipses: [],
  arcs: [],
  scatterShown: [],
  scatter: {},
  layers: { ...DEFAULT_LAYERS },
  exaggeration: DEFAULT_EXAGGERATION,
  view: { lon: 72, lat: 14, altitudeKm: 9000 },
  flight: null,

  setMode: (mode) => set({ mode }),
  setStatus: (status, statusDetail = null) => set({ status, statusDetail }),
  setManifest: (manifest) => set({ manifest }),
  setHovered: (hovered) => set({ hovered }),
  pick: (p) => {
    set({ clicked: { lon: p.lon, lat: p.lat, seq: (get().clicked?.seq ?? 0) + 1 } });
    pickListeners.forEach((cb) => { try { cb(p); } catch { /* a bad listener must not break picking */ } });
  },
  setLayer: (id, visible) => { if (GLOBE_LAYER_IDS.includes(id)) set((s) => ({ layers: { ...s.layers, [id]: visible } })); },
  setExaggeration: (v) => { if (isNum(v)) set({ exaggeration: Math.min(MAX_EXAGGERATION, Math.max(MIN_EXAGGERATION, v)) }); },
  setView: (view) => set({ view }),
  flyTo: (lon, lat, altitudeKm = 3000, enterJezero = false) => {
    if (!validLon(lon) || !validLat(lat) || !isNum(altitudeKm)) return;
    set((s) => ({ flight: { seq: (s.flight?.seq ?? 0) + 1, lon, lat, altitudeKm: clampAlt(altitudeKm), enterJezero } }));
  },
  setScatter: (scenarioId, points, maxSlopeDeg = 15) => set((s) => ({ scatter: { ...s.scatter, [scenarioId]: { points, maxSlopeDeg } } })),
  clearScatter: (scenarioId) => set((s) => {
    if (!scenarioId) return { scatter: {}, scatterShown: [] };
    const { [scenarioId]: _gone, ...rest } = s.scatter; void _gone;
    return { scatter: rest, scatterShown: s.scatterShown.filter((r) => r.scenarioId !== scenarioId) };
  }),
  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),
  applyGlobeCommands: (cmds) => {
    const s = get();
    const { next, applied, errors } = reduceGlobeCommands(s, cmds);
    set({ mode: next.mode, markers: next.markers, ellipses: next.ellipses, arcs: next.arcs, scatterShown: next.scatterShown, layers: next.layers, flight: next.flight });
    return { applied, errors };
  },
}));
