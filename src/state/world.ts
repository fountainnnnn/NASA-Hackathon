/**
 * World store (Zustand) + the WorldFacade the agent tools act through.
 * Imports are relative (not "@/") so this file is unit-testable without a bundler alias.
 */
import { create } from 'zustand';
import { DEFAULT_CONSTRAINTS } from '../lib/contracts';
import type {
  ChatMessage, Dem, GeoApi, LayerId, MissionConstraints, RouteResult, SceneCommand,
  TraceStep, WorldFacade, WorldPoint, WorldSnapshot,
} from '../lib/contracts';
import { reduceCommands } from '../lib/scene/commands';
import type { DemBounds, SceneSlice } from '../lib/scene/commands';

export const BASE_LABEL = 'Base, Octavia E. Butler landing site (Perseverance sol 13)';
export const BASE_LONLAT = { lon: 77.45088572, lat: 18.44462715 };

export interface WorldRuntime { dem: Dem; geo: Pick<GeoApi, 'toLocal' | 'toLonLat' | 'sampleElevation'> }
let rt: WorldRuntime | null = null;

export interface ChatDisplay {
  id: string; role: 'user' | 'assistant' | 'system'; text: string; unverified?: string[]; offline?: boolean;
}
export interface Toast { id: number; kind: 'error' | 'info'; text: string }
export type SheetTab = 'layers' | 'mission' | 'route' | 'ask';

const DEFAULT_LAYERS: Record<LayerId, boolean> = {
  ctx: true, themisDay: false, themisNight: false, geology: false, slope: true, traverse: true, ellipse: false,
};
const DEFAULT_OPACITY: Record<LayerId, number> = {
  ctx: 1, themisDay: 0.7, themisNight: 0.7, geology: 0.6, slope: 0.6, traverse: 1, ellipse: 1,
};

export interface WorldState extends SceneSlice {
  ready: boolean;
  placeholder: boolean;
  bounds: DemBounds;
  selected: WorldPoint | null;
  base: WorldPoint | null;
  constraints: MissionConstraints;
  layerOpacity: Record<LayerId, number>;
  exaggeration: number;
  routeSeq: number;
  pointSeq: number;
  // agent chat UI
  messages: ChatDisplay[];
  history: ChatMessage[];
  trace: TraceStep[];
  busy: boolean;
  offline: boolean;
  // panels
  sourcesOpen: boolean;
  askOpen: boolean;
  drawerOpen: boolean;
  sheetTab: SheetTab;
  toasts: Toast[];
  // actions
  setLayer(id: LayerId, v: boolean): void;
  setOpacity(id: LayerId, v: number): void;
  setExaggeration(v: number): void;
  setProfileRoute(id: string | null): void;
  pushMessage(m: Omit<ChatDisplay, 'id'>): void;
  patch(p: Partial<WorldState>): void;
  toast(kind: Toast['kind'], text: string): void;
  dismissToast(id: number): void;
}

const EMPTY_BOUNDS: DemBounds = { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
let toastSeq = 0, msgSeq = 0;

export const useWorld = create<WorldState>((set, get) => ({
  ready: false, placeholder: false, bounds: EMPTY_BOUNDS,
  selected: null, base: null, constraints: { ...DEFAULT_CONSTRAINTS },
  layers: { ...DEFAULT_LAYERS }, layerOpacity: { ...DEFAULT_OPACITY }, exaggeration: 1.5,
  annotations: [], annSeq: 0, routes: {}, visibleRouteIds: [], routeStyles: {}, profileRouteId: null,
  comparison: null, cameraRequest: null, cameraTarget: null, routeSeq: 0, pointSeq: 0,
  messages: [], history: [], trace: [], busy: false, offline: false,
  sourcesOpen: false, askOpen: false, drawerOpen: false, sheetTab: 'layers', toasts: [],

  setLayer: (id, v) => set((s) => ({ layers: { ...s.layers, [id]: v } })),
  setOpacity: (id, v) => set((s) => ({ layerOpacity: { ...s.layerOpacity, [id]: Math.min(1, Math.max(0, v)) } })),
  setExaggeration: (v) => set({ exaggeration: Math.min(3, Math.max(1, v)) }),
  setProfileRoute: (id) => set({ profileRouteId: id, drawerOpen: id != null ? true : get().drawerOpen }),
  pushMessage: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: `m${++msgSeq}` }] })),
  patch: (p) => set(p),
  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/* ------------------------------------------------------------------ runtime wiring */

