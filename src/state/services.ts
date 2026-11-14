/**
 * Integration seam: the ONLY file that imports other agents' modules.
 *
 * Expected exports (orchestrator: fix names here if they differ):
 *   @/lib/geo/frame        decodeDem(meta, buf): Dem · toLocal · toLonLat · sampleElevation          (present)
 *   @/lib/terrain/client   createTerrainClient(): TerrainApi                                          (present)
 *   @/lib/science          createScience(): ScienceApi                                                (present)
 *   @/lib/agent/runner     runAgentTurn, executeTool                                                  (present)
 *
 * Tool names the HUD buttons call: plan_route, find_hazard_segments, get_location_context,
 * analyze_terrain, export_mission_plan (all present in tools.ts).
 */
import * as THREE from 'three';
import { create } from 'zustand';
import type {
  AgentApi, ChatMessage, Dem, DemMeta, GeoApi, GeologyFile, LayerInfo, RoverImage, ScienceApi, ScienceSite, TerrainApi,
  ToolDeps, TraverseFile, WorldPoint,
} from '@/lib/contracts';
import { decodeDem, sampleElevation, toLocal, toLonLat } from '@/lib/geo/frame';
import { createTerrainClient } from '@/lib/terrain/client';
import { executeTool as runnerExecuteTool, runAgentTurn } from '@/lib/agent/runner';
import { createScience } from '@/lib/science';
import { fetchWithProgress, loadImageTexture, makePaletteTexture, makeSlopeTexture } from '@/lib/scene/textures';
import { makePlaceholderDem, PLACEHOLDER_LABEL } from '@/lib/scene/placeholder';
import { configureWorld, useWorld, world } from './world';

export const UNAVAILABLE = 'Copilot unavailable right now. The buttons still work.';

export type TexId = 'ctx' | 'themisDay' | 'themisNight' | 'geology';
export interface GeologyUnit { symbol: string; name: string; color: string }

export interface Runtime {
  meta: DemMeta;
  dem: Dem;
  geo: GeoApi;
  terrain: TerrainApi | null;
  science: ScienceApi;
  agent: AgentApi;
  layers: LayerInfo[];
  geologyUnits: GeologyUnit[];
  ellipse: [number, number][][] | null;
  traverse: TraverseFile | null;
  textures: Partial<Record<TexId, THREE.Texture>>;
  paletteTexture: THREE.Texture | null;
  slopeTexture: THREE.Texture | null;
  placeholder: boolean;
}

export interface LoadStep { id: string; label: string; progress: number | null; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }

