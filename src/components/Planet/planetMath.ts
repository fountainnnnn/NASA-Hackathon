/**
 * Planet view maths and constants. Pure TypeScript, no Cesium import, so it is unit-testable in node.
 *
 * DATA (all NASA, JPL Mars Trek):
 *  - terrain   quantized-mesh tiles at marshub.s3.amazonaws.com/mars_v14 (the tiles Mars Trek's own 3D viewer reads)
 *  - base      Viking MDIM 2.1 colourised global mosaic, WMTS, 256 px tiles, levels 0..7 (232 m native)
 *  - detail    CTX global mosaic (Caltech uncontrolled, 5 m), ArcGIS tile cache, 512 px tiles, levels 0..12
 */
import { JEZERO_BOUNDS } from '../Globe/geo';

export const MARS_RADII_M = { x: 3_396_190, y: 3_396_190, z: 3_376_200 } as const;

/**
 * The terrain tiles store height = MOLA elevation (m above the areoid) + ~8201 m: Mars Trek's config has
 * elevationMinValue -8201 and the tile centres sit that far above the Mars ellipsoid. Subtract it to report MOLA elevation.
 * Verified against our own MOLA raster in tests/planet (see scripts note in the report).
 */
export const TERRAIN_DATUM_OFFSET_M = 8201;

export const TERRAIN_URL = 'https://marshub.s3.amazonaws.com/mars_v14/';
export const VIKING = {
  url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0//{Style}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg',
  layer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', style: 'default', tileMatrixSetID: 'default028mm', tileSize: 256, maxLevel: 7,
  credit: 'Viking MDIM 2.1: NASA/JPL-Caltech/USGS Astrogeology',
} as const;
export const CTX = {
  url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/{TileMatrix}/{TileRow}/{TileCol}',
  layer: 'CTX_beta01_uncontrolled_5m_Caltech', style: 'default', tileMatrixSetID: 'default028mm', tileSize: 512, maxLevel: 12,
  credit: 'CTX mosaic: NASA/MRO/MSSS, Caltech Murray Lab',
} as const;
/** The one on-screen credit line (next to Cesium's logo). */
export const DATA_CREDIT = 'NASA/JPL Mars Trek terrain, Viking MDIM USGS, CTX MSSS/Caltech Murray Lab';

export const JEZERO_HANDOFF_ALT_KM = 25;
export const MIN_CAMERA_HEIGHT_M = 120;

const D2R = Math.PI / 180;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const smoothstep = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Elevation above the MOLA areoid from a terrain-tile height. */
export const elevationFromHeight = (h: number) => h - TERRAIN_DATUM_OFFSET_M;
export const heightFromElevation = (e: number) => e + TERRAIN_DATUM_OFFSET_M;

/** True when (lon, lat) is inside the 20 m Jezero coverage, grown by `marginDeg`. */
export function inJezero(lon: number, lat: number, marginDeg = 0): boolean {
  const b = JEZERO_BOUNDS;
  return lon >= b.lonMin - marginDeg && lon <= b.lonMax + marginDeg && lat >= b.latMin - marginDeg && lat <= b.latMax + marginDeg;
}

/** Camera pitch for a requested altitude: straight down from orbit, easing to an oblique ground view near the surface. */
export function pitchForAltitudeKm(altKm: number): number {
  const t = clamp((Math.log(400) - Math.log(Math.max(altKm, 1))) / (Math.log(400) - Math.log(30)), 0, 1);
  return -90 + t * 55; // -90 above 400 km, -35 at 30 km and below
}

/** Distance from the look-at point to the camera that yields `altKm` of height at `pitchDeg` (negative = looking down). */
export function rangeForAltitudeM(altKm: number, pitchDeg: number): number {
  const s = Math.sin(Math.abs(pitchDeg) * D2R);
  return (altKm * 1000) / Math.max(s, 0.2);
}

/** Flight time: short hops are quick, orbit to ground takes a few seconds. */
export function flightDurationS(distanceKm: number, altChangeRatio = 1): number {
  return clamp(0.9 + 0.5 * Math.log10(1 + distanceKm) + 0.25 * Math.abs(Math.log10(Math.max(altChangeRatio, 1e-3))), 1.2, 4.6);
}

/** CTX 5 m detail (fused onto Viking colour, see imageryBlend.ts) fades in between 1200 km and 300 km of camera height. */
export const ctxAlpha = (altKm: number) => 1 - smoothstep(300, 1200, altKm);

/**
 * Sun for relief shading near the ground: fixed in the view centre's local frame, low in the west-southwest. Visual choice,
 * not Mars24: it matches the mid-afternoon light the CTX images were taken in, so the imagery's own shading and the terrain
 * shading agree, and the ground is never in night.
 */
