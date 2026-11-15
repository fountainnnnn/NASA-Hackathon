/**
 * Global (whole-planet) science: point conditions anywhere on Mars from the equirectangular rasters in
 * public/data/global/, the landing-site check against cited criteria, and the EDL timeline.
 * Pure functions over loaded files; no browser globals.
 */
import type { GeologyFile, LonLat } from '../contracts';
import type { EdlPhase, GlobalLayerInfo, GlobalManifest, GlobalSite, SiteConditions } from '../globeContracts';
import type { SlopeSource } from '../scenario/types';
import { gcBearingDeg, gcDistanceKm, pointInUnwrapped, ringsBBox, unwrapRing, wrap180, type Ring } from './geo';
import { evaluateLanding, type CriteriaFile } from './landing';
import { decodeRaster, gunzip, sampleBilinear, sampleNearest, slopeGrid, slopeHorn, type Raster } from './raster';
import type { GlobalScienceApi } from './types';
import { dustFromThermalInertia, fillFromRaster, mockElevation, mockHydrogen, mockSlope, mockThermalInertia, FILL_RADIUS_KM } from './fill';

export * from './types';
export * from './geo';
export * from './raster';
export { evaluateLanding } from './landing';
export type { CriteriaFile, CriterionDef } from './landing';

type FetchFn = typeof fetch;

/** Jezero 20 m CTX DEM footprint (public/data/dem_meta.json): [lonMin, latMin, lonMax, latMax]. */
export const JEZERO_BBOX: [number, number, number, number] = [77.1605, 18.211, 77.699, 18.7212];

interface PreparedPoly { unit: string; rings: Ring[]; bbox: [number, number, number, number] }

const PLACE_EXACT_KM = 40;
const PLACE_NEAR_KM = 300;

