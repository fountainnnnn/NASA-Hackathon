import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContextMeta, Dem, DemMeta } from '../../src/lib/contracts';
import { buildContextScene, blendApronOntoPatch, gridRect, groundHeight, insideRect, validHeightAt } from '../../src/components/Scene/contextGrid';
import type { ContextData } from '../../src/components/Scene/contextGrid';
import { elevationAt, insideBounds, NEEDS_HIRES_MESSAGE, OUTSIDE_LABEL, pickPoint } from '../../src/components/Scene/pick';
import { decodeDem, sampleElevation, toLocal } from '../../src/lib/geo/frame';
import { buildTerrainGrid } from '../../src/lib/scene/terrainGrid';
import type { TerrainGrid } from '../../src/lib/scene/terrainGrid';
import { configureWorld, resetWorldForTests, useWorld } from '../../src/state/world';

const DATA = path.resolve(__dirname, '../../public/data');
const json = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as T;

function flatGrid(over: Partial<TerrainGrid>): TerrainGrid {
  const g = { nx: 5, nz: 5, x0: 0, z0: 0, dx: 100, dz: 100, minH: 0, maxH: 0, hRef: 0, elevMin: 0, elevMax: 1, stride: 1, ...over } as TerrainGrid;
  g.heights = over.heights ?? new Float32Array(g.nx * g.nz);
  g.valid = over.valid ?? new Uint8Array(g.nx * g.nz).fill(1);
  return g;
}

describe('apron geometry helpers', () => {
  it('gridRect and insideRect agree with the grid extent', () => {
    const r = gridRect(flatGrid({ x0: -200, z0: -300, dx: 100, dz: 150 }));
    expect(r).toEqual({ xMin: -200, xMax: 200, zMin: -300, zMax: 300 });
    expect(insideRect(r, 0, 0)).toBe(true);
    expect(insideRect(r, 201, 0)).toBe(false);
  });

  it('blends apron heights onto the patch edge heights and leaves distant vertices alone', () => {
    // patch: 3x3 vertices over x,z in [0,200], height 50 everywhere
    const patch = flatGrid({ nx: 3, nz: 3, x0: 0, z0: 0, dx: 100, dz: 100, heights: new Float32Array(9).fill(50) });
    // apron: 21x21 vertices over [-1000, 1000], spacing 100, height -40 everywhere
    const apron = flatGrid({ nx: 21, nz: 21, x0: -1000, z0: -1000, dx: 100, dz: 100, heights: new Float32Array(441).fill(-40) });
    blendApronOntoPatch(apron, patch, 500);
    const at = (x: number, z: number) => apron.heights[((z + 1000) / 100) * 21 + (x + 1000) / 100];
    expect(at(100, 100)).toBeCloseTo(50);      // inside the patch rectangle: patch height
    expect(at(0, 0)).toBeCloseTo(50);          // on the edge: patch edge height, so the surfaces meet
    expect(at(-100, 100)).toBeGreaterThan(-40); // within the band: pulled up
    expect(at(-100, 100)).toBeLessThan(50);
    expect(at(-800, 100)).toBeCloseTo(-40);    // outside the band: untouched MOLA value
    expect(apron.maxH).toBeCloseTo(50);
    expect(apron.minH).toBeCloseTo(-40);
  });

  it('validHeightAt ignores nodata vertices and groundHeight switches at the patch edge', () => {
    const valid = new Uint8Array(9).fill(1); valid[4] = 0;
    const heights = new Float32Array(9).fill(10); heights[4] = 9999;
    expect(validHeightAt(flatGrid({ nx: 3, nz: 3, dx: 100, dz: 100, heights, valid }), 100, 100)).toBeCloseTo(10);
    expect(validHeightAt(flatGrid({ nx: 3, nz: 3, dx: 100, dz: 100, heights, valid }), 150, 100)).toBeCloseTo(10);
    const patch = flatGrid({ nx: 3, nz: 3, dx: 100, dz: 100, heights: new Float32Array(9).fill(10) });
    const apron = flatGrid({ nx: 3, nz: 3, x0: -400, z0: -400, dx: 400, dz: 400, heights: new Float32Array(9).fill(-5) });
    const ctx = { grid: apron, patchRect: gridRect(patch), rect: gridRect(apron) } as never;
    expect(groundHeight(patch, ctx, 50, 50, 2)).toBeCloseTo(20);   // inside the patch
    expect(groundHeight(patch, ctx, 300, 50, 2)).toBeCloseTo(-10); // on the apron, exaggerated
    expect(groundHeight(patch, null, 300, 50, 2)).toBeCloseTo(20); // no context: clamped patch edge (old behaviour)
  });
});