export const SUN_AZIMUTH_DEG = 250;
export const SUN_ELEVATION_DEG = 35;
/**
 * Relief shading strength: 1 near the ground, 0 for whole-disc views (above 5000 km), blended from 2000 km. From orbit
 * the coarse level 1 to 3 terrain tiles do not shade alike (one 45 degree tile, lon 90 to 135 E, lat 0 to 45 N, showed
 * as a lighter rectangle on the idle globe) and relief is invisible at that scale anyway; Viking's own colour carries it.
 */
export const reliefShading = (altKm: number) => 1 - smoothstep(2000, 5000, altKm);
/** 0 = local sun (near the ground), 1 = camera-relative light (whole-disc views), blended between 600 and 3000 km. */
export const globeLightBlend = (altKm: number) => smoothstep(600, 3000, altKm);

/**
 * Relief near the ground, constant below 300 km so heights sampled for marks and the landing objects stay valid while
 * the camera moves. Mars plains read as flat at true scale in an oblique view; the legend states the factor.
 */
export const GROUND_EXAGGERATION = 2.5;
/** The old globe's relief slider defaulted to 20x for a 7 km sphere: the global view blends from the ground factor to that. */
export function effectiveExaggeration(slider: number, altKm: number): number {
  const global = 1 + (clamp(slider, 1, 50) - 1) * 0.05;
  return GROUND_EXAGGERATION + (global - GROUND_EXAGGERATION) * smoothstep(300, 2500, altKm);
}
/** A true terrain height (m above the Mars ellipsoid) moved to where the exaggerated ground is drawn near the surface. */
export const renderHeight = (h: number) => TERRAIN_DATUM_OFFSET_M + (h - TERRAIN_DATUM_OFFSET_M) * GROUND_EXAGGERATION;

/** Vertical lift above sampled terrain so marks do not z-fight with a coarser rendered tile. Grows with distance. */
export function liftForRangeM(rangeM: number): number {
  return clamp(rangeM * 0.004, 4, 1500);
}
/** Lift changes only when this bucket changes, so vector overlays are not rebuilt every frame. */
export const liftBucket = (rangeM: number) => Math.round(Math.log2(Math.max(rangeM, 1)) * 2);

/** Camera pose for the landing scenario: east of the site looking west so the approach (drawn from the west) comes in from the horizon. */
export function landingViewpoint(ellipse?: { semiMajorKm: number }): { headingDeg: number; pitchDeg: number; rangeM: number } {
  const major = ellipse?.semiMajorKm ?? 8;
  return { headingDeg: 270, pitchDeg: -30, rangeM: clamp(major * 2.6, 15, 60) * 1000 };
}

/** Screen-constant ring radius on the ground for the click ring. */
export const ringRadiusM = (rangeM: number) => Math.max(6, rangeM * 0.011);

/** Round altitude for the store: whole km at altitude, one decimal below 100 km. */
export const roundAltKm = (km: number) => (km >= 100 ? Math.round(km) : Math.round(km * 10) / 10);

/** Number of vertices in marks that follow terrain. */
export const RING_VERTS = 40;

export interface ToneStyle { color: string; dashed: boolean; hatched: boolean }
export const TONE_STYLE: Record<'ok' | 'warn' | 'bad', ToneStyle> = {
  ok: { color: '#58c98a', dashed: false, hatched: false },
  warn: { color: '#f3d250', dashed: true, hatched: false },
  bad: { color: '#d9423b', dashed: false, hatched: true },
};
export const KIND_COLOR = { click: '#ece7e1', site: '#a39c95', landing: '#5cc8ff', hazard: '#d9423b' } as const;
export const GO = '#58c98a', NOGO = '#d9423b', NODATA = '#6a645f';

/** Parabolic altitude (m) for a store arc of `km` ground length: apex follows the old globe (0.01 + 0.15 * km / R). */
export function arcApexM(km: number): number {
  return (0.01 + 0.15 * (km / 3396.19)) * 3_396_190;
}

/** How long a globe click waits for the ground under it to become pickable (terrain tiles still loading), ms. */
export const PICK_RETRY_MS = 2000;

/**
 * Try `attempt` now and then once per rendered frame until it returns a value or `timeoutMs` has passed. A deadline timer
 * makes one last try and settles even when no frame arrives, so the promise always resolves (null when it never succeeded).
 * Used so the first globe click after load is not lost while the terrain under the pointer is still loading.
 */
export function retryEachFrame<T>(
  attempt: () => T | null, onFrame: (cb: () => void) => () => void, timeoutMs = PICK_RETRY_MS,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (f, ms) => setTimeout(f, ms), clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) },
): Promise<T | null> {
  const first = attempt();
  if (first != null) return Promise.resolve(first);
  return new Promise<T | null>((resolve) => {
    let done = false;
    const finish = (v: T | null) => { if (done) return; done = true; off(); timers.clear(timer); resolve(v); };
    const off = onFrame(() => { const v = attempt(); if (v != null) finish(v); });
    const timer = timers.set(() => finish(attempt()), timeoutMs);
  });
}