export function createGlobalScience(fetchFn: FetchFn = (...a) => fetch(...a), base = '/data/global', opts: { jezeroBBox?: [number, number, number, number] } = {}): GlobalScienceApi {
  const jez = opts.jezeroBBox ?? JEZERO_BBOX;
  let manifest: GlobalManifest | null = null;
  let dem: Raster | null = null;
  const layerRasters = new Map<string, Raster>();
  const layerInfo = new Map<string, GlobalLayerInfo>();
  const failedLayers: string[] = [];
  let geology: GeologyFile | null = null;
  let polys: PreparedPoly[] = [];
  let sites: GlobalSite[] = [];
  let criteria: CriteriaFile | null = null;
  let edl: EdlPhase[] = [];
  let loaded = false;
  let slopeRaster: Float32Array | null = null;

  async function getJson<T>(file: string): Promise<T> {
    const res = await fetchFn(`${base}/${file}`);
    if (!res.ok) throw new Error(`globalSci: ${file} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }
  async function getBuf(file: string): Promise<ArrayBuffer> {
    const res = await fetchFn(`${base}/${file}`);
    if (!res.ok) throw new Error(`globalSci: ${file} -> HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return file.endsWith('.gz') ? gunzip(buf) : buf;
  }

  function prepare(g: GeologyFile): PreparedPoly[] {
    return g.polygons.map((p) => {
      const rings = p.rings.map(unwrapRing);
      return { unit: p.unit, rings, bbox: ringsBBox(rings) };
    });
  }

  const nearestSites = (lon: number, lat: number) =>
    sites
      .map((s) => ({ site: s, distanceKm: gcDistanceKm(lon, lat, s.lon, s.lat), bearingDeg: gcBearingDeg(lon, lat, s.lon, s.lat) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);

  function placeName(lon: number, lat: number): string | null {
    const near = nearestSites(wrap180(lon), lat).find((s) => s.site.kind !== 'candidate');
    if (!near) return null;
    if (near.distanceKm <= PLACE_EXACT_KM) return near.site.name;
    if (near.distanceKm <= PLACE_NEAR_KM) return `near ${near.site.name}`;
    return null;
  }

  function geologyAt(lon: number, lat: number): SiteConditions['geology'] {
    if (!geology) return null;
    for (const p of polys) {
      if (!pointInUnwrapped(lon, lat, p.rings, p.bbox)) continue;
      const u = geology.units[p.unit];
      if (!u) continue;
      return { symbol: u.symbol, name: u.name, description: u.description, source: geology.source.title };
    }
    return null;
  }

  const demResKm = () => manifest?.dem.resKm ?? null;

  /** Nearest mapped geologic unit within 200 km: probed on rings of 10 to 200 km, 16 bearings each. */
  function nearestGeology(lon: number, lat: number): SiteConditions['geology'] {
    for (const dKm of [10, 25, 50, 75, 100, 150, 200]) {
      for (let b = 0; b < 16; b++) {
        const a = (b / 16) * 2 * Math.PI, dDeg = dKm / 59.16;
        const plat = Math.max(-89.9, Math.min(89.9, lat + dDeg * Math.cos(a)));
        const plon = wrap180(lon + (dDeg * Math.sin(a)) / Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
        const g = geologyAt(plon, plat);
        if (g) return { ...g, distanceKm: dKm };
      }
    }
    return null;
  }

  const slopeSource: SlopeSource = {
    get demResM() { return (demResKm() ?? 0) * 1000; },
    slopeDegAt: (lon, lat) => (dem ? slopeHorn(dem, lon, lat) : null),
    grid() {
      if (!dem) return null;
      slopeRaster ??= slopeGrid(dem);
      return { width: dem.width, height: dem.height, lonMin: -180, latMax: 90, dLon: 360 / dem.width, dLat: 180 / dem.height, wrapLon: true, slope: slopeRaster, demResM: (demResKm() ?? 0) * 1000 };
    },
  };

  const api: GlobalScienceApi = {
    get loaded() { return loaded; },
    manifest: () => manifest,

    async load() {
      manifest = await getJson<GlobalManifest>('manifest.json');
      const m = manifest;
      const demBuf = await getBuf(m.dem.file);
      dem = decodeRaster(demBuf, m.dem.encoding.type, m.dem.width, m.dem.height, m.dem.encoding.scale, m.dem.encoding.offset, m.dem.encoding.nodata);
      failedLayers.length = 0;
      layerRasters.clear(); layerInfo.clear();
      await Promise.all([
        ...m.layers.filter((l) => l.valueFile && l.valueEncoding).map(async (l) => {
          layerInfo.set(l.id, l);
          try {
            const e = l.valueEncoding!;
            layerRasters.set(l.id, decodeRaster(await getBuf(l.valueFile!), e.type === 'int16le' ? 'int16le' : 'uint8', l.width, l.height, e.scale, e.offset, e.nodata));
          } catch { failedLayers.push(l.id); }
        }),
        (async () => {
          if (!m.geology) return;
          try { geology = await getJson<GeologyFile>(m.geology.file); polys = prepare(geology); } catch { geology = null; polys = []; }
        })(),
        (async () => { try { sites = await getJson<GlobalSite[]>(m.sites.file); } catch { sites = []; } })(),
        (async () => { try { criteria = await getJson<CriteriaFile>('landing_criteria.json'); } catch { criteria = null; } })(),
        (async () => { try { edl = (await getJson<{ phases: EdlPhase[] }>('edl_mars2020.json')).phases; } catch { edl = []; } })(),
      ]);
      slopeRaster = null;
      loaded = true;
    },

    conditionsAt(lonIn, lat) {
      const lon = wrap180(lonIn);
      const point: LonLat = { lon, lat };
      const notes: string[] = [];
      // missing values are filled (QA round 3): nearest valid cell within 200 km as an estimate, else a labelled mock
      const fills: NonNullable<SiteConditions['fills']> = {};
      const elevF = fillFromRaster(dem, lon, lat, dem ? sampleBilinear(dem, lon, lat) : null, 'MOLA elevation', mockElevation);
      if (elevF.provenance !== 'observed') fills.elevation = { provenance: elevF.provenance, method: elevF.method };
      const elevationM = elevF.value;
      const slopeObs = dem ? slopeHorn(dem, lon, lat) : null;
      const slopeR = layerRasters.get('slope') ?? null;
      const slopeF = fillFromRaster(slopeR, lon, lat, slopeObs, 'MOLA slope', mockSlope);
      if (slopeF.provenance !== 'observed') fills.slope = { provenance: slopeF.provenance, method: slopeF.method };
      const slopeDeg = slopeF.value;
      const resKm = demResKm();
      if (!dem) notes.push('Global elevation data is not loaded.');
      else {
        notes.push(`Global DEM at ~${resKm ?? '?'} km posting: it cannot see boulders, small craters or rover-scale slopes. Slope is averaged over about ${resKm == null ? '?' : (2 * resKm).toFixed(1)} km.`);
        if (fills.elevation) notes.push(`No elevation value at this point (nodata): ${fills.elevation.provenance} used, ${fills.elevation.method}.`);
        if (slopeObs == null) notes.push(`${Math.abs(lat) > 89 ? 'No slope at the polar rows (no row above or below)' : 'No slope here (nodata nearby)'}: ${slopeF.provenance} used, ${slopeF.method}.`);
      }
      const mocks: Partial<Record<string, (lon: number, lat: number) => number>> = { thermalInertia: mockThermalInertia, hydrogen: mockHydrogen, slope: mockSlope };
      const layers: SiteConditions['layers'] = m_layers().map((l) => {
        const r = layerRasters.get(l.id);
        const v = r ? sampleNearest(r, lon, lat) : null;
        if (l.simulated) notes.push(`${l.title} is a simulated layer, not an observation.`);
        const base = { id: l.id, unit: l.valueEncoding?.unit ?? '', label: l.title, source: `${l.mission} ${l.instrument}`.trim() };
        const mock = mocks[l.id];
        if (mock) { const f = fillFromRaster(r ?? null, lon, lat, v, l.title, mock); return { ...base, value: f.value, provenance: f.provenance, method: f.method }; }
        if (l.id === 'elevation') return { ...base, value: elevationM, unit: 'm', provenance: elevF.provenance, method: elevF.method };
        return { ...base, value: v == null ? null : v, provenance: 'observed' as const };
      });
      // dust cover has no numeric raster (colourised map only): estimated from thermal inertia
      const ti = layers.find((l) => l.id === 'thermalInertia');
      const dust = layers.find((l) => l.id === 'dust');
      if (dust && dust.value == null && ti?.value != null) {
        dust.value = dustFromThermalInertia(ti.value); dust.unit = 'dust cover index';
        dust.provenance = ti.provenance === 'mock' ? 'mock' : 'estimate';
        dust.method = `estimated from thermal inertia ${Math.round(ti.value)} tiu (low inertia reads as dust-covered; Ruff & Christensen 2002 trend, assumption)`;
      }
      let geo = geologyAt(lon, lat);
      if (!geology) notes.push('Global geologic map not loaded.');
      else if (!geo) {
        geo = nearestGeology(lon, lat);
        notes.push(geo ? `No mapped unit at the point; nearest mapped unit ${geo.symbol}, ${Math.round(geo.distanceKm ?? 0)} km away.` : `No mapped geologic unit within ${FILL_RADIUS_KM} km.`);
      }
      const near = nearestSites(lon, lat).slice(0, 4).map((s) => ({ name: s.site.name, kind: s.site.kind, distanceKm: s.distanceKm, bearingDeg: s.bearingDeg }));
      const insideJezero = lon >= jez[0] && lon <= jez[2] && lat >= jez[1] && lat <= jez[3];
      if (insideJezero) notes.push('Inside the 20 m Jezero terrain tile: enter Jezero for rover-scale terrain.');
      return {
        point, placeName: placeName(lon, lat), elevationM, slopeDeg, geology: geo, layers, nearestSites: near,
        insideJezeroHighRes: insideJezero, notes, ...(fills.elevation || fills.slope ? { fills } : {}),
      };
    },

    sitesNear: (lon, lat, radiusKm) => nearestSites(wrap180(lon), lat).filter((s) => s.distanceKm <= radiusKm),
    placeName: (lon, lat) => placeName(lon, lat),
    slopeSource: () => slopeSource,

    checkLandingSite(lonIn, lat) {
      const lon = wrap180(lonIn);
      return evaluateLanding(criteria, { lon, lat, conditions: api.conditionsAt(lon, lat), demResKm: demResKm() });
    },
    edlPhases: () => edl,
    defaultEllipse: () => (criteria ? { ...criteria.ellipse } : null),
  };

  function m_layers(): GlobalLayerInfo[] {
    return manifest ? manifest.layers.filter((l) => l.valueFile && l.valueEncoding) : [];
  }
  return api;
}
