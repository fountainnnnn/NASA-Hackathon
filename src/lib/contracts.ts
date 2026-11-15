/**
 * MarsWalk Copilot — shared contracts. SINGLE SOURCE OF TRUTH for types crossing module
 * boundaries. Modules: scripts (data prep), lib/geo, lib/terrain, lib/science, state, scene,
 * agent, components. Change this file only via the orchestrator.
 *
 * Conventions (all modules):
 *  - Body: Mars 2000 sphere, radius R_MARS = 3_396_190 m.
 *  - Longitude: planetocentric, POSITIVE EAST, range -180..180. Latitude: planetocentric.
 *  - Elevation: metres above the Mars areoid (MOLA geoid), as delivered by the CTX DEM.
 *  - Local scene frame (metres): origin at DEM centre (lonC, latC), elevation reference hRef.
 *      x = R·cos(latC)·(lon − lonC)·π/180   (east)
 *      z = −R·(lat − latC)·π/180            (south is +z, matching three.js)
 *      y = (h − hRef)·exaggeration          (up)
 *  - Distances in analysis use per-row ground spacing: dx = R·cos(lat_row)·Δlon_rad, dy = R·Δlat_rad.
 */

export const R_MARS = 3_396_190;
export const G_MARS = 3.721; // m/s², NASA Mars Fact Sheet

/* ---------------------------------------------------------------- data files (public/data) */

/** public/data/dem_meta.json — written by scripts/prepare-data.mjs */
export interface DemMeta {
  productLabel: string;          // Mars Trek product label
  sourceUrl: string;
  width: number;                 // columns of the stored grid (native 20 m posting)
  height: number;                // rows
  /** Outer EDGES of the grid (not pixel centres), degrees. Row 0 = north edge (latMax). */
  lonMin: number; lonMax: number; latMin: number; latMax: number;
  /** Degrees per pixel. Pixel (c, r) centre lon = lonMin + (c + 0.5)·dLon; lat = latMax − (r + 0.5)·dLat. */
  dLon: number; dLat: number;
  nominalResM: number;           // 20
  /** Stored as little-endian Int16 in public/data/dem.i16 ; elevation = offset + scale·v ; v === nodata → NaN */
  encoding: { type: 'int16le'; scale: number; offset: number; nodata: -32768; delta?: 'row'; compression?: 'gzip' };
  file: string;                  // "dem.i16.gz" (dem.i16 is the plain fallback)
  elevMin: number; elevMax: number; // metres, valid cells only
  hRef: number;                  // scene elevation reference (median of valid cells), metres
  datum: string;                 // "Mars 2000 sphere R=3396190 m; heights above areoid"
}

/** public/data/layers.json — every raster texture is cropped EXACTLY to the DEM outer edges,
 *  so uv = ((lon−lonMin)/(lonMax−lonMin), (latMax−lat)/(latMax−latMin)). */
export interface LayerInfo {
  id: LayerId;
  file: string;                  // e.g. "ctx.jpg"
  width: number; height: number;
  title: string;                 // "MRO CTX visible mosaic (6 m)"
  mission: string;               // "Mars Reconnaissance Orbiter"
  instrument: string;            // "Context Camera (CTX)"
  kind: 'optical' | 'thermal' | 'topographic' | 'geologic' | 'derived';
  provenance: Provenance;
  sourceUrl: string;
  credit: string;
  note?: string;                 // e.g. "relative brightness, uncalibrated"
  simulated?: boolean;           // true => render "Simulated — not NASA data" badge
}
export type LayerId = 'ctx' | 'themisDay' | 'themisNight' | 'geology' | 'slope' | 'traverse' | 'ellipse';

export type Provenance = 'observed' | 'computed' | 'assumption' | 'unavailable' | 'estimate' | 'mock';

/** public/data/geology.json — USGS SIM 3464 units reprojected to lon/lat (east-positive). */
export interface GeologyFile {
  source: { title: string; authors: string; year: number; url: string; scale: string };
  units: Record<string, { symbol: string; name: string; description: string; interpretation: string; color: string }>;
  /** Each polygon: outer ring + holes, [lon, lat] pairs. unit = key into units. */
  polygons: { unit: string; rings: [number, number][][]; bbox: [number, number, number, number] }[];
  ellipse?: [number, number][][]; // landing ellipse rings
}

/** public/data/traverse.json — Perseverance waypoints (NASA MMGIS) clipped to DEM bounds. */
export interface TraverseFile {
  source: { title: string; url: string };
  points: { sol: number; lon: number; lat: number; elevGeoid: number; distTotalM: number }[];
}

