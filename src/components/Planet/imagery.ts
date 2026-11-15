/**
 * Mars imagery providers for Cesium: the Viking MDIM 2.1 colour mosaic, colour graded, and a fused layer that adds the
 * CTX 5 m mosaic's detail on top of Viking's colour (pixel maths in imageryBlend.ts). Both share one geographic 2 x 1
 * tile grid, so a CTX tile at any level sits inside one Viking ancestor tile.
 *
 * The CTX request carries Cesium's Request, so it is throttled and cancelled with the rest of the globe's tiles; Viking
 * ancestors are cached and shared by many CTX tiles. Pixel work runs in a small worker pool (imagery.worker.ts) so the
 * render loop never waits on it; without OffscreenCanvas it falls back to the main thread.
 *
 * Tiles come through the app's own proxy (/api/tiles/{ctx|viking}/z/row/col, src/app/api/tiles/tileProxy.ts): the CTX
 * service takes 2 to 22 s per cold tile from Singapore, the proxy's responses are edge-cached as immutable. `?tiles=direct`
 * fetches the upstreams directly (for before / after timing). The proxy answers a missing or failed tile with a 1 x 1
 * transparent PNG, which counts as "no tile" here.
 *
 * The provider also records which CTX level has actually arrived where (`ctxLevelAt`), so the engine can hold the camera
 * at a height the loaded imagery supports, and prefetches the next levels under the view (`prefetch`).
 */
import type * as CesiumNS from 'cesium';
import { cropWithMargin, fuseTile, vikingSource } from './imageryBlend';
import type { FuseJob, FuseReply } from './imagery.worker';
import { CTX, VIKING } from './planetMath';
import { salvageGrayPng } from './pngSalvage';

type C = typeof CesiumNS;
type Img = ImageBitmap | HTMLImageElement;
type Tile = ImageBitmap | HTMLCanvasElement;
/** CTX adds nothing at whole-hemisphere scale (and the service errors on some level 1 tiles): Viking alone below this. */
const FUSE_MIN_LEVEL = 3;

let direct = false;
const vikingUrl = (l: number, y: number, x: number) => direct
  ? `https://trek.nasa.gov/tiles/Mars/EQ/${VIKING.layer}/1.0.0/default/${VIKING.tileMatrixSetID}/${l}/${y}/${x}.jpg`
  : `/api/tiles/viking/${l}/${y}/${x}`;
const ctxUrl = (l: number, y: number, x: number) => direct
  ? `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${l}/${y}/${x}`
  : `/api/tiles/ctx/${l}/${y}/${x}`;
/** The proxy's "no tile" answer (1 x 1 transparent PNG). */
const isEmptyTile = (img: Img) => img.width <= 1 && img.height <= 1;

/* ------------------------------------------------------------------ resolution maths (pure, unit-tested) */

/** Mars radius used by both tile services' geographic grids (GCS_Mars_2000_Sphere), m. */
const GRID_RADIUS_M = 3_396_190;
/** Ground size of one pixel north-south, m, for a tile of `tileSize` px at `level` of the 2 x 1 geographic grid. */
export const texelM = (level: number, tileSize: number) => (180 / 2 ** level / tileSize) * (Math.PI * GRID_RADIUS_M / 180);
/** CTX metres per pixel at a level (level 12, the finest the mosaic is served at natively: 5.09 m). */
export const ctxTexelM = (level: number) => texelM(level, CTX.tileSize);
/** Viking at its finest tile level (7): 326 m per pixel (the mosaic is 232 m native, resampled into the tile pyramid). */
export const VIKING_TEXEL_M = texelM(VIKING.maxLevel, VIKING.tileSize);
/** One imagery pixel may cover at most this many screen (CSS) pixels before the camera is held: beyond it the ground is a smear. */
export const MAX_SCREEN_PX_PER_TEXEL = 3;