export const useRuntime = create<{
  rt: Runtime | null; steps: LoadStep[]; error: string | null; geologyState: 'idle' | 'loading' | 'ready' | 'error';
  setStep(id: string, p: Partial<LoadStep>): void;
}>((set) => ({
  rt: null,
  error: null,
  geologyState: 'idle',
  steps: [
    { id: 'dem', label: 'Terrain model (MRO CTX DEM)', progress: 0, status: 'pending' },
    { id: 'textures', label: 'Imagery and map layers', progress: 0, status: 'pending' },
    { id: 'terrain', label: 'Route engine (worker)', progress: 0, status: 'pending' },
    { id: 'science', label: 'Geology, names, traverse', progress: 0, status: 'pending' },
  ],
  setStep: (id, p) => set((s) => ({ steps: s.steps.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
}));

const geoApi: GeoApi = { toLocal, toLonLat, sampleElevation };
const step = (id: string, p: Partial<LoadStep>) => useRuntime.getState().setStep(id, p);

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/* ------------------------------------------------------------------ module guards */

const offlineScience: ScienceApi = {
  load: async () => {},
  geologyAt: () => null,
  namesNear: () => [],
  nearestTraverse: () => null,
  sitesNear: () => [],
  suggestStops: () => [],
  roverImagesNear: async () => null,
  unitList: () => [],
};

async function loadScience(): Promise<ScienceApi> {
  try {
    const api = createScience();
    await api.load();
    return api;
  } catch (e) {
    console.warn('[services] science data failed to load, using empty stub', e);
    useWorld.getState().toast('error', 'Science data failed to load. Geology and names are unavailable.');
    return offlineScience;
  }
}

function loadAgent(): AgentApi {
  return { runAgentTurn, executeTool: runnerExecuteTool };
}

/* ------------------------------------------------------------------ loading */

let loading: Promise<void> | null = null;
export function startLoading(): Promise<void> {
  if (!loading) loading = loadAll().catch((e) => {
    useRuntime.setState({ error: e instanceof Error ? e.message : String(e) });
    loading = null;
  });
  return loading;
}

const isDev = process.env.NODE_ENV !== 'production';

async function loadAll() {
  // 1. DEM
  step('dem', { status: 'active', progress: 0 });
  let meta: DemMeta, dem: Dem, placeholder = false;
  try {
    meta = await getJson<DemMeta>('/data/dem_meta.json');
    const buf = await fetchWithProgress(`/data/${meta.file}`, (f) => step('dem', { progress: f }));
    dem = decodeDem(meta, buf);
  } catch (e) {
    if (!isDev) { step('dem', { status: 'error', detail: String(e) }); throw new Error(`Could not load the terrain model: ${e instanceof Error ? e.message : e}`); }
    console.warn(`[services] ${PLACEHOLDER_LABEL}`, e);
    dem = makePlaceholderDem();
    meta = dem.meta;
    placeholder = true;
  }
  step('dem', { status: 'done', progress: 1, detail: placeholder ? PLACEHOLDER_LABEL : undefined });
  configureWorld({ dem, geo: geoApi }, { placeholder });

  const terrain = createTerrainClient();
  const agent = loadAgent();

  // 2. everything else in parallel
  const progress: Record<string, number> = {};
  const texProgress = (k: string) => (f: number | null) => {
    if (f != null) progress[k] = f;
    const v = Object.values(progress);
    step('textures', { progress: v.length ? v.reduce((a, b) => a + b, 0) / 3 : 0 });
  };

  step('textures', { status: 'active' });
  const textures: Runtime['textures'] = {};
  const texJob = async () => {
    if (placeholder) return;
    const one = async (id: TexId, file: string, kind: 'color' | 'data' | 'index') => {
      try { textures[id] = await loadImageTexture(`/data/${file}`, kind, texProgress(id)); }
      catch (e) { console.warn(`[services] texture ${file} unavailable`, e); progress[id] = 1; useWorld.getState().toast('error', `Layer image ${file} could not be loaded.`); }
    };
    await Promise.all([
      (async () => {
        try { textures.ctx = await loadImageTexture('/data/ctx_2048.jpg', 'color', texProgress('ctx')); }
        catch { await one('ctx', 'ctx.jpg', 'color'); }
      })(),
      one('themisDay', 'themis_day.png', 'data'),
      one('themisNight', 'themis_night.png', 'data'),
    ]);
  };

  let layers: LayerInfo[] = [];
  let traverse: TraverseFile | null = null;
  const dataJob = async () => {
    try {
      const l = await getJson<LayerInfo[] | { layers: LayerInfo[] }>('/data/layers.json');
      layers = Array.isArray(l) ? l : l.layers;
    } catch (e) { console.warn('[services] layers.json unavailable', e); }
    try { traverse = await getJson<TraverseFile>('/data/traverse.json'); } catch (e) { console.warn('[services] traverse.json unavailable', e); }
  };

  let slope: Float32Array | null = null;
  const terrainJob = async () => {
    step('terrain', { status: 'active', progress: 0.1 });
    try {
      await terrain.init(dem);
      step('terrain', { progress: 0.6 });
      slope = await terrain.slopeField();
      step('terrain', { status: 'done', progress: 1 });
    } catch (e) {
      console.warn('[services] terrain engine failed', e);
      step('terrain', { status: 'error', detail: String(e) });
      useWorld.getState().toast('error', 'Route engine failed to start. Routes and slope overlay are unavailable.');
    }
  };

  const scienceJob = async () => {
    step('science', { status: 'active', progress: 0.2 });
    const s = await loadScience();
    step('science', { status: 'done', progress: 1 });
    return s;
  };

  const [science] = await Promise.all([
    scienceJob(),
    texJob().then(() => step('textures', { status: 'done', progress: 1 })),
    dataJob(), terrainJob(),
  ]);

  const slopeTexture = slope ? makeSlopeTexture(slope, meta.width, meta.height) : null;
  const rt: Runtime = {
    meta, dem, geo: geoApi, terrain, science, agent, layers, geologyUnits: [], ellipse: null, traverse, textures, paletteTexture: null,
    slopeTexture, placeholder,
  };
  useRuntime.setState({ rt });

  // 3. after the first rendered frames, desktop only: upgrade CTX to the full-resolution mosaic
  if (!placeholder && textures.ctx && window.matchMedia('(min-width: 701px)').matches) {
    setTimeout(() => {
      loadImageTexture('/data/ctx.jpg', 'color').then((hi) => {
        const cur = useRuntime.getState().rt;
        if (!cur) return;
        cur.textures.ctx?.dispose();
        useRuntime.setState({ rt: { ...cur, textures: { ...cur.textures, ctx: hi } } });
      }).catch(() => { /* keep the 2048 version */ });
    }, 1500);
  }

  // geology (json + index texture) and the landing ellipse load the first time a layer needs them
  useWorld.subscribe((st) => { if (st.layers.geology || st.layers.ellipse) void ensureGeology(); });
  if (useWorld.getState().layers.ellipse) void ensureGeology();
}

let geologyJob: Promise<void> | null = null;
/** Lazy: geology.json (palette, unit order, ellipse) + geology_idx.png. Safe to call repeatedly. */
export function ensureGeology(): Promise<void> {
  if (geologyJob) return geologyJob;
  const rt0 = useRuntime.getState().rt;
  if (!rt0 || rt0.placeholder) return Promise.resolve();
  useRuntime.setState({ geologyState: 'loading' });
  geologyJob = (async () => {
    try {
      const g = await getJson<GeologyFile & { unitOrder?: string[] }>('/data/geology.json');
      const order = g.unitOrder ?? Object.keys(g.units);
      const geologyUnits = order.map((k) => ({ symbol: g.units[k]?.symbol ?? k, name: g.units[k]?.name ?? k, color: g.units[k]?.color ?? '#999999' }));
      const geo = await loadImageTexture('/data/geology_idx.png', 'index');
      const cur = useRuntime.getState().rt!;
      useRuntime.setState({
        geologyState: 'ready',
        rt: { ...cur, geologyUnits, ellipse: g.ellipse ?? null, paletteTexture: makePaletteTexture(geologyUnits.map((u) => u.color)), textures: { ...cur.textures, geology: geo } },
      });
    } catch (e) {
      console.warn('[services] geology unavailable', e);
      useRuntime.setState({ geologyState: 'error' });
      useWorld.getState().toast('error', 'Geology layer could not be loaded.');
    }
  })();
  return geologyJob;
}

/** One-click presets: if nothing is selected, pick the Skinner Ridge delta site from science_sites.json. */
export async function ensureDefaultSelection(): Promise<boolean> {
  if (S().selected) return true;
  try {
    const raw = await getJson<ScienceSite[] | { sites: ScienceSite[] }>('/data/science_sites.json');
    const sites = Array.isArray(raw) ? raw : raw.sites;
    const site = sites.find((x) => /skinner/i.test(x.id + x.name)) ?? sites.find((x) => x.objectives.includes('delta-sediments')) ?? sites[0];
    if (!site) return false;
    const p = world.makePoint(site.lon, site.lat, 'preset', site.name);
    world.setSelected(p);
    world.applyCommands([{ type: 'focus_camera', lon: p.lon, lat: p.lat, distanceM: 3500 }]);
    return true;
  } catch { return false; }
}

/* ------------------------------------------------------------------ tool access for the UI */

export function toolDeps(): ToolDeps {
  const rt = useRuntime.getState().rt;
  if (!rt || !rt.terrain) throw new Error('Terrain engine is not ready.');
  return { world, terrain: rt.terrain, science: rt.science };
}

async function callTool<T = Record<string, unknown>>(name: string, args: unknown): Promise<T> {
  const rt = useRuntime.getState().rt;
  if (!rt) throw new Error('Still loading.');
  const out = (await rt.agent.executeTool(name, args, toolDeps())) as T & { error?: string; message?: string };
  if (out && typeof out === 'object' && 'error' in out && out.error) throw new Error(out.message || String(out.error));
  return out;
}

const S = () => useWorld.getState();
const guard = async (fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { S().toast('error', e instanceof Error ? e.message : 'Something went wrong.'); }
};

/** "Plan round trip to selection" — deterministic, same executor the LLM uses; the tool draws the route itself. */
export const planRoundTripToSelection = () => guard(async () => {
  if (!S().selected) { S().toast('info', 'Click the terrain to select a destination first.'); return; }
  const r = await callTool<{ id: string; feasible: boolean; reasonText: string[] }>('plan_route', { to: 'selected', roundTrip: true });
  S().patch({ drawerOpen: true, sheetTab: 'route' });
  if (!r.feasible) S().toast('info', r.reasonText?.[0] ?? 'Route is not feasible under the current limits.');
});

/** "Show steepest stretch" — hazards of the active route, drawn as numbered red highlights. */
export const showSteepestStretch = () => guard(async () => {
  const st = S();
  const routeId = st.profileRouteId ?? st.visibleRouteIds[st.visibleRouteIds.length - 1];
  if (!routeId) { st.toast('info', 'Plan a route first, then ask for its steepest stretch.'); return; }
  const r = await callTool<{ segments: { leg: number; startIdx: number; endIdx: number; maxSlopeDeg: number; lengthM: number }[] }>('find_hazard_segments', { routeId, k: 3 });
  if (!r.segments.length) { S().toast('info', 'No hazard segments were returned for this route.'); return; }
  const old = S().annotations.filter((a) => a.kind === 'highlight' && a.highlight?.routeId === routeId);
  const res = world.applyCommands([
    ...old.map((a) => ({ type: 'remove_annotation' as const, id: a.id })),
    ...r.segments.map((s, i) => ({
      type: 'highlight_segment' as const, routeId, leg: s.leg, startIdx: s.startIdx, endIdx: s.endIdx,
      label: `Steep stretch ${i + 1}: up to ${s.maxSlopeDeg.toFixed(1)}° over ${Math.round(s.lengthM)} m`,
    })),
  ]);
  if (res.errors.length) S().toast('error', res.errors[0]);
});

function describeContext(ctx: Record<string, unknown>, ana: Record<string, unknown> | null): string {
  const lines: string[] = [];
  const pt = ctx.point as { lon: number; lat: number } | undefined;
  if (pt) lines.push(`Location ${pt.lat}, ${pt.lon}`);
  lines.push(`Elevation: ${ctx.elevationM == null ? 'no data' : `${ctx.elevationM} m above the areoid`}`);
  const g = ctx.geology as { symbol: string; name: string; interpretation: string } | null;
  lines.push(g ? `Geology (USGS): ${g.name} (${g.symbol}). ${g.interpretation}` : 'Geology: no verified data here.');
  const n = (ctx.namedFeaturesNear as { name: string; type: string; distanceKm: number }[]) ?? [];
  if (n.length) lines.push(`Nearby: ${n.slice(0, 3).map((x) => `${x.name} (${x.type}, ${x.distanceKm} km)`).join('; ')}`);
  const t = ctx.nearestRoverTraverse as { sol: number; distanceM: number } | null;
  if (t) lines.push(`Nearest Perseverance traverse point: sol ${t.sol}, ${t.distanceM} m away`);
  if (ana) {
    lines.push(`Terrain within ${ana.radiusM} m: mean slope ${ana.slopeMeanDeg}°, 90th percentile ${ana.slopeP90Deg}°, max ${ana.slopeMaxDeg}°; ${ana.pctAboveLimit}% steeper than the ${ana.limitDeg}° limit; relief ${ana.reliefM} m.`);
  }
  return lines.join('\n');
}

/** "What's here?" — deterministic summary of the selected point shown in the Ask panel. */
export const whatsHere = () => guard(async () => {
  if (!S().selected) { S().toast('info', 'Click the terrain to select a point first.'); return; }
  S().patch({ askOpen: true, sheetTab: 'ask' });
  S().pushMessage({ role: 'user', text: "What's here?" });
  const [ctx, ana] = await Promise.all([
    callTool('get_location_context', { target: 'selected' }),
    callTool('analyze_terrain', { target: 'selected', radiusM: 500 }).catch(() => null),
  ]);
  S().pushMessage({ role: 'assistant', text: describeContext(ctx, ana) });
});

/** Free-text question to the LLM copilot. */
export async function askCopilot(text: string) {
  const st = S();
  const rt = useRuntime.getState().rt;
  if (st.busy || !text.trim() || !rt) return;
  st.pushMessage({ role: 'user', text });
  st.patch({ busy: true, trace: [], askOpen: true });
  try {
    const res = await rt.agent.runAgentTurn({
      userText: text, history: st.history as ChatMessage[], deps: toolDeps(),
      onTrace: (steps) => S().patch({ trace: steps }),
    });
    S().pushMessage({
      role: 'assistant',
      text: res.text || (res.offline || res.error ? UNAVAILABLE : 'No answer was returned.'),
      unverified: res.unverifiedNumbers, offline: res.offline || (!res.text && !!res.error),
    });
    // 503 agent_offline and 429 rate_limited both land here: one calm message, buttons keep working
    S().patch({ history: res.history, trace: res.trace, offline: res.offline || (!res.text && !!res.error) });
  } catch (e) {
    S().patch({ offline: true });
    S().pushMessage({ role: 'assistant', text: UNAVAILABLE, offline: true });
    console.warn('[services] runAgentTurn failed', e);
  } finally {
    S().patch({ busy: false });
  }
}

/** Download the GeoJSON mission plan for a route. */
export const exportPlan = (routeId: string) => guard(async () => {
  const r = await callTool<{ geojson: unknown; filename: string }>('export_mission_plan', { routeId });
  const url = URL.createObjectURL(new Blob([JSON.stringify(r.geojson, null, 2)], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = r.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

export async function roverImagesFor(p: WorldPoint): Promise<RoverImage[]> {
  const rt = useRuntime.getState().rt;
  if (!rt) return [];
  try {
    const r = await rt.science.roverImagesNear({ lon: p.lon, lat: p.lat }, 2000, 4);
    return r?.images ?? [];
  } catch { return []; }
}