describe('real context data (public/data)', () => {
  const dMeta = json<DemMeta>('dem_meta.json');
  let buf = fs.readFileSync(path.join(DATA, dMeta.file));
  if (dMeta.encoding.compression === 'gzip') buf = zlib.gunzipSync(buf);
  const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const cMeta = json<ContextMeta>('context_meta.json');
  const hi: Dem = decodeDem(dMeta, ab(buf));
  const lo: Dem = decodeDem(cMeta, ab(fs.readFileSync(path.join(DATA, cMeta.file))));
  const data: ContextData = { meta: cMeta, dem: lo, texture: new THREE.Texture() };
  const patch = buildTerrainGrid(hi, { toLocal }, 768);
  const scene = buildContextScene(data, dMeta, { toLocal }, patch);

  it('is a 512x512-or-smaller grid that wraps the patch and shares its frame', () => {
    expect(scene.grid.nx).toBeLessThanOrEqual(512);
    expect(scene.grid.nz).toBeLessThanOrEqual(512);
    expect(scene.rect.xMin).toBeLessThan(scene.patchRect.xMin - 50_000);
    expect(scene.rect.xMax).toBeGreaterThan(scene.patchRect.xMax + 50_000);
    expect(scene.rect.zMin).toBeLessThan(scene.patchRect.zMin - 50_000);
    expect(scene.rect.zMax).toBeGreaterThan(scene.patchRect.zMax + 50_000);
    // apron corners are the context lon/lat corners in the CTX DEM frame
    const nw = toLocal(dMeta, cMeta.lonMin, cMeta.latMax);
    expect(scene.grid.x0).toBeCloseTo(nw.x, 3);
    expect(scene.grid.z0).toBeCloseTo(nw.z, 3);
    expect(scene.grid.hRef).toBe(dMeta.hRef);
  });

  it('places the patch where it belongs: apron and patch heights meet at the patch edge', () => {
    const r = scene.patchRect;
    const mid = (r.zMin + r.zMax) / 2;
    for (const [x, z] of [[r.xMin, mid], [r.xMax, mid], [(r.xMin + r.xMax) / 2, r.zMin], [(r.xMin + r.xMax) / 2, r.zMax]]) {
      const patchH = groundHeight(patch, null, x, z, 1);
      const eps = 20 * Math.sign(x - (r.xMin + r.xMax) / 2 || 0) + 0, eps2 = 20 * Math.sign(z - (r.zMin + r.zMax) / 2 || 0);
      const apronH = groundHeight(patch, scene, x + eps * 2, z + eps2 * 2, 1); // 40 m outside the edge
      expect(Math.abs(apronH - patchH)).toBeLessThan(25);
    }
  });

  it('datum: context heights agree with the 20 m CTX DEM over the overlap (median within 20 m)', () => {
    const diffs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const lon = dMeta.lonMin + (0.1 + 0.8 * ((i * 0.6180339887) % 1)) * (dMeta.lonMax - dMeta.lonMin);
      const lat = dMeta.latMin + (0.1 + 0.8 * ((i * 0.7548776662) % 1)) * (dMeta.latMax - dMeta.latMin);
      const a = sampleElevation(hi, lon, lat), b = sampleElevation(lo, lon, lat);
      if (a != null && b != null) diffs.push(a - b);
    }
    diffs.sort((x, y) => x - y);
    expect(diffs.length).toBeGreaterThan(3000);
    expect(Math.abs(diffs[diffs.length >> 1])).toBeLessThan(20);
    expect((cMeta.datumCheck as { all: { n: number } }).all.n).toBeGreaterThan(1000);
  });
});

describe('picking on the regional terrain', () => {
  const meta = { width: 10, height: 10, lonMin: 77.3, lonMax: 77.6, latMin: 18.3, latMax: 18.6, dLon: 0.03, dLat: 0.03, hRef: -2500 } as DemMeta;
  const dem: Dem = { meta, elev: new Float32Array(100).fill(-2400) };
  const ctxDem: Dem = { meta: { ...meta, lonMin: 76, lonMax: 79, latMin: 17, latMax: 20, dLon: 0.3, dLat: 0.3 }, elev: new Float32Array(100).fill(-2222) };
  const geo = {
    toLocal: (_m: DemMeta, lon: number, lat: number) => ({ x: (lon - 77.45) * 1000, z: -(lat - 18.45) * 1000 }),
    toLonLat: (_m: DemMeta, x: number, z: number) => ({ lon: 77.45 + x / 1000, lat: 18.45 - z / 1000 }),
    sampleElevation,
  };
  const rt = { meta, dem, geo, context: { dem: ctxDem } };
  beforeEach(() => { resetWorldForTests(); configureWorld({ dem, geo }); });

  it('inside the DEM bounds the point is a normal pick with the 20 m elevation', () => {
    pickPoint(rt, new THREE.Vector3(0, 0, 0));
    const s = useWorld.getState().selected!;
    expect(s.label).toBe('Selected point');
    expect(s.elevationM).toBeCloseTo(-2400);
    expect(elevationAt(rt, s.lon, s.lat).coarse).toBe(false);
  });

  it('outside the DEM bounds the point is selected, labelled, and carries the coarse MOLA elevation', () => {
    pickPoint(rt, new THREE.Vector3(800, 0, -600)); // lon 78.25, lat 19.05: outside, inside the context grid
    const s = useWorld.getState().selected!;
    expect(insideBounds(useWorld.getState().bounds, s.lon, s.lat)).toBe(false);
    expect(s.label).toBe(OUTSIDE_LABEL);
    expect(OUTSIDE_LABEL).toBe('Outside high-resolution coverage');
    expect(s.elevationM).toBeCloseTo(-2222);
    expect(useWorld.getState().askOpen).toBe(true);
    expect(elevationAt(rt, s.lon, s.lat).coarse).toBe(true);
    expect(NEEDS_HIRES_MESSAGE).toBe('Routes need the high-resolution Jezero area. Pick a point inside it.');
  });

  it('without context data an outside pick has no elevation instead of a made-up one', () => {
    pickPoint({ ...rt, context: null }, new THREE.Vector3(800, 0, -600));
    expect(useWorld.getState().selected!.elevationM).toBeNull();
  });
});
