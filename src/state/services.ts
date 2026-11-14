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
  AgentApi, ContextMeta, Dem, DemMeta, GeoApi, GeologyFile, LayerInfo, RoverImage, ScienceApi, TerrainApi,
  ToolDeps, TraverseFile, WorldPoint,
} from '@/lib/contracts';
import { loadEarthLink } from '@/lib/ops/earthLink';
import type { EarthLinkData } from '@/lib/ops/earthLink';
import { createGlobalScience } from '@/lib/globalSci';
import type { GlobalScienceApi } from '@/lib/globalSci';
import { enableScenarioWasm, jezeroSlopeSource, registerScenarioSources } from '@/lib/scenario';
import { useGlobeStore } from './globe';
import { decodeDem, sampleElevation, toLocal, toLonLat } from '@/lib/geo/frame';
import { createTerrainClient } from '@/lib/terrain/client';
import { executeTool as runnerExecuteTool, runAgentTurn } from '@/lib/agent/runner';
import { createScience } from '@/lib/science';
import { fetchWithProgress, loadImageTexture, makePaletteTexture, makeSlopeTexture } from '@/lib/scene/textures';
import { makePlaceholderDem, PLACEHOLDER_LABEL } from '@/lib/scene/placeholder';
import { configureWorld, useWorld, world } from './world';
import type { ContextData } from '@/components/Scene/contextGrid';

export const UNAVAILABLE = 'Copilot unavailable right now. Clicks and actions still work.';

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
  /** Regional MOLA + CTX-mosaic context around the CTX DEM (null if it failed to load or in placeholder mode). */
  context: ContextData | null;
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

/** Regional context terrain (MOLA grid + CTX global mosaic crop). Optional: any failure just leaves the apron out. */
async function loadContext(): Promise<ContextData | null> {
  try {
    const meta = await getJson<ContextMeta>('/data/context_meta.json');
    const [buf, texture] = await Promise.all([
      fetchWithProgress(`/data/${meta.file}`),
      loadImageTexture(`/data/${meta.imageFile}`, 'color'),
    ]);
    return { meta, dem: decodeDem(meta, buf), texture };
  } catch (e) {
    console.warn('[services] regional context terrain unavailable', e);
    return null;
  }
}

/** Fetch the DEM; gunzip it in the browser, or fall back to the plain dem.i16 when DecompressionStream is missing. */
async function loadDemBuffer(meta: DemMeta): Promise<{ meta: DemMeta; buf: ArrayBuffer }> {
  const onProgress = (f: number | null) => step('dem', { progress: f ?? 0 });
  if (meta.encoding.compression === 'gzip') {
    if (typeof DecompressionStream !== 'undefined') {
      const gz = await fetchWithProgress(`/data/${meta.file}`, onProgress);
      const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
      return { meta, buf: await new Response(stream).arrayBuffer() };
    }
    const { delta: _d, compression: _c, ...enc } = meta.encoding;
    const plain = { ...meta, file: 'dem.i16', encoding: enc };
    return { meta: plain, buf: await fetchWithProgress('/data/dem.i16', onProgress) };
  }
  return { meta, buf: await fetchWithProgress(`/data/${meta.file}`, onProgress) };
}