/** public/data/nomenclature.json — IAU names within DEM bounds (from Mars Trek search). */
export interface NomenclatureFile {
  source: { title: string; url: string };
  features: { name: string; type: string; lon: number; lat: number; diameterKm?: number; origin?: string }[];
}

/** public/data/science_sites.json — curated, every entry backed by a NASA URL. */
export interface ScienceSite {
  id: string; name: string; lon: number; lat: number;
  summary: string;               // 1–2 sentences paraphrasing the source, no claims beyond it
  objectives: ScienceObjective[];
  sourceUrl: string; sourceTitle: string; mission: string; date?: string;
  coordinateSource: string;      // e.g. "Perseverance waypoint sol 13" or "IAU nomenclature"
}
export type ScienceObjective = 'delta-sediments' | 'crater-floor' | 'rim-bedrock' | 'aeolian' | 'astrobiology-samples';

/** public/data/rover_cache/<sol>.json */
export interface RoverImage {
  id: string; sol: number; earthDate: string; camera: string; cameraFull: string;
  url: string;                   // medium/large jpg
  pageUrl?: string;              // mars.nasa.gov page
  credit: string;                // "NASA/JPL-Caltech"
  /** Spacecraft clock at exposure, s (raw API extended.sclk; else read from the image id). */
  sclk?: number;
  /** Remote sensing mast pointing at exposure, degrees (raw API extended.mastEl / mastAz); 0 = level, negative = down. */
  mastElDeg?: number;
  mastAzDeg?: number;
}

/* ---------------------------------------------------------------- world model */

export interface LonLat { lon: number; lat: number }

export interface WorldPoint extends LonLat {
  id: string;
  elevationM: number | null;     // sampled from DEM (NOT the exaggerated mesh); null = nodata
  x: number; z: number;          // local scene metres
  source: 'pick' | 'agent' | 'preset';
  label?: string;
}

export interface MissionConstraints {
  maxSlopeDeg: number;           // default 15
  batteryReservePct: number;     // default 20
  objective: RouteObjective;     // default 'fastest'
  evaMaxMin: number;             // default 360   (assumption)
  dwellMin: number;              // default 30    (assumption)
  suitPowerW: number;            // default 250   (assumption)
  batteryWh: number;             // default 2000  (assumption)
  crewMassKg: number;            // default 180   (crew + suit + kit, assumption)
  suitSpeedFactor: number;       // default 0.6   (fraction of Tobler speed, assumption)
}
export type RouteObjective = 'shortest' | 'fastest';

export const DEFAULT_CONSTRAINTS: MissionConstraints = {
  maxSlopeDeg: 15, batteryReservePct: 20, objective: 'fastest', evaMaxMin: 360, dwellMin: 30,
  suitPowerW: 250, batteryWh: 2000, crewMassKg: 180, suitSpeedFactor: 0.6,
};

/* ---------------------------------------------------------------- terrain engine (lib/terrain) */

/** Planning grid passed to the worker (built from the 20 m DEM). */
export interface PlanningGrid {
  width: number; height: number;
  lonMin: number; latMax: number; dLon: number; dLat: number; // of the planning grid
  elev: Float32Array;            // metres, NaN = nodata
  slopeMaxDeg: Float32Array;     // conservative max slope of 20 m sub-cells, NaN = nodata
  cellResM: number;              // nominal (40)
}

export interface RouteLeg {
  path: (LonLat & { h: number })[];  // densified vertices along the grid path (cell centres)
  lengthM: number;                   // 3D length = sum of segment lengths (tested)
  horizM: number;
  ascentM: number; descentM: number;
  maxSlopeDeg: number;               // max |edge grade| along path (tested vs independent recompute)
  timeMin: number;                   // walking time under assumed speed model
  segSlopeDeg: number[];             // per segment, length = path.length − 1
}

export type InfeasibleReason = 'no_path_slope' | 'battery_reserve' | 'eva_time' | 'nodata_endpoint' | 'out_of_bounds';

export interface RouteResult {
  id: string;                        // "R1", "R2"… assigned by state
  label: string;
  from: WorldPoint; to: WorldPoint; stops?: WorldPoint[];
  roundTrip: boolean;
  legs: RouteLeg[];                  // outbound, [stops…], return
  totals: { lengthM: number; ascentM: number; descentM: number; maxSlopeDeg: number; walkMin: number; evaMin: number; batteryUsedPct: number; climbWorkKJ: number };
  feasible: boolean;
  reasons: InfeasibleReason[];
  /** When no_path_slope: smallest maxSlopeDeg (≤45, 1° steps) that would yield a path, or null. */
  minFeasibleSlopeDeg?: number | null;
  /** Steepest 20 m cell inside the target's 40 m planning cell, deg (what the solver judged at the target). */
  targetSlopeDeg?: number;
  turnBackIndex?: { leg: number; vertex: number } | null; // where reserve would be hit if infeasible by battery
  constraintsUsed: MissionConstraints;
  gridResM: number; demResM: number;
  computeMs: number;
}

