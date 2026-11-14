import type {
  GeologyFile, LonLat, NomenclatureFile, RoverImage, ScienceApi, ScienceObjective, ScienceSite, TraverseFile,
} from '@/lib/contracts';
import { bearingDeg, distanceM, distanceToBBoxM, inBBox, interiorPoint, pointInRings } from './geometry';
import { OBJECTIVE_UNITS } from './objectives';
import { cameraRank, selectImages } from './rover';

type FetchFn = typeof fetch;
const MAX_POLYGONS_PER_UNIT = 5;
const MAX_SOLS_TRIED = 5;
/** DEM footprint (dem_meta); stops outside it cannot be routed or draped, so unit points are clipped to it. */
const DEM_BBOX: [number, number, number, number] = [77.1605, 18.211, 77.699, 18.7212];

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.;](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

export function createScience(fetchFn: FetchFn = (...a) => fetch(...a), base = '/data'): ScienceApi {
  let geology: GeologyFile | null = null;
  let names: NomenclatureFile['features'] = [];
  let traverse: TraverseFile['points'] = [];
  let sites: ScienceSite[] = [];
  const interiorCache = new Map<number, ReturnType<typeof interiorPoint>>();

  async function getJson<T>(file: string): Promise<T> {
    const res = await fetchFn(`${base}/${file}`);
    if (!res.ok) throw new Error(`science: ${file} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  const api: ScienceApi = {
    async load() {
      const [g, n, t, s] = await Promise.all([
        getJson<GeologyFile>('geology.json'),
        getJson<NomenclatureFile>('nomenclature.json'),
        getJson<TraverseFile>('traverse.json'),
        getJson<ScienceSite[]>('science_sites.json'),
      ]);
      geology = g; names = n.features; traverse = t.points; sites = s;
      interiorCache.clear();
    },

    geologyAt(p) {
      if (!geology) return null;
      for (const poly of geology.polygons) {
        if (!inBBox(p, poly.bbox)) continue;
        if (!pointInRings(p, poly.rings)) continue;
        const u = geology.units[poly.unit];
        if (!u) continue;
        return { symbol: u.symbol, name: u.name, description: u.description, interpretation: u.interpretation, source: geology.source };
      }
      return null;
    },

    namesNear(p, radiusKm, limit = 10) {
      return names
        .map((f) => ({ name: f.name, type: f.type, distanceKm: distanceM(p, f) / 1000, bearingDeg: bearingDeg(p, f) }))
        .filter((f) => f.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, limit);
    },

    nearestTraverse(p) {
      let best: { sol: number; lon: number; lat: number; distanceM: number } | null = null;
      for (const t of traverse) {
        const d = distanceM(p, t);
        if (!best || d < best.distanceM) best = { sol: t.sol, lon: t.lon, lat: t.lat, distanceM: d };
      }
      return best;
    },

    sitesNear(p, radiusKm) {
      return sites
        .map((s) => ({ ...s, distanceKm: distanceM(p, s) / 1000 }))
        .filter((s) => s.distanceKm <= radiusKm)
        .sort((a, b) => a.distanceKm - b.distanceKm);
    },

    suggestStops(objective: ScienceObjective, from: LonLat, maxKm: number, limit: number) {
      type Stop = ReturnType<ScienceApi['suggestStops']>[number];
      const out: Stop[] = [];
      for (const s of sites) {
        if (!s.objectives.includes(objective)) continue;
        const d = distanceM(from, s) / 1000;
        if (d <= maxKm) out.push({ lon: s.lon, lat: s.lat, label: s.name, why: s.summary, siteId: s.id, distanceKm: d, sourceUrl: s.sourceUrl });
      }
      if (geology) {
        for (const assoc of OBJECTIVE_UNITS[objective]) {
          const unit = geology.units[assoc.symbol];
          if (!unit) continue;
          const polys = geology.polygons
            .map((poly, idx) => ({ poly, idx }))
            .filter(({ poly }) => poly.unit === assoc.symbol && distanceToBBoxM(from, poly.bbox) / 1000 <= maxKm)
            .sort((a, b) => bboxArea(b.poly.bbox) - bboxArea(a.poly.bbox))
            .slice(0, MAX_POLYGONS_PER_UNIT);
          for (const { poly, idx } of polys) {
            if (!interiorCache.has(idx)) interiorCache.set(idx, interiorPoint(poly.rings));
            const ip = interiorCache.get(idx);
            if (!ip) continue;
            const d = distanceM(from, ip) / 1000;
            if (d > maxKm || !inBBox(ip, DEM_BBOX)) continue;
            out.push({
              lon: ip.lon, lat: ip.lat, unit: assoc.symbol, distanceKm: d,
              label: `${unit.name} (${unit.symbol}) interior`,
              why: `USGS SIM 3464 unit ${unit.symbol}, ${unit.name}: ${firstSentence(unit.interpretation)}`,
              sourceUrl: geology.source.url,
            });
          }
        }
      }
      return out.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
    },

    async roverImagesNear(p, maxDistanceM, limit) {
      // nearest waypoint per sol within range, nearest sol first
      const bySol = new Map<number, number>();
      for (const t of traverse) {
        const d = distanceM(p, t);
        if (d <= maxDistanceM && d < (bySol.get(t.sol) ?? Infinity)) bySol.set(t.sol, d);
      }
      const sols = [...bySol.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_SOLS_TRIED);
      for (const [sol, dist] of sols) {
        const images = await imagesForSol(sol);
        const usable = images.filter((i) => cameraRank(i.camera) < 99);
        if (usable.length) return { sol, distanceM: dist, images: selectImages(usable, limit) };
      }
      return null;
    },

    unitList() {
      if (!geology) return [];
      return Object.values(geology.units).map((u) => ({ symbol: u.symbol, name: u.name, color: u.color }));
    },
  };

  async function imagesForSol(sol: number): Promise<RoverImage[]> {
    for (const url of [`${base}/rover_cache/${sol}.json`, `/api/rover-images?sol=${sol}`]) {
      try {
        const res = await fetchFn(url);
        if (!res.ok) continue;
        const body = (await res.json()) as { images?: RoverImage[] } | RoverImage[];
        const images = Array.isArray(body) ? body : body.images ?? [];
        if (images.length) return images;
      } catch {
        /* try next source */
      }
    }
    return [];
  }

  return api;
}

function bboxArea(b: [number, number, number, number]): number {
  return (b[2] - b[0]) * (b[3] - b[1]);
}
