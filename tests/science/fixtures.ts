// synthetic test fixture — NOT real Mars data. Flat 0.1-degree boxes near Jezero for geometry tests.
import type { GeologyFile, NomenclatureFile, RoverImage, ScienceSite, TraverseFile } from '@/lib/contracts';

export const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

export const geology: GeologyFile = {
  source: { title: 'synthetic test fixture', authors: 'n/a', year: 0, url: 'https://example.invalid/sim', scale: 'n/a' },
  units: {
    NHjf2: { symbol: 'NHjf2', name: 'Jezero fan 2 unit', description: 'synthetic', interpretation: 'Deltaic fan deposits (synthetic). More text.', color: '#aa5500' },
    Njf: { symbol: 'Njf', name: 'Jezero floor unit', description: 'synthetic', interpretation: 'Floor unit (synthetic).', color: '#556677' },
  },
  polygons: [
    // 0: donut — outer 77.2..77.6 x 18.25..18.65, hole 77.3..77.5 x 18.35..18.55
    { unit: 'NHjf2', rings: [box(77.2, 18.25, 77.6, 18.65), box(77.3, 18.35, 77.5, 18.55)], bbox: [77.2, 18.25, 77.6, 18.65] },
    // 1: small solid box far east
    { unit: 'NHjf2', rings: [box(77.64, 18.5, 77.66, 18.52)], bbox: [77.64, 18.5, 77.66, 18.52] },
    // 2: other unit
    { unit: 'Njf', rings: [box(77.5, 18.0, 77.7, 18.2)], bbox: [77.5, 18.0, 77.7, 18.2] },
  ],
};

export const nomenclature: NomenclatureFile = {
  source: { title: 'synthetic test fixture', url: 'https://example.invalid/names' },
  features: [
    { name: 'North Test', type: 'Mons', lon: 77.2, lat: 18.5 },
    { name: 'East Test', type: 'Vallis', lon: 77.3, lat: 18.4 },
  ],
};

export const traverse: TraverseFile = {
  source: { title: 'synthetic test fixture', url: 'https://example.invalid/trav' },
  points: [
    { sol: 10, lon: 77.2, lat: 18.4, elevGeoid: -2500, distTotalM: 0 },
    { sol: 20, lon: 77.2005, lat: 18.4, elevGeoid: -2500, distTotalM: 30 },
    { sol: 30, lon: 77.25, lat: 18.4, elevGeoid: -2500, distTotalM: 3000 },
  ],
};

export const sites: ScienceSite[] = [
  { id: 's-near', name: 'Near site', lon: 77.2, lat: 18.45, summary: 'synthetic test fixture', objectives: ['astrobiology-samples', 'delta-sediments'], sourceUrl: 'https://example.invalid/a', sourceTitle: 't', mission: 'm', coordinateSource: 'synthetic' },
  { id: 's-far', name: 'Far site', lon: 77.2, lat: 18.9, summary: 'synthetic test fixture', objectives: ['delta-sediments'], sourceUrl: 'https://example.invalid/b', sourceTitle: 't', mission: 'm', coordinateSource: 'synthetic' },
];

export const img = (id: string, sol: number, camera: string): RoverImage => ({
  id, sol, earthDate: '2021-01-01', camera, cameraFull: camera, url: `https://mars.nasa.gov/${id}.jpg`, credit: 'NASA/JPL-Caltech',
});

/** fetch mock: map of path -> JSON body (404 otherwise); records calls. */
export function mockFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url in routes) return new Response(JSON.stringify(routes[url]), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

export const dataRoutes = {
  '/data/geology.json': geology,
  '/data/nomenclature.json': nomenclature,
  '/data/traverse.json': traverse,
  '/data/science_sites.json': sites,
};