/** Tile column / row at `level` that contains lon / lat (degrees). */
export function tileAt(lon: number, lat: number, level: number): { x: number; y: number } {
  const n = 2 ** level;
  const x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * 2 * n);
  const y = Math.floor((90 - Math.max(-90, Math.min(90, lat))) / 180 * n);
  return { x: Math.min(2 * n - 1, x), y: Math.min(n - 1, y) };
}

/** Ground metres per screen pixel at the view centre, `rangeM` from it, for a viewport `heightPx` tall with vertical FOV `fovy`. */
export const groundPxM = (rangeM: number, heightPx: number, fovy: number) => (rangeM * 2 * Math.tan(fovy / 2)) / Math.max(heightPx, 1);

/** The closest the camera may come (m) so one pixel of `texel` metres spans at most MAX_SCREEN_PX_PER_TEXEL screen pixels. */
export const floorRangeM = (texel: number, heightPx: number, fovy: number, maxPx = MAX_SCREEN_PX_PER_TEXEL) =>
  (texel * Math.max(heightPx, 1)) / (maxPx * 2 * Math.tan(fovy / 2));

/** The CTX level a view with `groundPx` metres per screen pixel wants: the coarsest whose pixel is at most 0.75 screen px. */
export function ctxLevelFor(groundPx: number): number {
  for (let l = FUSE_MIN_LEVEL; l < CTX.maxLevel; l++) if (ctxTexelM(l) <= groundPx * 0.75) return l;
  return CTX.maxLevel;
}

/**
 * Tiles of `level` within `halfW` x `halfH` degrees of lon / lat, nearest first, at most `max`. Used to prefetch the
 * levels the user is zooming into, around the centre they zoom toward.
 */
export function tilesAround(lon: number, lat: number, level: number, halfW: number, halfH: number, max: number): { x: number; y: number }[] {
  const n = 2 ** level, deg = 180 / n;
  const c = tileAt(lon, lat, level);
  const rx = Math.min(n, Math.ceil(halfW / deg)), ry = Math.ceil(halfH / deg);
  const out: { x: number; y: number; d: number }[] = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const y = c.y + dy; if (y < 0 || y >= n) continue;
    for (let dx = -rx; dx <= rx; dx++) {
      const x = (((c.x + dx) % (2 * n)) + 2 * n) % (2 * n);
      // skip tiles wholly outside the window
      const tLon = -180 + (x + 0.5) * deg, tLat = 90 - (y + 0.5) * deg;
      const dLon = Math.abs((((tLon - lon) % 360) + 540) % 360 - 180);
      if (dLon > halfW + deg / 2 || Math.abs(tLat - lat) > halfH + deg / 2) continue;
      out.push({ x, y, d: dx * dx + dy * dy });
    }
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max).map(({ x, y }) => ({ x, y }));
}

/* ------------------------------------------------------------------ fusion: worker pool, or main thread */

interface Fuse { size: number; viking: Img | null; crop: { sx: number; sy: number; sub: number }; ctx: Img | null }

class Fuser {
  private workers: Worker[] = [];
  private next = 0;
  private seq = 0;
  private pending = new Map<number, { res: (t: Tile) => void; rej: (e: Error) => void }>();
  constructor() {
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined' || new URLSearchParams(location.search).get('fuse') === 'main') return;
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 2));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./imagery.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<FuseReply>) => {
          const p = this.pending.get(e.data.id); if (!p) return;
          this.pending.delete(e.data.id);
          if ('bitmap' in e.data) p.res(e.data.bitmap); else p.rej(new Error(e.data.error));
        };
        this.workers.push(w);
      }
    } catch { this.workers = []; }
  }
  get threads() { return this.workers.length; }
  async run(j: Fuse): Promise<Tile> {
    const m = cropWithMargin(j.crop.sx, j.crop.sy, j.crop.sub, VIKING.tileSize);
    if (!this.workers.length) return fuseOnMain(j, m);
    const viking = j.viking ? await createImageBitmap(j.viking, m.x, m.y, m.w, m.h) : null;
    const ctx = j.ctx ? (j.ctx instanceof ImageBitmap ? j.ctx : await createImageBitmap(j.ctx)) : null;
    const id = ++this.seq;
    const job: FuseJob = { id, size: j.size, viking, ml: m.ml, mt: m.mt, sub: j.crop.sub, ctx };
    return new Promise<Tile>((res, rej) => {
      this.pending.set(id, { res, rej });
      const w = this.workers[this.next++ % this.workers.length];
      w.postMessage(job, [viking, ctx].filter((b): b is ImageBitmap => !!b));
    });
  }
  destroy() { this.workers.forEach((w) => w.terminate()); this.workers = []; this.pending.clear(); }
}

