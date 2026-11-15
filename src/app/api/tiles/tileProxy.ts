/**
 * Same-origin proxy and cache for the planet's imagery tiles (CTX global mosaic, Viking MDIM 2.1).
 *
 * Why: the CTX tile service answers a cold tile in 2 to 22 s from Singapore, so the browser sat on stretched Viking
 * imagery while zooming in. Served from here, a tile carries `Cache-Control: public, max-age=31536000, immutable`, so the
 * edge CDN in front of the app keeps it near the user and the browser never asks twice; a small in-memory LRU covers
 * repeats on this server between edge misses.
 *
 * Safety: the upstream host is fixed per layer (no URL is ever taken from the request), and z / row / col must be decimal
 * integers inside the layer's geographic 2 x 1 tile grid.
 *
 * Failure: one retry, then a 1 x 1 transparent PNG with HTTP 200 (never cached long), so the client falls back to the
 * ancestor tile or Viking colour without a network error in the console. The client treats a 1 x 1 image as "no tile".
 */

export type TileLayer = 'ctx' | 'viking';

interface LayerSpec { maxZ: number; url: (z: number, row: number, col: number) => string }

/** Fixed upstreams. Both use the same geographic grid: 2 columns x 1 row at z = 0. */
export const TILE_LAYERS: Record<TileLayer, LayerSpec> = {
  ctx: { maxZ: 12, url: (z, r, c) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${z}/${r}/${c}` },
  viking: { maxZ: 7, url: (z, r, c) => `https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg` },
};

export const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Upstream says the tile does not exist (outside coverage): cache the empty answer for a day. */
const EMPTY_CACHE = 'public, max-age=86400';
/** A truncated PNG the client can partly salvage: short cache, so a repaired upstream tile replaces it. */
const TRUNCATED_CACHE = 'public, max-age=3600';

/** 1 x 1 fully transparent RGBA PNG. */
export const EMPTY_PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64'));

/** z / row / col as integers inside the layer's grid, or null. Only plain decimal digits are accepted. */
export function parseTile(layer: TileLayer, z: string, row: string, col: string): { z: number; row: number; col: number } | null {
  const spec = TILE_LAYERS[layer];
  if (!spec || ![z, row, col].every((s) => /^\d{1,6}$/.test(s))) return null;
  const zi = Number(z), ri = Number(row), ci = Number(col);
  if (zi > spec.maxZ || ri >= 2 ** zi || ci >= 2 ** (zi + 1)) return null;
  return { z: zi, row: ri, col: ci };
}

/** True when `b` is a PNG that ends with its IEND chunk (the CTX service sometimes sends truncated PNGs with HTTP 200). */
export function isCompletePng(b: Uint8Array): boolean {
  if (b.length < 20 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return false;
  const t = b.length - 8;   // ... "IEND" + 4 CRC bytes
  return b[t] === 0x49 && b[t + 1] === 0x45 && b[t + 2] === 0x4e && b[t + 3] === 0x44;
}
const isPng = (b: Uint8Array) => b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

export interface TileResult { status: 'ok' | 'truncated' | 'empty' | 'error'; body: Uint8Array; type: string; cache: string }

/** Byte- and count-bounded LRU (Map insertion order). */
export class TileLru {
  private m = new Map<string, TileResult>();
  private bytes = 0;
  constructor(private maxEntries: number, private maxBytes: number) {}
  get size() { return this.m.size; }
  get totalBytes() { return this.bytes; }
  get(k: string): TileResult | undefined {
    const v = this.m.get(k);
    if (v) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: TileResult) {
    const old = this.m.get(k);
    if (old) { this.bytes -= old.body.byteLength; this.m.delete(k); }
    this.m.set(k, v); this.bytes += v.body.byteLength;
    while (this.m.size > this.maxEntries || (this.bytes > this.maxBytes && this.m.size > 1)) {
      const [ok, ov] = this.m.entries().next().value!;
      this.m.delete(ok); this.bytes -= ov.body.byteLength;
    }
  }
}

export interface ProxyOpts {
  fetch?: typeof fetch;
  maxEntries?: number; maxBytes?: number;
  /** Per attempt. A cold CTX tile has been measured at 22 s; the second attempt usually finds it rendered upstream. */
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Upstream requests in flight at once, across all clients. */
  concurrency?: number;
}

export function createTileProxy(o: ProxyOpts = {}) {
  const doFetch = o.fetch ?? fetch;
  const timeoutMs = o.timeoutMs ?? 12_000, retryDelayMs = o.retryDelayMs ?? 300, limit = o.concurrency ?? 24;
  const lru = new TileLru(o.maxEntries ?? 500, o.maxBytes ?? 96 * 1024 * 1024);
  const inflight = new Map<string, Promise<TileResult>>();
  const stats = { hits: 0, misses: 0, upstreamErrors: 0 };
  let active = 0;
  const waiters: (() => void)[] = [];
  const acquire = () => (active < limit ? (active++, Promise.resolve()) : new Promise<void>((r) => waiters.push(() => { active++; r(); })));
  const release = () => { active--; waiters.shift()?.(); };

  /** One upstream attempt, classified. */
  async function attempt(url: string): Promise<TileResult> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await doFetch(url, { signal: ctl.signal, headers: { accept: 'image/png,image/jpeg,image/*' } });
      if (res.status === 404 || res.status === 400) return { status: 'empty', body: EMPTY_PNG, type: 'image/png', cache: EMPTY_CACHE };
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !type.startsWith('image/')) return { status: 'error', body: EMPTY_PNG, type: 'image/png', cache: 'no-store' };
      const body = new Uint8Array(await res.arrayBuffer());
      if (isPng(body) && !isCompletePng(body)) return { status: 'truncated', body, type, cache: TRUNCATED_CACHE };
      if (body.length === 0) return { status: 'error', body: EMPTY_PNG, type: 'image/png', cache: 'no-store' };
      return { status: 'ok', body, type, cache: IMMUTABLE };
    } catch {
      return { status: 'error', body: EMPTY_PNG, type: 'image/png', cache: 'no-store' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(url: string): Promise<TileResult> {
    await acquire();
    try {
      const first = await attempt(url);
      if (first.status === 'ok' || first.status === 'empty') return first;
      await new Promise((r) => setTimeout(r, retryDelayMs));
      const second = await attempt(url);
      // a truncated tile beats nothing (the client salvages its rows); an error after a truncated first try keeps the rows
      if (second.status === 'error' && first.status === 'truncated') return first;
      return second;
    } finally {
      release();
    }
  }

  async function get(layer: TileLayer, z: number, row: number, col: number): Promise<TileResult & { hit: boolean }> {
    const key = `${layer}/${z}/${row}/${col}`;
    const hit = lru.get(key);
    if (hit) { stats.hits++; return { ...hit, hit: true }; }
    stats.misses++;
    let p = inflight.get(key);
    if (!p) {
      p = load(TILE_LAYERS[layer].url(z, row, col)).then((r) => {
        if (r.status === 'ok' || r.status === 'empty') lru.set(key, r);
        if (r.status === 'error') stats.upstreamErrors++;
        return r;
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return { ...(await p), hit: false };
  }

  /** The HTTP response for a route's raw params. */
  async function serve(layer: TileLayer, p: { z: string; row: string; col: string }): Promise<Response> {
    const t = parseTile(layer, p.z, p.row, p.col);
    if (!t) return new Response('tile address out of range', { status: 400, headers: { 'content-type': 'text/plain', 'cache-control': 'public, max-age=86400' } });
    const r = await get(layer, t.z, t.row, t.col);
    return new Response(r.body as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        'content-type': r.type, 'cache-control': r.cache, 'content-length': String(r.body.byteLength),
        'x-tile-status': r.status, 'x-tile-cache': r.hit ? 'hit' : 'miss',
      },
    });
  }

  return { get, serve, stats, lru };
}

/** One proxy per server process, shared by the CTX and Viking routes (survives dev hot reloads). */
const g = globalThis as unknown as { __marsTileProxy?: ReturnType<typeof createTileProxy> };
export const tileProxy = (): ReturnType<typeof createTileProxy> => (g.__marsTileProxy ??= createTileProxy());