async function loadAll() {
  // 1. DEM
  step('dem', { status: 'active', progress: 0 });
  let meta: DemMeta, dem: Dem, placeholder = false;
  let demBuf: ArrayBuffer;
  try {
    meta = await getJson<DemMeta>('/data/dem_meta.json');
    ({ meta, buf: demBuf } = await loadDemBuffer(meta));
    dem = decodeDem(meta, demBuf);
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
      registerScenarioSources({ jezero20m: jezeroSlopeSource(dem, slope) }); // landing scenarios inside Jezero use the 20 m slopes
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

  let context: ContextData | null = null;
  const contextJob = async () => { context = placeholder ? null : await loadContext(); };

  const [science] = await Promise.all([
    scienceJob(), contextJob(),
    texJob().then(() => step('textures', { status: 'done', progress: 1 })),
    dataJob(), terrainJob(),
  ]);

  const slopeTexture = slope ? makeSlopeTexture(slope, meta.width, meta.height) : null;
  const rt: Runtime = {
    meta, dem, geo: geoApi, terrain, science, agent, layers, geologyUnits: [], ellipse: null, traverse, textures, paletteTexture: null,
    slopeTexture, context, placeholder,
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

/* ------------------------------------------------------------------ global (whole planet) science */

/** Global dataset (public/data/global). `gs` is null until loaded; `error` explains a failed load (no verified data then). */
export const useGlobal = create<{ gs: GlobalScienceApi | null; error: string | null; earth: EarthLinkData | null }>(() => ({ gs: null, error: null, earth: null }));

let globalJob: Promise<void> | null = null;
export function startGlobalLoading(): Promise<void> {
  if (!globalJob) {
    globalJob = (async () => {
      enableScenarioWasm(); // Rust/WASM landing Monte Carlo; falls back to the TypeScript engine on any failure
      // JPL Horizons light time and Earth in the Jezero sky; optional, the app works without it
      loadEarthLink((...a) => fetch(...a)).then((earth) => useGlobal.setState({ earth })).catch(() => { /* no Earth line then */ });
      try {
        const gs = createGlobalScience();
        await gs.load();
        useGlobal.setState({ gs, error: null });
      } catch (e) {
        console.warn('[services] global science failed to load', e);
        useGlobal.setState({ gs: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }
  return globalJob;
}

/* ------------------------------------------------------------------ tool access for the UI */

const noTerrain: TerrainApi = {
  init: () => Promise.reject(new Error('Terrain engine is not ready.')),
  planRoute: () => Promise.reject(new Error('Terrain engine is not ready.')),
  analyze: () => Promise.reject(new Error('Terrain engine is not ready.')),
  hazards: () => Promise.reject(new Error('Terrain engine is not ready.')),
  slopeField: () => Promise.reject(new Error('Terrain engine is not ready.')),
};

/** Same object the LLM tools get: world, terrain, science, globe facade and global science. Safe before Jezero has loaded. */
export function toolDeps(): ToolDeps {
  const rt = useRuntime.getState().rt;
  const gs = useGlobal.getState().gs;
  return {
    world,
    terrain: rt?.terrain ?? noTerrain,
    science: rt?.science ?? offlineScience,
    globe: {
      applyGlobeCommands: (c) => useGlobeStore.getState().applyGlobeCommands(c),
      snapshot: () => {
        const g = useGlobeStore.getState();
        return { mode: g.mode, clicked: g.clicked ? { lon: g.clicked.lon, lat: g.clicked.lat } : null, hovered: g.hovered };
      },
    },
    globalSci: gs ?? undefined,
  };
}

/** Deterministic path (no LLM): the same executor the copilot uses. Throws with the tool's message on a tool error. */
export async function callTool<T = Record<string, unknown>>(name: string, args: unknown): Promise<T> {
  const out = (await runnerExecuteTool(name, args, toolDeps())) as T & { error?: string; message?: string };
  if (out && typeof out === 'object' && 'error' in out && out.error) throw new Error(out.message || String(out.error));
  return out;
}

export async function roverImagesFor(p: WorldPoint): Promise<RoverImage[]> {
  const rt = useRuntime.getState().rt;
  if (!rt) return [];
  try {
    const r = await rt.science.roverImagesNear({ lon: p.lon, lat: p.lat }, 2000, 4);
    return r?.images ?? [];
  } catch { return []; }
}

/** Download the GeoJSON mission plan for a route. */
export async function exportPlan(routeId: string) {
  const r = await callTool<{ geojson: unknown; filename: string }>('export_mission_plan', { routeId });
  const url = URL.createObjectURL(new Blob([JSON.stringify(r.geojson, null, 2)], { type: 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url; a.download = r.filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