/** Called once the DEM is decoded. Seeds bounds and the default base. */
export function configureWorld(runtime: WorldRuntime, opts: { placeholder?: boolean } = {}) {
  rt = runtime;
  const m = runtime.dem.meta;
  const bounds = { lonMin: m.lonMin, lonMax: m.lonMax, latMin: m.latMin, latMax: m.latMax };
  useWorld.setState({ bounds, placeholder: !!opts.placeholder, ready: true });
  const base = world.makePoint(BASE_LONLAT.lon, BASE_LONLAT.lat, 'preset', BASE_LABEL);
  useWorld.setState({ base });
}

export function resetWorldForTests() {
  rt = null;
  useWorld.setState({
    ready: false, bounds: EMPTY_BOUNDS, selected: null, base: null, constraints: { ...DEFAULT_CONSTRAINTS },
    layers: { ...DEFAULT_LAYERS }, annotations: [], annSeq: 0, routes: {}, visibleRouteIds: [], routeStyles: {},
    profileRouteId: null, comparison: null, cameraRequest: null, cameraTarget: null, routeSeq: 0, pointSeq: 0,
    drawerOpen: false,
  });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function sceneSlice(s: WorldState): SceneSlice {
  return {
    annotations: s.annotations, annSeq: s.annSeq, layers: s.layers, routes: s.routes, visibleRouteIds: s.visibleRouteIds,
    routeStyles: s.routeStyles, profileRouteId: s.profileRouteId, comparison: s.comparison,
    cameraRequest: s.cameraRequest, cameraTarget: s.cameraTarget,
  };
}

/* ------------------------------------------------------------------ facade */

export const world: WorldFacade = {
  snapshot(): WorldSnapshot {
    const s = useWorld.getState();
    return {
      selected: s.selected, base: s.base, constraints: s.constraints, layers: s.layers,
      routes: Object.values(s.routes).map((r) => ({ id: r.id, label: r.label, feasible: r.feasible, reasons: r.reasons, totals: r.totals })),
      visibleRouteIds: s.visibleRouteIds, annotations: s.annotations, cameraTarget: s.cameraTarget, demBounds: s.bounds,
    };
  },

  setSelected(p) {
    useWorld.setState({ selected: p });
  },

  setBase(p) {
    useWorld.setState({ base: { ...p, label: p.label && p.label !== 'Selected point' ? p.label : 'Base (user-set)' } });
  },

  setConstraints(c) {
    const cur = useWorld.getState().constraints;
    const next = { ...cur };
    const num = (k: Exclude<keyof MissionConstraints, 'objective'>, lo: number, hi: number) => {
      const v = c[k];
      if (typeof v === 'number' && Number.isFinite(v)) next[k] = clamp(v, lo, hi);
    };
    num('maxSlopeDeg', 5, 40); num('batteryReservePct', 0, 80); num('evaMaxMin', 30, 480); num('dwellMin', 0, 180);
    num('suitPowerW', 20, 2000); num('batteryWh', 100, 20000); num('crewMassKg', 40, 400); num('suitSpeedFactor', 0.1, 1);
    if (c.objective === 'fastest' || c.objective === 'shortest') next.objective = c.objective;
    useWorld.setState({ constraints: next });
    return next;
  },

  addRoute(r) {
    const seq = useWorld.getState().routeSeq + 1;
    const route: RouteResult = { ...r, id: `R${seq}` };
    useWorld.setState((s) => ({ routes: { ...s.routes, [route.id]: route }, routeSeq: seq }));
    return route;
  },

  getRoute(id) {
    return useWorld.getState().routes[id];
  },

  applyCommands(cmds: SceneCommand[]) {
    const s = useWorld.getState();
    const out = reduceCommands(sceneSlice(s), cmds, s.bounds);
    const n = out.state;
    const opensDrawer =
      n.profileRouteId !== s.profileRouteId || n.comparison !== s.comparison || n.visibleRouteIds.length > s.visibleRouteIds.length;
    useWorld.setState({ ...n, drawerOpen: opensDrawer && n.visibleRouteIds.length > 0 ? true : s.drawerOpen });
    return { applied: out.applied, errors: out.errors };
  },

  makePoint(lon, lat, source, label) {
    if (!rt) throw new Error('world not configured: DEM not loaded');
    const meta = rt.dem.meta;
    const { x, z } = rt.geo.toLocal(meta, lon, lat);
    const elevationM = rt.geo.sampleElevation(rt.dem, lon, lat); // true DEM, not the exaggerated mesh
    const seq = useWorld.getState().pointSeq + 1;
    useWorld.setState({ pointSeq: seq });
    return { id: `P${seq}`, lon, lat, elevationM, x, z, source, label };
  },
};
