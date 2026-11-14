/**
 * Pixel maths for the planet's imagery (pure, no Cesium, no DOM; runs in a worker or on the main thread; unit-tested).
 *
 * Mars colour comes from the Viking MDIM 2.1 colour mosaic (232 m); fine detail comes from the CTX global mosaic (5 m,
 * greyscale, uncontrolled). The two are fused per tile: CTX only modulates Viking's brightness, so the ground keeps
 * Viking's colour and albedo at every zoom and the CTX layer can never darken a region on its own.
 *  - detail   CTX contrast-normalised against its local mean and spread (radius DETAIL_RADIUS_PX), so texture strength is the
 *             same at every tile level and in every CTX strip: neighbouring tiles of different levels meet without a step
 *  - tone     local mean / CTX_MEAN (low pass), mildly, so CTX strip-to-strip brightness differences stay subtle
 *  - no data  CTX pixels that are black or transparent (gaps between strips) weigh 0: Viking shows through unchanged
 * The same colour grade is applied to the plain Viking base layer, so the base and the fused layer match exactly and
 * the fade between them (and any CTX gap) has no seam.
 */

/** Mean CTX grey level (0..1) of the mosaic's normalised strips, measured on sample tiles (126 to 166 of 255). */
export const CTX_MEAN = 0.59;
/** Typical Viking MDIM luminance (0..1), measured on sample tiles. */
export const VIKING_MEAN = 0.36;
/** Local statistics radius in CTX pixels; small, so tile edges (seen from one side only) cannot show. */
export const DETAIL_RADIUS_PX = 4;
/** Brightness change per local standard deviation of CTX texture, its clamp, and the spread floor (flat areas, JPEG noise). */
export const DETAIL_GAIN = 0.12;
export const DETAIL_CLAMP = 2.6;
export const SD_FLOOR = 0.018;
/** Exponent on the local mean (CTX strip brightness), kept below 1 so strips stay subtle. */
export const TONE_EXP = 0.8;
/** CTX grey below this (0..255) is no-data black, fully weighted above NODATA_HI. */
export const NODATA_LO = 6;
export const NODATA_HI = 24;

export interface Grade {
  /** Target hue of the ground at unit luminance (dusty butterscotch). */
  tint: readonly [number, number, number];
  /** Luminance tone curve: out = pow(L, gamma) * gain. */
  gamma: number; gain: number;
  /**
   * How much of Viking's own luminance (albedo and its baked-in shading) survives: L' = L^albedo * VIKING_MEAN^(1 - albedo).
   * Viking is 232 m per pixel, so at close range its brightness variations are soft blobs; CTX carries the structure there.
   */
  albedo: number;
  /**
   * Share of Viking's own colour variation kept on top of the tint (redder dust, greyer dark sand). Only the component
   * along the tint's own hue axis is kept, so Viking's blue and green casts cannot tint the ground purple or olive.
   */
  sat: number;
}
export const GRADE: Grade = { tint: [205, 150, 110], gamma: 0.8, gain: 1.32, albedo: 0.55, sat: 0.7 };

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/* lookup tables, built once per grade */
const LQ = 1024, GQ = 4096;
let luts: { grade: Grade; albedo: Float32Array; gamma: Float32Array } | null = null;
function tables(grade: Grade) {
  if (luts?.grade === grade) return luts;
  const k = Math.pow(VIKING_MEAN, 1 - grade.albedo);
  const albedo = new Float32Array(LQ + 1), gamma = new Float32Array(GQ + 1);
  for (let i = 0; i <= LQ; i++) albedo[i] = Math.pow(Math.max(i / LQ, 1e-3), grade.albedo) * k;
  for (let i = 0; i <= GQ; i++) gamma[i] = Math.pow(i / GQ, grade.gamma) * grade.gain;
  luts = { grade, albedo, gamma };
  return luts;
}

let scratch: { n: number; g: Float32Array; w: Float32Array; a: Float32Array; b: Float32Array; q: Float32Array; ta: Float32Array; tb: Float32Array; tq: Float32Array } | null = null;
function bufs(n: number) {
  if (!scratch || scratch.n !== n) {
    const f = () => new Float32Array(n);
    scratch = { n, g: f(), w: f(), a: f(), b: f(), q: f(), ta: f(), tb: f(), tq: f() };
  }
  return scratch;
}

