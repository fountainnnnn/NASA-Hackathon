import { describe, expect, it } from 'vitest';
import { createScience } from '@/lib/science';
import { dataRoutes, img, mockFetch, traverse } from './fixtures';

async function loaded(extra: Record<string, unknown> = {}) {
  const m = mockFetch({ ...dataRoutes, ...extra });
  const s = createScience(m.fn);
  await s.load();
  return { s, m };
}

describe('lookups (synthetic test fixture)', () => {
  it('geologyAt respects holes and bbox', async () => {
    const { s } = await loaded();
    expect(s.geologyAt({ lon: 77.25, lat: 18.3 })?.symbol).toBe('NHjf2');
    expect(s.geologyAt({ lon: 77.4, lat: 18.45 })).toBeNull(); // hole
    expect(s.geologyAt({ lon: 77.65, lat: 18.3 })).toBeNull(); // outside every polygon
    expect(s.geologyAt({ lon: 77.6, lat: 18.1 })?.symbol).toBe('Njf');
  });
  it('namesNear sorted with bearing', async () => {
    const { s } = await loaded();
    const r = s.namesNear({ lon: 77.2, lat: 18.4 }, 20);
    expect(r.map((x) => x.name)).toEqual(['East Test', 'North Test']);
    expect(r[0].bearingDeg).toBeCloseTo(90, 0);
    expect(r[1].distanceKm).toBeCloseTo(5.93, 1);
    expect(r[1].bearingDeg).toBeCloseTo(0, 3);
    expect(s.namesNear({ lon: 77.2, lat: 18.4 }, 1)).toEqual([]);
  });
  it('nearestTraverse and sitesNear', async () => {
    const { s } = await loaded();
    expect(s.nearestTraverse({ lon: 77.2004, lat: 18.4 })?.sol).toBe(20);
    expect(s.sitesNear({ lon: 77.2, lat: 18.4 }, 10).map((x) => x.id)).toEqual(['s-near']);
  });
});

describe('suggestStops', () => {
  it('returns only points inside the objective unit polygons or curated sites, sorted by distance', async () => {
    const { s } = await loaded();
    const from = { lon: 77.2, lat: 18.45 };
    const r = s.suggestStops('delta-sediments', from, 200, 10);
    expect(r.length).toBeGreaterThan(2);
    for (let i = 1; i < r.length; i++) expect(r[i].distanceKm).toBeGreaterThanOrEqual(r[i - 1].distanceKm);
    for (const st of r) {
      if (st.unit) expect(s.geologyAt(st)?.symbol).toBe(st.unit); // inside a mapped polygon of that unit
      else expect(st.siteId).toBeDefined();
      expect(st.sourceUrl).toMatch(/^https:/);
      expect(st.why.length).toBeGreaterThan(0);
    }
    expect(r.some((x) => x.siteId === 's-near')).toBe(true);
  });
  it('clips unit points to the DEM footprint', async () => {
    const { s } = await loaded();
    const r = s.suggestStops('crater-floor', { lon: 77.55, lat: 18.1 }, 500, 10);
    expect(r).toEqual([]); // Njf box lies south of the DEM (lat < 18.211): not routable
  });
  it('respects maxKm and unmapped objectives', async () => {
    const { s } = await loaded();
    const from = { lon: 77.2, lat: 18.45 };
    expect(s.suggestStops('delta-sediments', from, 5, 10).every((x) => x.distanceKm <= 5)).toBe(true);
    expect(s.suggestStops('aeolian', from, 200, 10)).toEqual([]);
    expect(s.suggestStops('astrobiology-samples', from, 200, 10).map((x) => x.siteId)).toEqual(['s-near']);
    expect(s.suggestStops('delta-sediments', from, 200, 1)).toHaveLength(1);
  });
});

describe('roverImagesNear', () => {
  const p = { lon: 77.2002, lat: 18.4 }; // nearest waypoint is sol 10 (~22 m) then sol 20 (~33 m)
  it('uses the nearest sol from cache, preferring human-eye cameras', async () => {
    const cache = { sol: 10, images: [img('a', 10, 'SKYCAM'), img('b', 10, 'REAR_HAZCAM_LEFT'), img('c', 10, 'NAVCAM_LEFT'), img('d', 10, 'MCZ_LEFT')] };
    const { s, m } = await loaded({ '/data/rover_cache/10.json': cache });
    const r = await s.roverImagesNear(p, 100, 3);
    expect(r?.sol).toBe(10);
    expect(r!.images.map((i) => i.id)).toEqual(['d', 'c', 'b']);
    expect(m.calls.some((c) => c.startsWith('/api/rover-images'))).toBe(false);
  });
  it('falls back from cache to the API route', async () => {
    const { s, m } = await loaded({ '/api/rover-images?sol=10': { sol: 10, images: [img('x', 10, 'NAVCAM_RIGHT')] } });
    const r = await s.roverImagesNear(p, 100, 5);
    expect(r?.images.map((i) => i.id)).toEqual(['x']);
    expect(m.calls).toContain('/data/rover_cache/10.json');
    expect(m.calls).toContain('/api/rover-images?sol=10');
  });
  it('skips a sol with no images and moves to the next nearest', async () => {
    const { s } = await loaded({
      '/api/rover-images?sol=10': { sol: 10, images: [] },
      '/data/rover_cache/20.json': { sol: 20, images: [img('y', 20, 'MCZ_RIGHT')] },
    });
    const r = await s.roverImagesNear(p, 100, 5);
    expect(r?.sol).toBe(20);
    expect(r!.distanceM).toBeGreaterThan(traverse.points[0].distTotalM);
  });
  it('returns null when nothing is in range', async () => {
    const { s } = await loaded();
    expect(await s.roverImagesNear({ lon: 77.5, lat: 18.9 }, 100, 5)).toBeNull();
  });
});