let mainCtx: CanvasRenderingContext2D | null = null;
function fuseOnMain(j: Fuse, m: ReturnType<typeof cropWithMargin>): HTMLCanvasElement {
  const size = j.size;
  if (!mainCtx || mainCtx.canvas.width !== size) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    mainCtx = cv.getContext('2d', { willReadFrequently: true })!;
  }
  const g = mainCtx;
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.clearRect(0, 0, size, size);
  let v: Uint8ClampedArray;
  if (j.viking) {
    const s = size / j.crop.sub;
    g.drawImage(j.viking, m.x, m.y, m.w, m.h, -m.ml * s, -m.mt * s, m.w * s, m.h * s);
    v = g.getImageData(0, 0, size, size).data;
  } else v = new Uint8ClampedArray(size * size * 4).fill(110);
  let c: Uint8ClampedArray | null = null;
  if (j.ctx) { g.clearRect(0, 0, size, size); g.drawImage(j.ctx, 0, 0, size, size); c = g.getImageData(0, 0, size, size).data; }
  fuseTile(v, c, size, v);
  const out = document.createElement('canvas'); out.width = out.height = size;   // unflipped: Cesium flips canvases on upload
  out.getContext('2d')!.putImageData(new ImageData(v as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
  return out;
}

/* ------------------------------------------------------------------ providers */

abstract class MarsProvider {
  readonly tilingScheme: CesiumNS.GeographicTilingScheme;
  readonly rectangle: CesiumNS.Rectangle;
  readonly errorEvent: CesiumNS.Event;
  readonly minimumLevel = 0;
  readonly hasAlphaChannel = false;
  readonly tileDiscardPolicy = undefined;
  readonly credit = undefined;
  readonly proxy = undefined;
  abstract readonly tileWidth: number;
  abstract readonly tileHeight: number;
  abstract readonly maximumLevel: number;
  /** Tiles that failed (Cesium then keeps the parent tile). Counted for the debug stats instead of logged per tile. */
  failures = 0;
  constructor(protected C: C, ellipsoid: CesiumNS.Ellipsoid, protected fuser: Fuser) {
    this.tilingScheme = new C.GeographicTilingScheme({ ellipsoid });
    this.rectangle = this.tilingScheme.rectangle;
    this.errorEvent = new C.Event();
    this.errorEvent.addEventListener(() => { this.failures++; });
  }
  getTileCredits() { return []; }
  pickFeatures() { return undefined; }
  protected fetch(url: string, request?: CesiumNS.Request): Promise<Img> | undefined {
    return new this.C.Resource({ url, request }).fetchImage({ preferImageBitmap: true, flipY: false }) as Promise<Img> | undefined;
  }
  abstract requestImage(x: number, y: number, level: number, request?: CesiumNS.Request): Promise<Tile> | undefined;
}

/** Viking colour, graded exactly like the fused layer so the two meet without a seam. */
class VikingProvider extends MarsProvider {
  readonly tileWidth = VIKING.tileSize; readonly tileHeight = VIKING.tileSize; readonly maximumLevel = VIKING.maxLevel;
  requestImage(x: number, y: number, level: number, request?: CesiumNS.Request) {
    const p = this.fetch(vikingUrl(level, y, x), request);
    if (!p) return undefined;
    return p.then((img) => {
      if (isEmptyTile(img)) throw new Error(`no Viking tile ${level}/${y}/${x}`);   // Cesium keeps the parent tile
      return this.fuser.run({ size: this.tileWidth, viking: img, crop: { sx: 0, sy: 0, sub: VIKING.tileSize }, ctx: null });
    });
  }
}

/** Wait before the one retry of a CTX tile that failed on the network, ms. */
const CTX_RETRY_MS = 900;
/** Ancestor levels tried for a CTX tile the service cannot send. */
const CTX_PARENT_LEVELS = 2;
/** The browser could not decode the bytes (a truncated PNG), as opposed to a network or HTTP failure. */
const isDecodeError = (e: unknown) => typeof DOMException !== 'undefined' && e instanceof DOMException && /decod/i.test(e.message);

/**
 * CTX detail on Viking colour. The CTX tile service fails some tiles in two ways, and both used to leave a Viking-only
 * patch (232 m) beside 5 m neighbours, a hard seam in the landing shots:
 *  - HTTP 500 for holes in its cache (for example around 14N 72E at level 11). The proxy retries once and then answers
 *    with a 1 x 1 transparent PNG (no client retry, no console error). Fetched directly (`?tiles=direct`) the error has no
 *    CORS header and is retried here once after CTX_RETRY_MS.
 *  - HTTP 200 with a truncated grayscale PNG (no IEND), which the browser refuses to decode. Its bytes are fetched again
 *    (from the HTTP cache), every row that arrived is kept (pngSalvage.ts) and the missing rows come from the ancestor.
 * A tile that still has nothing takes the matching part of its nearest ancestor CTX tile (up to two levels up), and with
 * no ancestor it is no data: Viking colour alone, graded exactly like the base layer, so the Viking layer shows through.
 * It never rejects for these, so Cesium logs nothing. Known holes are remembered and not fetched again this session.
 */
class FusedProvider extends MarsProvider {
  readonly tileWidth = CTX.tileSize; readonly tileHeight = CTX.tileSize; readonly maximumLevel = CTX.maxLevel;
  private viking = new Map<string, Promise<Img | null>>();
  private noData = new Set<string>();
  /** Fused tiles delivered to Cesium: key l/y/x -> the CTX level whose pixels they carry (lower when filled from an ancestor). */
  private delivered = new Map<string, number>();
  /** CTX tile requests in flight (fetch to fused tile). */
  pending = 0;
  /** CTX tiles with no usable pixels of their own after the retry or salvage (debug stats). */
  ctxNoData = 0;
  /** CTX tiles rebuilt from a truncated PNG (debug stats). */
  ctxSalvaged = 0;
  /**
   * A truncated tile: the rows that arrived, as a bitmap. Given the tile's address, the rows that never arrived are filled
   * from the nearest ancestor CTX tile (so the strip keeps CTX detail at lower resolution instead of showing Viking alone);
   * without it they stay transparent (no data). Null when nothing can be decoded.
   */
  private async salvage(url: string, at?: { l: number; y: number; x: number }): Promise<Img | null> {
    try {
      const buf = await new this.C.Resource({ url }).fetchArrayBuffer();
      const t = buf ? await salvageGrayPng(buf) : null;
      if (!t) return null;
      const own = await createImageBitmap(new ImageData(t.rgba as Uint8ClampedArray<ArrayBuffer>, t.width, t.height));
      this.ctxSalvaged++;
      if (!at || t.rows >= t.height || typeof OffscreenCanvas === 'undefined') return own;
      const under = (await this.ancestorCtx(at.l, at.y, at.x))?.img;
      if (!under) return own;
      const cv = new OffscreenCanvas(t.width, t.height), g = cv.getContext('2d')!;
      g.drawImage(under, 0, 0, t.width, t.height);
      g.drawImage(own, 0, 0);
      own.close();
      if (under instanceof ImageBitmap) under.close();
      return await createImageBitmap(cv);
    } catch { return null; }
  }
  /** One CTX tile, salvaging a truncated PNG; null when it cannot be had (including the proxy's empty tile). */
  private async load(url: string): Promise<Img | null> {
    try {
      const img = await this.fetch(url);
      return img && !isEmptyTile(img) ? img : null;
    } catch (e) { return isDecodeError(e) ? this.salvage(url) : null; }
  }
  private async ctxOrNoData(first: Promise<Img>, l: number, y: number, x: number, request?: CesiumNS.Request): Promise<{ img: Img; level: number } | null> {
    const url = ctxUrl(l, y, x);
    try {
      const img = await first;
      if (!isEmptyTile(img)) return { img, level: l };
      // the proxy already retried upstream and has nothing: straight to the ancestor
    } catch (e) {
      // cancelled by Cesium (tile no longer wanted): let it reschedule the tile instead of drawing it without CTX
      if (request?.state === this.C.RequestState.CANCELLED) throw e;
      if (isDecodeError(e)) { const s = await this.salvage(url, { l, y, x }); if (s) return { img: s, level: l }; }
      else {
        await new Promise((r) => setTimeout(r, CTX_RETRY_MS));
        const again = await this.load(url);
        if (again) return { img: again, level: l };
      }
    }
    this.noData.add(`${l}/${y}/${x}`);
    this.ctxNoData++;
    return this.ancestorCtx(l, y, x);
  }
  /** The part of the nearest ancestor CTX tile that covers tile l/y/x, or null when none loads (or the level is Viking only). */
  private async ancestorCtx(l: number, y: number, x: number): Promise<{ img: Img; level: number } | null> {
    for (let k = 1; k <= CTX_PARENT_LEVELS && l - k >= FUSE_MIN_LEVEL; k++) {
      const pl = l - k, py = y >> k, px = x >> k;
      if (this.noData.has(`${pl}/${py}/${px}`)) continue;
      const img = await this.load(ctxUrl(pl, py, px));
      if (!img) { this.noData.add(`${pl}/${py}/${px}`); continue; }
      try {
        const n = 1 << k, w = img.width / n, h = img.height / n;
        return { img: await createImageBitmap(img, (x - px * n) * w, (y - py * n) * h, w, h), level: pl };
      } catch { /* try the next level up */ }
    }
    return null;
  }
  private vikingTile(l: number, y: number, x: number): Promise<Img | null> {
    const k = `${l}/${y}/${x}`;
    let p = this.viking.get(k);
    if (p) { this.viking.delete(k); this.viking.set(k, p); return p; }   // LRU touch
    p = (this.fetch(vikingUrl(l, y, x)) ?? Promise.resolve(null)).then((img) => (img && !isEmptyTile(img) ? img : null), () => null);
    this.viking.set(k, p);
    if (this.viking.size > 96) this.viking.delete(this.viking.keys().next().value!);
    return p;
  }
  private markDelivered(key: string, level: number) {
    this.delivered.delete(key); this.delivered.set(key, level);
    if (this.delivered.size > 6000) this.delivered.delete(this.delivered.keys().next().value!);
  }
  /** Finest CTX level delivered to the globe at lon / lat (degrees), or -1 when only Viking is there. */
  levelAt(lon: number, lat: number): number {
    let best = -1;
    for (let l = CTX.maxLevel; l >= FUSE_MIN_LEVEL && l > best; l--) {
      const t = tileAt(lon, lat, l), got = this.delivered.get(`${l}/${t.y}/${t.x}`);
      if (got !== undefined && got > best) best = got;
    }
    return best;
  }
  /** True once tile l/y/x has been delivered with its own CTX pixels (prefetch skips it). */
  has(l: number, y: number, x: number) { return this.delivered.get(`${l}/${y}/${x}`) === l; }
  requestImage(x: number, y: number, level: number, request?: CesiumNS.Request) {
    let ctx: Promise<{ img: Img; level: number } | null>;
    let counted = false;
    if (level < FUSE_MIN_LEVEL || this.noData.has(`${level}/${y}/${x}`)) ctx = Promise.resolve(null);
    else {
      const first = this.fetch(ctxUrl(level, y, x), request);
      if (!first) return undefined;   // throttled: Cesium asks again later
      this.pending++; counted = true;
      ctx = this.ctxOrNoData(first, level, y, x, request);
    }
    const src = vikingSource(x, y, level, VIKING.maxLevel, VIKING.tileSize);
    return Promise.all([ctx, this.vikingTile(src.level, src.y, src.x)])
      .then(async ([c, v]) => {
        const tile = await this.fuser.run({ size: this.tileWidth, viking: v, crop: { sx: src.sx, sy: src.sy, sub: src.size }, ctx: c?.img ?? null });
        if (c) this.markDelivered(`${level}/${y}/${x}`, c.level);
        return tile;
      })
      .finally(() => { if (counted) this.pending--; });
  }
}

/* ------------------------------------------------------------------ prefetch */

/** Prefetches running at once (the brief: at most 8, so they never crowd out the tiles Cesium is waiting for). */
const PREFETCH_CONCURRENCY = 8;

/**
 * Warms the HTTP cache (and the proxy's edge cache) with CTX tiles the user is about to need. Each call replaces the
 * queue of not-yet-started requests, so a moving camera never builds a backlog; in-flight requests finish.
 */
class Prefetcher {
  private queue: string[] = [];
  private seen = new Set<string>();
  private active = 0;
  /** Prefetch requests completed (debug stats). */
  done = 0;
  request(urls: string[]) {
    this.queue = urls.filter((u) => !this.seen.has(u));
    this.pump();
  }
  private pump() {
    while (this.active < PREFETCH_CONCURRENCY && this.queue.length) {
      const url = this.queue.shift()!;
      this.seen.add(url);
      if (this.seen.size > 4000) this.seen.delete(this.seen.values().next().value!);
      this.active++;
      fetch(url, { priority: 'low', credentials: 'same-origin' } as RequestInit)
        .then((r) => r.arrayBuffer()).catch(() => { this.seen.delete(url); })
        .finally(() => { this.active--; this.done++; this.pump(); });
    }
  }
}

export interface MarsImagery {
  base: CesiumNS.ImageryProvider; fused: CesiumNS.ImageryProvider;
  failures(): number; threads(): number; destroy(): void;
  /** Finest CTX level delivered at lon / lat, or -1 for Viking only. */
  ctxLevelAt(lon: number, lat: number): number;
  /** CTX tile requests in flight. */
  ctxPending(): number;
  /** Prefetch CTX tiles of each level within its halfW x halfH degrees of lon / lat (nearest first, bounded per level). */
  prefetch(lon: number, lat: number, levels: { level: number; halfW: number; halfH: number }[]): void;
  prefetched(): number;
}

/** Tiles prefetched per level per call. */
const PREFETCH_PER_LEVEL = 16;

export function marsImagery(C: C, ellipsoid: CesiumNS.Ellipsoid): MarsImagery {
  direct = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tiles') === 'direct';
  const fuser = new Fuser();
  const base = new VikingProvider(C, ellipsoid, fuser), fused = new FusedProvider(C, ellipsoid, fuser);
  const pre = new Prefetcher();
  return {
    base: base as unknown as CesiumNS.ImageryProvider, fused: fused as unknown as CesiumNS.ImageryProvider,
    failures: () => base.failures + fused.failures + fused.ctxNoData, threads: () => fuser.threads, destroy: () => fuser.destroy(),
    ctxLevelAt: (lon, lat) => fused.levelAt(lon, lat),
    ctxPending: () => fused.pending,
    prefetch: (lon, lat, levels) => {
      const urls: string[] = [];
      for (const { level: l, halfW, halfH } of levels) {
        if (l < FUSE_MIN_LEVEL || l > CTX.maxLevel) continue;
        for (const t of tilesAround(lon, lat, l, halfW, halfH, PREFETCH_PER_LEVEL)) if (!fused.has(l, t.y, t.x)) urls.push(ctxUrl(l, t.y, t.x));
      }
      pre.request(urls);
    },
    prefetched: () => pre.done,
  };
}