export interface HazardSegment {
  routeId: string; leg: number; startIdx: number; endIdx: number;
  lengthM: number; meanSlopeDeg: number; maxSlopeDeg: number;
  start: LonLat; end: LonLat;
  kind: 'steep' | 'slow';
}

export interface TerrainAnalysis {
  center: LonLat; radiusM: number;
  elevationM: number | null; reliefM: number;
  slopeMeanDeg: number; slopeP90Deg: number; slopeMaxDeg: number;
  pctAboveLimit: number; limitDeg: number;
  validPct: number; demResM: number;
  note: string;
}

/* ---------------------------------------------------------------- scene commands (allowlisted) */

export type SceneCommand =
  | { type: 'add_pin'; id?: string; lon: number; lat: number; label: string; kind: 'science' | 'hazard' | 'info' | 'base' }
  | { type: 'draw_route'; routeId: string; style?: 'primary' | 'alternate' }
  | { type: 'highlight_segment'; routeId: string; leg: number; startIdx: number; endIdx: number; label: string }
  | { type: 'show_elevation_profile'; routeId: string }
  | { type: 'focus_camera'; lon: number; lat: number; distanceM?: number }
  | { type: 'set_layer_visibility'; layer: LayerId; visible: boolean }
  | { type: 'remove_annotation'; id: string }
  | { type: 'show_comparison'; routeIds: [string, string] }
  | { type: 'clear_annotations' };

export interface Annotation {
  id: string;
  kind: 'pin' | 'highlight';
  lon: number; lat: number;
  label: string;
  pinKind?: 'science' | 'hazard' | 'info' | 'base';
  highlight?: { routeId: string; leg: number; startIdx: number; endIdx: number };
  createdBy: 'user' | 'agent';
}

/* ---------------------------------------------------------------- module APIs (implementations owned by one agent each) */

/** lib/geo — owned by terrain agent */
export interface GeoApi {
  /** lon/lat → local scene metres (uses DemMeta centre + hRef). */
  toLocal(meta: DemMeta, lon: number, lat: number): { x: number; z: number };
  /** inverse of toLocal (exact). */
  toLonLat(meta: DemMeta, x: number, z: number): LonLat;
  /** bilinear sample of true elevation (metres) or null if any contributing cell is nodata / out of bounds. */
  sampleElevation(dem: Dem, lon: number, lat: number): number | null;
}
/** Decoded DEM held in memory. */
export interface Dem { meta: DemMeta; elev: Float32Array /* NaN = nodata, row-major, row 0 = north */ }

/** lib/terrain — owned by terrain agent. Runs inside src/workers/route.worker.ts; the client talks to it
 *  through src/lib/terrain/client.ts which exposes this interface with Promises. */
export interface TerrainApi {
  init(dem: Dem): Promise<{ gridWidth: number; gridHeight: number; cellResM: number }>;
  /** findMinSlope: false skips the search for the smallest working slope limit when a leg has no path (faster sweeps). */
  planRoute(req: { from: LonLat; to: LonLat; stops?: LonLat[]; roundTrip: boolean; constraints: MissionConstraints; findMinSlope?: boolean }): Promise<Omit<RouteResult, 'id' | 'label' | 'from' | 'to' | 'stops'>>;
  /** Point nearest to `to` that can be reached from `from` (and back) under maxSlopeDeg, within maxRadiusM of `to`. */
  nearestReachable(req: { from: LonLat; to: LonLat; maxSlopeDeg: number; maxRadiusM?: number }): Promise<{ point: LonLat | null; movedM: number | null; slopeDeg: number | null; reason?: string }>;
  analyze(req: { center: LonLat; radiusM: number; limitDeg: number }): Promise<TerrainAnalysis>;
  hazards(req: { route: RouteResult; k: number; limitDeg: number }): Promise<Omit<HazardSegment, 'routeId'>[]>;
  /** Slope (deg) at 20 m posting for the shader overlay; same layout as dem.elev. */
  slopeField(): Promise<Float32Array>;
}

