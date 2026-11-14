/**
 * Globe + companion + scenario contracts (revamp, 14 Nov 2026). Single source of truth for the new
 * modules. Same conventions as contracts.ts: Mars 2000 sphere R = 3,396,190 m, planetocentric latitude,
 * longitude POSITIVE EAST in -180..180, heights in metres above the MOLA areoid.
 */
import type { LonLat, Provenance } from './contracts';

/* ---------------------------------------------------------------- global data (public/data/global/) */

/** public/data/global/manifest.json — written by scripts/prepare-global.mjs */
export interface GlobalManifest {
  texture: { file: string; width: number; height: number; title: string; credit: string; sourceUrl: string };
  /** Equirectangular rasters cover lon -180..180 (left→right) and lat 90..-90 (top→bottom), pixel-edge aligned. */
  dem: { file: string; width: number; height: number; encoding: { type: 'int16le'; scale: number; offset: number; nodata: -32768 }; resKm: number; title: string; credit: string; sourceUrl: string };
  layers: GlobalLayerInfo[];
  geology?: { file: string; title: string; authors: string; year: number; url: string; scale: string };
  sites: { file: string };     // landing sites + named features
}
export interface GlobalLayerInfo {
  id: GlobalLayerId;
  /** Display texture (colourised PNG/JPG) AND, when `valueFile` is set, a value raster for point queries. */
  file: string; width: number; height: number;
  valueFile?: string; valueEncoding?: { type: 'uint8' | 'int16le'; scale: number; offset: number; nodata: number; unit: string };
  title: string; mission: string; instrument: string; kind: 'optical' | 'topographic' | 'geologic' | 'thermal' | 'chemical' | 'derived';
  provenance: Provenance; credit: string; sourceUrl: string; note?: string; simulated?: boolean;
}
export type GlobalLayerId = 'elevation' | 'geology' | 'hydrogen' | 'thermalInertia' | 'dust' | 'slope';

/** public/data/global/sites.json */
export interface GlobalSite {
  id: string; name: string; lon: number; lat: number;
  kind: 'landing' | 'feature' | 'candidate';
  mission?: string; date?: string; summary?: string; sourceUrl: string;
}

/* ---------------------------------------------------------------- global science (src/lib/globalSci) */

export interface SiteConditions {
  point: LonLat;
  placeName: string | null;              // nearest IAU feature it lies within / near
  elevationM: number | null;             // MOLA, areoid
  slopeDeg: number | null;               // from global DEM at its resolution (coarse)
  geology: { symbol: string; name: string; description: string; source: string } | null;
  layers: { id: GlobalLayerId; value: number | null; unit: string; label: string; source: string }[];
  nearestSites: { name: string; kind: GlobalSite['kind']; distanceKm: number; bearingDeg: number }[];
  insideJezeroHighRes: boolean;
  notes: string[];                       // e.g. "Global DEM at ~1.85 km: cannot see boulders"
}

export interface LandingCriterion {
  id: string; label: string; value: number | null; unit: string; limit: string;
  pass: boolean | null;                  // null = no data
  source: { title: string; url: string };
}
export interface LandingCheck {
  site: LonLat;
  criteria: LandingCriterion[];
  verdict: 'meets-all' | 'fails-some' | 'insufficient-data';
  ellipse: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number; source: { title: string; url: string } };
}

/** Monte-Carlo touchdown scenario (Rust/WASM with TS fallback; deterministic seed). */
export interface LandingScenarioRequest {
  center: LonLat; semiMajorKm: number; semiMinorKm: number; azimuthDeg: number;
  samples: number;                       // e.g. 10_000
  maxSlopeDeg: number;                   // touchdown slope limit (assumption, cited if possible)
  seed: number;
  dem: 'jezero20m' | 'global';
}
export interface LandingScenarioResult {
  samples: number; okFraction: number;   // fraction of touchdowns at or below the slope limit with valid data
  slopeP50: number; slopeP95: number; nodataFraction: number;
  points: Float32Array;                  // packed [lon, lat, slopeDeg] × min(samples, 2000) for rendering
  engine: 'wasm' | 'ts'; computeMs: number; demResM: number;
}

/** EDL timeline (each phase cited; durations and altitudes from NASA mission material). */
export interface EdlPhase { id: string; label: string; tStartS: number; tEndS: number; altitudeKmStart?: number; altitudeKmEnd?: number; note?: string; source: { title: string; url: string } }

/* ---------------------------------------------------------------- globe scene commands (allowlisted) */

export type GlobeCommand =
  | { type: 'globe_fly_to'; lon: number; lat: number; altitudeKm?: number }
  | { type: 'globe_marker'; id?: string; lon: number; lat: number; label: string; kind: 'click' | 'site' | 'landing' | 'hazard' }
  | { type: 'globe_ellipse'; id?: string; lon: number; lat: number; semiMajorKm: number; semiMinorKm: number; azimuthDeg: number; label: string; tone: 'ok' | 'warn' | 'bad' }
  | { type: 'globe_scatter'; id?: string; scenarioId: string }
  | { type: 'globe_arc'; id?: string; from: LonLat; to: LonLat; label: string }   // e.g. EDL approach track
  | { type: 'globe_layer'; layer: GlobalLayerId; visible: boolean }
  | { type: 'globe_clear' }
  | { type: 'enter_jezero' }             // hand off to the 20 m Jezero planner (existing Scene/)
  | { type: 'exit_jezero' };

/* ---------------------------------------------------------------- companion (src/state/companion.ts) */

export type ScoutMood = 'idle' | 'listening' | 'thinking' | 'drawing' | 'warning';
/** Structured answer shown in Scout's bubble instead of paragraphs. Every figure comes from a tool result. */
export interface AnswerCard {
  title: string;
  verdict?: { word: 'GO' | 'HOLD' | 'NO GO'; tone: 'go' | 'caution' | 'nogo' };
  coords?: string;
  rows?: { label: string; value: string; unit?: string; src?: string }[];
  criteria?: { label: string; value: string; limit: string; result: 'pass' | 'fail' | 'no data'; src?: string }[];
  /** Elevation along the route (m) at cumulative distance (m), and battery left (%) over minutes, with the reserve threshold. */
  profile?: { dist: number[]; elev: number[]; min: number[]; battery: number[]; reservePct: number };
  /** Mission Log step with the full calculation. */
  stepId?: string | null;
}
export interface CompanionUtterance { card?: AnswerCard; id: string; text: string; sources: { title: string; url?: string }[]; unverified: string[]; at: number; point?: LonLat }
export interface CompanionState {
  mode: 'globe' | 'jezero';
  mood: ScoutMood;
  anchor: { kind: 'cursor' } | { kind: 'point'; lon: number; lat: number };
  bubbleOpen: boolean;
  current: CompanionUtterance | null;   // what Scout is saying now
  trail: CompanionUtterance[];          // collapsible history, newest first, max 30
  listening: boolean;                   // push-to-talk active
  busy: boolean;
}
