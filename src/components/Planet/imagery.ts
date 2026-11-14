/**
 * Mars imagery providers for Cesium: the Viking MDIM 2.1 colour mosaic, colour graded, and a fused layer that adds the
 * CTX 5 m mosaic's detail on top of Viking's colour (pixel maths in imageryBlend.ts). Both share one geographic 2 x 1
 * tile grid, so a CTX tile at any level sits inside one Viking ancestor tile.
 *
 * The CTX request carries Cesium's Request, so it is throttled and cancelled with the rest of the globe's tiles; Viking
 * ancestors are cached and shared by many CTX tiles. Pixel work runs in a small worker pool (imagery.worker.ts) so the
 * render loop never waits on it; without OffscreenCanvas it falls back to the main thread.
 */
import type * as CesiumNS from 'cesium';
import { cropWithMargin, fuseTile, vikingSource } from './imageryBlend';
import type { FuseJob, FuseReply } from './imagery.worker';
import { CTX, VIKING } from './planetMath';

type C = typeof CesiumNS;
type Img = ImageBitmap | HTMLImageElement;
type Tile = ImageBitmap | HTMLCanvasElement;
/** CTX adds nothing at whole-hemisphere scale (and the service errors on some level 1 tiles): Viking alone below this. */
const FUSE_MIN_LEVEL = 3;

const vikingUrl = (l: number, y: number, x: number) =>
  `https://trek.nasa.gov/tiles/Mars/EQ/${VIKING.layer}/1.0.0/default/${VIKING.tileMatrixSetID}/${l}/${y}/${x}.jpg`;
const ctxUrl = (l: number, y: number, x: number) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${l}/${y}/${x}`;

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
    return p.then((img) => this.fuser.run({ size: this.tileWidth, viking: img, crop: { sx: 0, sy: 0, sub: VIKING.tileSize }, ctx: null }));
  }
}

/** Wait before the one retry of a failed CTX tile, ms. */
const CTX_RETRY_MS = 900;
/** Ancestor levels tried for a CTX tile the service cannot send. */
const CTX_PARENT_LEVELS = 2;

/**
 * CTX detail on Viking colour. The CTX service has holes in its tile cache (HTTP 500 for some tiles, for example around
 * 14N 72E at level 11) and its error responses carry no CORS header, so the browser reports a network error and the
 * pixels are unreadable. Such a tile is retried once; if it fails again it takes the matching quarter of its parent CTX
 * tile (up to two levels up, the parent is usually in the HTTP cache already), so the detail continues at half
 * resolution instead of dropping to Viking's 232 m. With no ancestor either it is no data: Viking colour alone, graded
 * exactly like the base layer, so the Viking layer shows through. It never rejects, so Cesium logs nothing. Known holes
 * are remembered and not fetched again this session.
 */
class FusedProvider extends MarsProvider {
  readonly tileWidth = CTX.tileSize; readonly tileHeight = CTX.tileSize; readonly maximumLevel = CTX.maxLevel;
  private viking = new Map<string, Promise<Img | null>>();
  private noData = new Set<string>();
  /** CTX tiles drawn as Viking only, after a failed retry (debug stats). */
  ctxNoData = 0;
  private async ctxOrNoData(first: Promise<Img>, l: number, y: number, x: number, request?: CesiumNS.Request): Promise<Img | null> {
    try { return await first; } catch (e) {
      // cancelled by Cesium (tile no longer wanted): let it reschedule the tile instead of drawing it without CTX
      if (request?.state === this.C.RequestState.CANCELLED) throw e;
    }
    await new Promise((r) => setTimeout(r, CTX_RETRY_MS));
    try { const again = this.fetch(ctxUrl(l, y, x)); if (again) return await again; } catch { /* hole: try an ancestor */ }
    this.noData.add(`${l}/${y}/${x}`);
    this.ctxNoData++;
    return this.ancestorCtx(l, y, x);
  }
  /** The part of the nearest ancestor CTX tile that covers tile l/y/x, or null when none loads (or the level is Viking only). */
  private async ancestorCtx(l: number, y: number, x: number): Promise<Img | null> {
    for (let k = 1; k <= CTX_PARENT_LEVELS && l - k >= FUSE_MIN_LEVEL; k++) {
      const pl = l - k, py = y >> k, px = x >> k;
      if (this.noData.has(`${pl}/${py}/${px}`)) continue;
      try {
        const img = await this.fetch(ctxUrl(pl, py, px));
        if (!img) continue;
        const n = 1 << k, w = img.width / n, h = img.height / n;
        return await createImageBitmap(img, (x - px * n) * w, (y - py * n) * h, w, h);
      } catch { this.noData.add(`${pl}/${py}/${px}`); }
    }
    return null;
  }
  private vikingTile(l: number, y: number, x: number): Promise<Img | null> {
    const k = `${l}/${y}/${x}`;
    let p = this.viking.get(k);
    if (p) { this.viking.delete(k); this.viking.set(k, p); return p; }   // LRU touch
    p = (this.fetch(vikingUrl(l, y, x)) ?? Promise.resolve(null)).catch(() => null);
    this.viking.set(k, p);
    if (this.viking.size > 96) this.viking.delete(this.viking.keys().next().value!);
    return p;
  }
  requestImage(x: number, y: number, level: number, request?: CesiumNS.Request) {
    let ctx: Promise<Img | null>;
    if (level < FUSE_MIN_LEVEL || this.noData.has(`${level}/${y}/${x}`)) ctx = Promise.resolve(null);
    else {
      const first = this.fetch(ctxUrl(level, y, x), request);
      if (!first) return undefined;   // throttled: Cesium asks again later
      ctx = this.ctxOrNoData(first, level, y, x, request);
    }
    const src = vikingSource(x, y, level, VIKING.maxLevel, VIKING.tileSize);
    return Promise.all([ctx, this.vikingTile(src.level, src.y, src.x)])
      .then(([c, v]) => this.fuser.run({ size: this.tileWidth, viking: v, crop: { sx: src.sx, sy: src.sy, sub: src.size }, ctx: c }));
  }
}

export interface MarsImagery {
  base: CesiumNS.ImageryProvider; fused: CesiumNS.ImageryProvider;
  failures(): number; threads(): number; destroy(): void;
}

export function marsImagery(C: C, ellipsoid: CesiumNS.Ellipsoid): MarsImagery {
  const fuser = new Fuser();
  const base = new VikingProvider(C, ellipsoid, fuser), fused = new FusedProvider(C, ellipsoid, fuser);
  return {
    base: base as unknown as CesiumNS.ImageryProvider, fused: fused as unknown as CesiumNS.ImageryProvider,
    failures: () => base.failures + fused.failures + fused.ctxNoData, threads: () => fuser.threads, destroy: () => fuser.destroy(),
  };
}