/** lib/science — owned by science agent. Pure functions over loaded files + one fetch for rover images. */
export interface ScienceApi {
  load(): Promise<void>; // fetches /data/geology.json, nomenclature.json, traverse.json, science_sites.json
  geologyAt(p: LonLat): { symbol: string; name: string; description: string; interpretation: string; source: GeologyFile['source'] } | null;
  namesNear(p: LonLat, radiusKm: number, limit?: number): { name: string; type: string; distanceKm: number; bearingDeg: number }[];
  nearestTraverse(p: LonLat): { sol: number; lon: number; lat: number; distanceM: number } | null;
  sitesNear(p: LonLat, radiusKm: number): (ScienceSite & { distanceKm: number })[];
  /** Candidate stops for a science objective: sites tagged with it + representative points inside mapped units
   *  associated with it (mapping documented in lib/science/objectives.ts), ranked by distance from `from`. */
  suggestStops(objective: ScienceObjective, from: LonLat, maxKm: number, limit: number): { lon: number; lat: number; label: string; why: string; unit?: string; siteId?: string; distanceKm: number; sourceUrl: string }[];
  roverImagesNear(p: LonLat, maxDistanceM: number, limit: number): Promise<{ sol: number; distanceM: number; images: RoverImage[] } | null>;
  unitList(): { symbol: string; name: string; color: string }[];
}

/** state/world.ts (Zustand) — owned by scene/UI agent. Agent tools act ONLY through this facade. */
export interface WorldFacade {
  snapshot(): WorldSnapshot;
  setSelected(p: WorldPoint | null): void;
  setBase(p: WorldPoint): void;
  setConstraints(c: Partial<MissionConstraints>): MissionConstraints;
  addRoute(r: Omit<RouteResult, 'id'>): RouteResult;          // assigns id "R<n>"
  getRoute(id: string): RouteResult | undefined;
  applyCommands(cmds: SceneCommand[]): { applied: number; errors: string[] };
  makePoint(lon: number, lat: number, source: WorldPoint['source'], label?: string): WorldPoint; // samples DEM
}
export interface WorldSnapshot {
  selected: WorldPoint | null;
  base: WorldPoint | null;
  constraints: MissionConstraints;
  layers: Record<LayerId, boolean>;
  routes: { id: string; label: string; feasible: boolean; reasons: InfeasibleReason[]; totals: RouteResult['totals'] }[];
  visibleRouteIds: string[];
  annotations: Annotation[];
  cameraTarget: LonLat | null;
  demBounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
}

/** lib/agent — owned by agent-loop agent. UI calls ONLY these two functions. */
export interface ToolDeps {
  world: WorldFacade; terrain: TerrainApi; science: ScienceApi;
  /** Globe revamp (optional so Jezero-only callers and old tests keep working). */
  globe?: import('./globalSci/types').GlobeFacade;
  globalSci?: import('./globalSci/types').GlobalScienceApi;
}
export interface TraceStep { id: string; tool: string; label: string; status: 'running' | 'done' | 'error'; ms?: number; summary?: string }
export interface ChatMessage { role: 'user' | 'assistant' | 'tool'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string; name?: string }
export interface AgentApi {
  /** One user turn: proxy round-trips + client-side tool execution (≤8 rounds, ≤12 tool calls). */
  runAgentTurn(args: { userText: string; history: ChatMessage[]; deps: ToolDeps; onTrace: (steps: TraceStep[]) => void; signal?: AbortSignal }):
    Promise<{ text: string; history: ChatMessage[]; trace: TraceStep[]; unverifiedNumbers: string[]; offline: boolean; error?: string }>;
  /** Deterministic path used by HUD buttons (same executors the LLM uses). Returns the tool's JSON result. */
  executeTool(name: string, args: unknown, deps: ToolDeps): Promise<unknown>;
}

/* ---------------------------------------------------------------- regional context terrain (apron) */

/** public/data/context_meta.json — written by scripts/prepare-context.mjs. Same grid conventions as DemMeta
 *  (Int16 LE in `file`, outer edges, row 0 = north); ~463 m MOLA posting around the 20 m CTX DEM patch. */
export interface ContextMeta extends DemMeta {
  imageFile: string;             // "context.jpg": CTX global mosaic cropped exactly to this grid's outer edges
  imageWidth: number; imageHeight: number;
  imageSourceUrl: string;
  /** Linear-light gain that matches the context image brightness to the 6 m CTX mosaic over the overlap. */
  imageGainToPatch: number;
  /** CTX DEM minus MOLA over the overlap (metres), computed by the prep script. */
  datumCheck: Record<string, unknown>;
  imageRegistration: Record<string, unknown>;
  credit: string;
}