/** Separable box sums of a, b, q over a (2r+1)^2 window clipped to the tile (in place; t* are scratch). */
function boxSums(a: Float32Array, b: Float32Array, q: Float32Array, ta: Float32Array, tb: Float32Array, tq: Float32Array, size: number, r: number) {
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let sa = 0, sb = 0, sq = 0;
    for (let x = 0; x <= Math.min(r, size - 1); x++) { sa += a[row + x]; sb += b[row + x]; sq += q[row + x]; }
    for (let x = 0; x < size; x++) {
      ta[row + x] = sa; tb[row + x] = sb; tq[row + x] = sq;
      const add = x + r + 1, sub = x - r;
      if (add < size) { sa += a[row + add]; sb += b[row + add]; sq += q[row + add]; }
      if (sub >= 0) { sa -= a[row + sub]; sb -= b[row + sub]; sq -= q[row + sub]; }
    }
  }
  for (let x = 0; x < size; x++) {
    let sa = 0, sb = 0, sq = 0;
    for (let y = 0; y <= Math.min(r, size - 1); y++) { const i = y * size + x; sa += ta[i]; sb += tb[i]; sq += tq[i]; }
    for (let y = 0; y < size; y++) {
      const i = y * size + x;
      a[i] = sa; b[i] = sb; q[i] = sq;
      const add = y + r + 1, sub = y - r;
      if (add < size) { const j = add * size + x; sa += ta[j]; sb += tb[j]; sq += tq[j]; }
      if (sub >= 0) { const j = sub * size + x; sa -= ta[j]; sb -= tb[j]; sq -= tq[j]; }
    }
  }
}

/**
 * Fuse one tile. `viking` and `out` are RGBA size*size (Viking already resampled to the tile; `out` may be `viking`);
 * `ctx` is the CTX tile as RGBA (grey in R) or null for a plain graded Viking tile. Writes opaque pixels.
 */
export function fuseTile(viking: Uint8ClampedArray, ctx: Uint8ClampedArray | null, size: number, out: Uint8ClampedArray, grade: Grade = GRADE): void {
  const n = size * size, T = tables(grade);
  const tl = 0.2126 * grade.tint[0] + 0.7152 * grade.tint[1] + 0.0722 * grade.tint[2];
  const tr = grade.tint[0] / tl, tg = grade.tint[1] / tl, tb = grade.tint[2] / tl;
  // unit chroma direction of the tint (tint minus its own luminance), scaled by sat
  const dx = tr - 1, dy = tg - 1, dz = tb - 1, dl = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / dl, uy = dy / dl, uz = dz / dl;
  let s: ReturnType<typeof bufs> | null = null;
  if (ctx) {
    s = bufs(n);
    for (let i = 0; i < n; i++) {
      const c = ctx[i * 4];
      const w = (ctx[i * 4 + 3] / 255) * clamp((c - NODATA_LO) / (NODATA_HI - NODATA_LO), 0, 1);
      const g = c / 255;
      s.g[i] = g; s.w[i] = w; s.a[i] = g * w; s.b[i] = w; s.q[i] = g * g * w;
    }
    boxSums(s.a, s.b, s.q, s.ta, s.tb, s.tq, size, DETAIL_RADIUS_PX);
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = viking[o] / 255, g = viking[o + 1] / 255, b = viking[o + 2] / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let f = 1;
    if (s) {
      const w = s.w[i], sw = s.b[i];
      if (w > 0 && sw > 1e-3) {
        const mean = s.a[i] / sw, sd = Math.sqrt(Math.max(s.q[i] / sw - mean * mean, 0));
        const z = clamp((s.g[i] - mean) / Math.max(sd, SD_FLOOR), -DETAIL_CLAMP, DETAIL_CLAMP);
        const d = (1 + DETAIL_GAIN * z) * Math.pow(mean / CTX_MEAN, TONE_EXP);
        f = 1 + w * (clamp(d, 0.3, 2.2) - 1);
      }
    }
    const La = T.albedo[(Math.min(L, 1) * LQ) | 0];
    const L2 = T.gamma[(Math.min(La * f, 1) * GQ) | 0];
    const p = ((r - L) * ux + (g - L) * uy + (b - L) * uz) * grade.sat * (L2 / Math.max(L, 0.02));
    out[o] = (L2 * tr + p * ux) * 255;
    out[o + 1] = (L2 * tg + p * uy) * 255;
    out[o + 2] = (L2 * tb + p * uz) * 255;
    out[o + 3] = 255;
  }
}

/**
 * Where a CTX (or Viking) tile at `level` sits inside its Viking ancestor at `vikingMax`: the ancestor tile and the
 * source square (pixels of a `vikingSize` tile). Both mosaics use the same geographic 2 x 1 grid at level 0.
 */
export function vikingSource(x: number, y: number, level: number, vikingMax: number, vikingSize: number): { level: number; x: number; y: number; sx: number; sy: number; size: number } {
  const vl = Math.min(level, vikingMax), k = level - vl, n = 1 << k, sub = vikingSize / n;
  const vx = x >> k, vy = y >> k;
  return { level: vl, x: vx, y: vy, sx: (x - vx * n) * sub, sy: (y - vy * n) * sub, size: sub };
}

/** Source rectangle with one pixel of margin where the tile has it (so bilinear upsampling matches across tile edges). */
export function cropWithMargin(sx: number, sy: number, size: number, full: number): { x: number; y: number; w: number; h: number; ml: number; mt: number } {
  const ml = sx > 0 ? 1 : 0, mt = sy > 0 ? 1 : 0, mr = sx + size < full ? 1 : 0, mb = sy + size < full ? 1 : 0;
  return { x: sx - ml, y: sy - mt, w: size + ml + mr, h: size + mt + mb, ml, mt };
}
