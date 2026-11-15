import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EMPTY_PNG, IMMUTABLE, TileLru, createTileProxy, isCompletePng, parseTile } from '../../src/app/api/tiles/tileProxy';

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Bytes that look like a complete PNG (signature ... IEND + CRC). */
const fakePng = (n = 64) => Uint8Array.from([...PNG_HEAD, ...new Array(n).fill(7), 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const res = (status: number, body: Uint8Array | string, type = 'image/png') => new Response(body as BodyInit, { status, headers: { 'content-type': type } });

function fakeFetch(script: (url: string, n: number) => Response | Promise<Response> | 'hang') {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(url);
    const r = script(url, calls.length);
    if (r === 'hang') return new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    return r;
  }) as typeof fetch;
  return { f, calls };
}

describe('parseTile', () => {
  it('accepts addresses inside the 2 x 1 geographic grid', () => {
    expect(parseTile('ctx', '12', '1560', '5850')).toEqual({ z: 12, row: 1560, col: 5850 });
    expect(parseTile('ctx', '0', '0', '1')).toEqual({ z: 0, row: 0, col: 1 });
    expect(parseTile('viking', '7', '127', '255')).toEqual({ z: 7, row: 127, col: 255 });
  });
  it('rejects out-of-range, non-integer and non-decimal input', () => {
    for (const [z, r, c] of [['13', '0', '0'], ['0', '1', '0'], ['0', '0', '2'], ['12', '4096', '0'], ['12', '0', '8192'], ['-1', '0', '0'], ['1.5', '0', '0'], ['0x1', '0', '0'], ['1e1', '0', '0'], ['', '0', '0'], ['3', '0', '0/../x']]) {
      expect(parseTile('ctx', z, r, c)).toBeNull();
    }
    expect(parseTile('viking', '8', '0', '0')).toBeNull();
    expect(parseTile('other' as 'ctx', '0', '0', '0')).toBeNull();
  });
});

describe('isCompletePng / EMPTY_PNG', () => {
  it('tells complete from truncated PNGs', () => {
    expect(isCompletePng(fakePng())).toBe(true);
    expect(isCompletePng(fakePng().slice(0, 50))).toBe(false);
    expect(isCompletePng(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe(false);
  });
  it('the fallback is a 1 x 1 fully transparent PNG', async () => {
    const { data, info } = await sharp(Buffer.from(EMPTY_PNG)).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1, 1]);
    expect(data[3]).toBe(0);
  });
});

describe('TileLru', () => {
  const t = (n: number) => ({ status: 'ok' as const, body: new Uint8Array(n), type: 'image/png', cache: IMMUTABLE });
  it('evicts the least recently used by count and by bytes', () => {
    const l = new TileLru(2, 1000);
    l.set('a', t(10)); l.set('b', t(10)); l.get('a'); l.set('c', t(10));
    expect([l.get('a'), l.get('b'), l.get('c')].map(Boolean)).toEqual([true, false, true]);
    const m = new TileLru(10, 100);
    m.set('a', t(60)); m.set('b', t(60));
    expect(m.get('a')).toBeUndefined(); expect(m.totalBytes).toBe(60);
  });
});

describe('createTileProxy', () => {
  it('only ever requests the fixed upstream host, and serves hits from memory with an immutable cache header', async () => {
    const { f, calls } = fakeFetch(() => res(200, fakePng()));
    const p = createTileProxy({ fetch: f, retryDelayMs: 0 });
    const a = await p.serve('ctx', { z: '11', row: '833', col: '2925' });
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(a.headers.get('x-tile-cache')).toBe('miss');
    const b = await p.serve('ctx', { z: '11', row: '833', col: '2925' });
    expect(b.headers.get('x-tile-cache')).toBe('hit');
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(fakePng());
    await p.serve('viking', { z: '7', row: '48', col: '183' });
    expect(calls).toEqual([
      'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/11/833/2925',
      'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/7/48/183.jpg',
    ]);
  });
  it('answers a bad address with 400 and never fetches', async () => {
    const { f, calls } = fakeFetch(() => res(200, fakePng()));
    const r = await createTileProxy({ fetch: f }).serve('ctx', { z: '12', row: '99999', col: '0' });
    expect(r.status).toBe(400); expect(calls).toHaveLength(0);
  });
  it('retries once on HTTP 500, then succeeds', async () => {
    const { f, calls } = fakeFetch((_, n) => (n === 1 ? res(500, 'oops', 'text/html') : res(200, fakePng())));
    const r = await createTileProxy({ fetch: f, retryDelayMs: 0 }).serve('ctx', { z: '5', row: '1', col: '1' });
    expect(calls).toHaveLength(2);
    expect(r.headers.get('x-tile-status')).toBe('ok');
  });
  it('after two failures returns the transparent 1 x 1 PNG with HTTP 200 and no-store, and does not cache it', async () => {
    const { f, calls } = fakeFetch(() => res(500, 'oops', 'text/html'));
    const p = createTileProxy({ fetch: f, retryDelayMs: 0 });
    const r = await p.serve('ctx', { z: '5', row: '1', col: '1' });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-tile-status')).toBe('error');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(EMPTY_PNG);
    await p.serve('ctx', { z: '5', row: '1', col: '1' });
    expect(calls).toHaveLength(4);
  });
  it('times out a hung upstream, retries, and falls back', async () => {
    const { f, calls } = fakeFetch(() => 'hang');
    const r = await createTileProxy({ fetch: f, timeoutMs: 20, retryDelayMs: 0 }).serve('ctx', { z: '5', row: '1', col: '1' });
    expect(calls).toHaveLength(2);
    expect(r.headers.get('x-tile-status')).toBe('error');
  });
  it('a 404 (outside coverage) is an empty tile cached for a day, without a retry', async () => {
    const { f, calls } = fakeFetch(() => res(404, 'nope', 'text/html'));
    const r = await createTileProxy({ fetch: f, retryDelayMs: 0 }).serve('ctx', { z: '12', row: '4000', col: '100' });
    expect(calls).toHaveLength(1);
    expect(r.headers.get('x-tile-status')).toBe('empty');
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400');
  });
  it('passes a truncated PNG through with a short cache when the retry is truncated too (the client salvages its rows)', async () => {
    const cut = fakePng().slice(0, 40);
    const { f, calls } = fakeFetch(() => res(200, cut));
    const r = await createTileProxy({ fetch: f, retryDelayMs: 0 }).serve('ctx', { z: '11', row: '1', col: '1' });
    expect(calls).toHaveLength(2);
    expect(r.headers.get('x-tile-status')).toBe('truncated');
    expect(r.headers.get('cache-control')).toBe('public, max-age=3600');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(cut);
  });
  it('treats a non-image 200 as a failure', async () => {
    const { f } = fakeFetch(() => res(200, '<html>', 'text/html'));
    const r = await createTileProxy({ fetch: f, retryDelayMs: 0 }).serve('ctx', { z: '3', row: '1', col: '1' });
    expect(r.headers.get('x-tile-status')).toBe('error');
  });
  it('shares one upstream request between concurrent requests for the same tile', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { f, calls } = fakeFetch(async () => { await gate; return res(200, fakePng()); });
    const p = createTileProxy({ fetch: f });
    const all = Promise.all([1, 2, 3].map(() => p.serve('ctx', { z: '9', row: '100', col: '200' })));
    release();
    expect((await all).every((r) => r.status === 200)).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
