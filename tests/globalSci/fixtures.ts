// synthetic test fixture — NOT real Mars data. A 1-degree global grid with analytic terrain, served through a fake fetch.
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeologyFile } from '../../src/lib/contracts';
import type { GlobalManifest, GlobalSite } from '../../src/lib/globeContracts';

export const W = 360, H = 180;
export const NODATA = -32768;

/** elevation(lon, lat) metres: continuous across the antimeridian, ramps with latitude. */
export const elevFn = (lon: number, lat: number) => 1000 * Math.cos((lon * Math.PI) / 180) + 10 * lat;

export function makeDemBuffer(opts: { nodataCell?: [number, number] } = {}): Uint8Array {
  const buf = new Uint8Array(W * H * 2);
  const dv = new DataView(buf.buffer);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const lon = -180 + (c + 0.5), lat = 90 - (r + 0.5);
      let v = Math.round(elevFn(lon, lat));
      if (opts.nodataCell && opts.nodataCell[0] === c && opts.nodataCell[1] === r) v = NODATA;
      dv.setInt16((r * W + c) * 2, v, true);
    }
  }
  return buf;
}

/** thermal inertia layer: uint8, value = raw * 2 (unit tiu); raw 80 -> 160 everywhere except a low-TI stripe. */
export function makeTiBuffer(): Uint8Array {
  const b = new Uint8Array(W * H).fill(80);
  for (let r = 0; r < H; r++) for (let c = 0; c < 10; c++) b[r * W + c] = 20; // lon -180..-170: TI 40 (dusty)
  b[5 * W + 5] = 255; // nodata cell
  return b;
}

const sq = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];

export const geology: GeologyFile = {
  source: { title: 'synthetic test fixture geology', authors: 'n/a', year: 0, url: 'https://example.invalid/geo', scale: 'n/a' },
  units: {
    Aa: { symbol: 'Aa', name: 'Antimeridian unit', description: 'synthetic', interpretation: 'synthetic', color: '#fff' },
    Bb: { symbol: 'Bb', name: 'Donut unit', description: 'synthetic', interpretation: 'synthetic', color: '#000' },
  },
  polygons: [
    // crosses +-180: ring jumps 170 -> -170 (as a naive lon/lat export would)
    { unit: 'Aa', rings: [[[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]]], bbox: [-170, -10, 170, 10] },
    // donut around (0, 40): outer 10x10 deg, hole 4x4
    { unit: 'Bb', rings: [sq(-5, 35, 5, 45), sq(-2, 38, 2, 42)], bbox: [-5, 35, 5, 45] },
  ],
};

export const sites: GlobalSite[] = [
  { id: 'jez', name: 'Jezero Test', lon: 77.5, lat: 18.4, kind: 'landing', mission: 'synthetic', sourceUrl: 'https://example.invalid/jez' },
  { id: 'far', name: 'Far Test', lon: -100, lat: -30, kind: 'feature', sourceUrl: 'https://example.invalid/far' },
  { id: 'cand', name: 'Candidate Test', lon: 0, lat: 0, kind: 'candidate', sourceUrl: 'https://example.invalid/cand' },
];

export const manifest: GlobalManifest = {
  texture: { file: 'tex.jpg', width: 2, height: 1, title: 't', credit: 'c', sourceUrl: 'u' },
  dem: { file: 'mola.i16.gz', width: W, height: H, encoding: { type: 'int16le', scale: 1, offset: 0, nodata: NODATA }, resKm: 1.85, title: 'synthetic test fixture DEM', credit: 'synthetic', sourceUrl: 'https://example.invalid/dem' },
  layers: [
    {
      id: 'thermalInertia', file: 'ti.png', width: W, height: H, valueFile: 'ti.u8', valueEncoding: { type: 'uint8', scale: 2, offset: 0, nodata: 255, unit: 'J m-2 s-0.5 K-1' },
      title: 'Thermal inertia (synthetic test fixture)', mission: 'synthetic', instrument: 'fixture', kind: 'thermal', provenance: 'computed', credit: 'c', sourceUrl: 'u',
    },
  ],
  geology: { file: 'geology_global.json', title: 'g', authors: 'a', year: 0, url: 'u', scale: 's' },
  sites: { file: 'sites.json' },
};

const real = (f: string) => readFileSync(join(process.cwd(), 'public/data/global', f), 'utf8');

/** Fake fetch over the synthetic files (+ the REAL landing_criteria.json and edl_mars2020.json). */
export function fixtureFetch(opts: { nodataCell?: [number, number]; missing?: string[] } = {}): typeof fetch {
  const files: Record<string, () => BodyInit> = {
    'manifest.json': () => JSON.stringify(manifest),
    'mola.i16.gz': () => gzipSync(makeDemBuffer(opts)) as unknown as BodyInit,
    'ti.u8': () => makeTiBuffer() as unknown as BodyInit,
    'geology_global.json': () => JSON.stringify(geology),
    'sites.json': () => JSON.stringify(sites),
    'landing_criteria.json': () => real('landing_criteria.json'),
    'edl_mars2020.json': () => real('edl_mars2020.json'),
  };
  return (async (input: RequestInfo | URL) => {
    const name = String(input).split('/').pop() as string;
    if (opts.missing?.includes(name) || !files[name]) return new Response('nope', { status: 404 });
    return new Response(files[name](), { status: 200 });
  }) as typeof fetch;
}
