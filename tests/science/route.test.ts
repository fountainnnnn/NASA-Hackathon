import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/rover-images/route';
import { isFullFrame, normalizeRawImages } from '@/lib/science/rover';

const call = (q: string) => GET(new Request(`http://localhost/api/rover-images${q}`));

afterEach(() => vi.unstubAllGlobals());

describe('GET /api/rover-images', () => {
  it.each(['', '?sol=abc', '?sol=-1', '?sol=5001', '?sol=1.5', '?sol=12345', '?sol=1e3'])('rejects %s', async (q) => {
    const res = await call(q);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.images).toEqual([]);
    expect(body.error).toBeTruthy();
  });

  it('normalises NASA records, credits ASU for Mastcam-Z, drops RMI/subframes, caches 24 h', async () => {
    const rec = (id: string, instrument: string, dimension = '(1280,960)', sample_type = 'Full') => ({
      imageid: id, sol: 4242, sample_type, date_taken_utc: '2022-01-02T03:04:05', link: `https://mars.nasa.gov/p/${id}`,
      camera: { instrument }, extended: { dimension },
      image_files: { medium: `https://mars.nasa.gov/${id}_800.jpg`, large: `https://mars.nasa.gov/${id}_1200.jpg` },
    });
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ images: [
      rec('m', 'MCZ_LEFT'), rec('n', 'NAVCAM_LEFT'), rec('r', 'SUPERCAM_RMI'), rec('s', 'MCZ_RIGHT', '(128,128)'), rec('t', 'NAVCAM_RIGHT', '(1280,960)', 'Thumbnail'),
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('?sol=4242');
    const body = await res.json();
    expect(body.sol).toBe(4242);
    expect(body.images.map((i: { id: string }) => i.id)).toEqual(['m', 'n']);
    expect(body.images[0].credit).toBe('NASA/JPL-Caltech/ASU');
    expect(body.images[1].credit).toBe('NASA/JPL-Caltech');
    expect(body.images[0].url).toMatch(/_800\.jpg$/);
    expect(body.images[0].earthDate).toBe('2022-01-02');
    expect(String(fetchMock.mock.calls[0][0])).toContain('sol=4242');
    await call('?sol=4242');
    expect(fetchMock).toHaveBeenCalledTimes(1); // second hit served from memory
  });

  it('reports upstream failure as {images: [], error}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const body = await (await call('?sol=4343')).json();
    expect(body).toMatchObject({ sol: 4343, images: [] });
    expect(body.error).toBeTruthy();
  });
});

describe('rover helpers', () => {
  it('isFullFrame', () => {
    expect(isFullFrame('(1280,960)')).toBe(true);
    expect(isFullFrame('(128,128)')).toBe(false);
    expect(isFullFrame(undefined)).toBe(true);
    expect(normalizeRawImages([], 1)).toEqual([]);
  });
});
