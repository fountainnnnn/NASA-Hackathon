#!/usr/bin/env node
/**
 * MarsWalk Copilot: regional CONTEXT terrain (the "apron" around the high-resolution CTX DEM patch).
 *
 *   node scripts/prepare-context.mjs
 *
 * Writes public/data/context_dem.i16, context_meta.json and context.jpg, and appends entries to
 * data/source_manifest.json (existing entries are kept). Raw downloads are cached in data/raw/context/.
 *
 * Region: lon 75.9..78.9 E, lat 17.1..19.8 N (about 175 x 160 km), centred on Jezero.
 *
 * Elevation  PDS Geosciences Node, MGS MOLA MEGDR 128 pixel/degree topography (megt44n000hb.img, lat 0..44 N,
 *            lon 0..90 E, 16-bit MSB, metres above the areoid, GMM-3). Only the rows covering the region are
 *            fetched with an HTTP Range request. Tried first and failed (recorded in the report): the JPL Mars Trek
 *            subset service (returns 0 bytes without a login token) and the full Trek data stream (2.1 GB, no
 *            Range support, about 25 kB/s here).
 * Imagery    MRO CTX global mosaic "CTX_beta01_uncontrolled_5m_Caltech" (Murray Lab Caltech / Esri), WMTS level 9
 *            (about 41 m/px). The tile URL comes from the ResourceURL of Trek's own WMTSCapabilities.xml for
 *            that product (astro.arcgis.com); the Trek-hosted tile path itself returns 404.
 *
 * Geometry conventions follow src/lib/contracts.ts (Mars 2000 sphere, lon east-positive, row 0 = north, uv linear in
 * lon/lat across the outer edges). Datum check: the context heights are compared with the 20 m CTX DEM over the overlap.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw/context');
const OUT = path.join(ROOT, 'public/data');
fs.mkdirSync(RAW, { recursive: true });

const LICENCE = 'NASA data: generally not copyrighted; cite source. USGS data: public domain, cite publication.';
const B = { lonMin: 75.9, lonMax: 78.9, latMin: 17.1, latMax: 19.8 };
const log = (...a) => console.log(...a);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------------ downloads */

/** curl honours the sandbox / corporate proxy (Node fetch does not). */
async function curl(url, file, { range, insecure } = {}) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  const args = ['-sSfL', '--max-time', '600', '--retry', '4', '--retry-delay', '3', '-A', 'marswalk-context-prep/1.0', '-o', file];
  if (range) args.push('-H', `Range: bytes=${range}`);
  // pds-geosciences.wustl.edu serves an incomplete TLS chain (the SSL.com intermediate is missing), so curl cannot
  // verify it. Integrity is covered instead by the datum check below against the independent CTX DEM.
  if (insecure) args.push('--insecure');
  await run('curl', [...args, url], { maxBuffer: 1 << 20 });
}

const PDS = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128';
const MOLA_IMG = `${PDS}/megt44n000hb.img`;
const MOLA_LBL = `${PDS}/megt44n000hb.lbl`;
const MOLA_COLS = 11520, MOLA_ROWS_TOTAL = 5632, MOLA_PPD = 128, MOLA_LAT_TOP = 44, MOLA_LON_W = 0;
const MOLA_R0 = 3090, MOLA_R1 = 3450; // rows covering lat 17.1..19.8 with margin

const CTX_LABEL = 'CTX_beta01_uncontrolled_5m_Caltech';
const CTX_CAPS = `https://trek.nasa.gov/tiles/Mars/EQ/${CTX_LABEL}/1.0.0/WMTSCapabilities.xml`;
const CTX_TILE = (z, r, c) => `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/${z}/${r}/${c}`;
const Z = 9, TILE = 512, MAT_W = 1024; // from the capabilities: level 9 = 1024 x 512 tiles of 512 px, top-left (-180, 90)
const DEG_PX = 360 / (MAT_W * TILE);

const rawMeta = {};
async function fetchRaw(url, name, opts) {
  const file = path.join(RAW, name);
  await curl(url, file, opts);
  const buf = fs.readFileSync(file);
  rawMeta[name] = { url, sha256: sha256(buf), bytes: buf.length };
  return buf;
}

/* ------------------------------------------------------------------ elevation */

async function buildDem() {
  log('[1] MOLA MEGDR 128 ppd');
  const lbl = (await fetchRaw(MOLA_LBL, 'megt44n000hb.lbl', { insecure: true })).toString('latin1');
  const need = { LINES: MOLA_ROWS_TOTAL, LINE_SAMPLES: MOLA_COLS };
  for (const [k, v] of Object.entries(need)) {
    const m = new RegExp(`^\\s*${k}\\s*=\\s*(\\d+)`, 'm').exec(lbl);
    if (!m || Number(m[1]) !== v) throw new Error(`label ${k} mismatch`);
  }
  for (const [k, v] of [['MAXIMUM_LATITUDE', 44], ['MINIMUM_LATITUDE', 0], ['WESTERNMOST_LONGITUDE', 0], ['EASTERNMOST_LONGITUDE', 90]]) {
    const m = new RegExp(`^\\s*${k}\\s*=\\s*([-\\d.]+)`, 'm').exec(lbl);
    if (!m || Number(m[1]) !== v) throw new Error(`label ${k} mismatch`);
  }
  const rowBytes = MOLA_COLS * 2;
  const rangeStr = `${MOLA_R0 * rowBytes}-${(MOLA_R1 + 1) * rowBytes - 1}`;
  const buf = await fetchRaw(MOLA_IMG, `megt44n000hb_rows${MOLA_R0}_${MOLA_R1}.bin`, { range: rangeStr, insecure: true });
  rawMeta[`megt44n000hb_rows${MOLA_R0}_${MOLA_R1}.bin`].range = `bytes=${rangeStr} of megt44n000hb.img (${MOLA_ROWS_TOTAL * rowBytes} bytes)`;
  const nr = MOLA_R1 - MOLA_R0 + 1;
  if (buf.length !== nr * rowBytes) throw new Error(`range returned ${buf.length} bytes, expected ${nr * rowBytes}`);
  const src = new Int16Array(nr * MOLA_COLS);
  for (let i = 0; i < src.length; i++) src[i] = buf.readInt16BE(i * 2);

  // Output grid: outer edges = region edges, 1/128 deg in lon (384 columns), 346 rows in lat.
  const width = Math.round((B.lonMax - B.lonMin) * MOLA_PPD); // 384
  const height = 346;
  const dLon = (B.lonMax - B.lonMin) / width, dLat = (B.latMax - B.latMin) / height;
  const out = new Float32Array(width * height);
  const at = (c, r) => src[(r - MOLA_R0) * MOLA_COLS + c];
  for (let r = 0; r < height; r++) {
    const lat = B.latMax - (r + 0.5) * dLat;
    const fr = (MOLA_LAT_TOP - lat) * MOLA_PPD - 0.5; // source pixel r covers rows [r, r+1) at 1/128 deg
    const r0 = Math.floor(fr), tr = fr - r0;
    for (let c = 0; c < width; c++) {
      const lon = B.lonMin + (c + 0.5) * dLon;
      const fc = (lon - MOLA_LON_W) * MOLA_PPD - 0.5;
      const c0 = Math.floor(fc), tc = fc - c0;
      out[r * width + c] =
        at(c0, r0) * (1 - tc) * (1 - tr) + at(c0 + 1, r0) * tc * (1 - tr) + at(c0, r0 + 1) * (1 - tc) * tr + at(c0 + 1, r0 + 1) * tc * tr;
    }
  }
  const scale = 0.25;
  const enc = new Int16Array(width * height);
  let mn = Infinity, mx = -Infinity;
  const vals = [];
  for (let i = 0; i < out.length; i++) {
    enc[i] = Math.round(out[i] / scale);
    const h = enc[i] * scale;
    mn = Math.min(mn, h); mx = Math.max(mx, h); vals.push(h);
  }
  vals.sort((a, b) => a - b);
  const hRef = vals[vals.length >> 1];
  const file = Buffer.alloc(enc.length * 2);
  for (let i = 0; i < enc.length; i++) file.writeInt16LE(enc[i], i * 2);
  fs.writeFileSync(path.join(OUT, 'context_dem.i16'), file);
  log(`  context_dem.i16 ${width}x${height}, ${(file.length / 1e3).toFixed(0)} kB, elev ${mn}..${mx} m, hRef ${hRef}`);
  return { width, height, dLon, dLat, scale, elev: Float32Array.from(enc, (v) => v * scale), elevMin: mn, elevMax: mx, hRef };
}

/* ------------------------------------------------------------------ datum check vs the 20 m CTX DEM */

function loadCtxDem() {
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, 'dem_meta.json'), 'utf8'));
  let buf = fs.readFileSync(path.join(OUT, meta.file));
  if (meta.encoding.compression === 'gzip') buf = zlib.gunzipSync(buf);
  const n = meta.width * meta.height;
  const raw = new Int16Array(n);
  for (let i = 0; i < n; i++) raw[i] = buf.readInt16LE(i * 2);
  if (meta.encoding.delta === 'row') {
    for (let r = 0; r < meta.height; r++) {
      let acc = raw[r * meta.width];
      for (let c = 1; c < meta.width; c++) { acc = (acc + raw[r * meta.width + c]) << 16 >> 16; raw[r * meta.width + c] = acc; }
    }
  }
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) elev[i] = raw[i] === meta.encoding.nodata ? NaN : meta.encoding.offset + meta.encoding.scale * raw[i];
  return { meta, elev };
}

const quant = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function datumCheck(ctx, dem) {
  log('[2] datum check against the 20 m CTX DEM');
  const m = dem.meta;
  const nW = ctx.width * ctx.height;
  const sum = new Float64Array(nW), sumSq = new Float64Array(nW), cnt = new Uint32Array(nW), tot = new Uint32Array(nW);
  for (let r = 0; r < m.height; r++) {
    const lat = m.latMax - (r + 0.5) * m.dLat;
    const cr = Math.floor((B.latMax - lat) / ctx.dLat);
    if (cr < 0 || cr >= ctx.height) continue;
    for (let c = 0; c < m.width; c++) {
      const lon = m.lonMin + (c + 0.5) * m.dLon;
      const cc = Math.floor((lon - B.lonMin) / ctx.dLon);
      if (cc < 0 || cc >= ctx.width) continue;
      const k = cr * ctx.width + cc;
      tot[k]++;
      const v = dem.elev[r * m.width + c];
      if (v === v) { sum[k] += v; sumSq[k] += v * v; cnt[k]++; }
    }
  }
  // keep context pixels whose whole footprint lies inside the CTX DEM (all of its cells are valid data)
  const diffs = [], pts = [];
  for (let k = 0; k < nW; k++) {
    const cc = k % ctx.width, cr = Math.floor(k / ctx.width);
    const lonA = B.lonMin + cc * ctx.dLon, lonB = lonA + ctx.dLon, latB = B.latMax - cr * ctx.dLat, latA = latB - ctx.dLat;
    if (lonA < m.lonMin || lonB > m.lonMax || latA < m.latMin || latB > m.latMax || cnt[k] < 0.99 * tot[k] || tot[k] < 500) continue;
    const d = sum[k] / cnt[k] - ctx.elev[k];
    diffs.push(d);
    const mu = sum[k] / cnt[k];
    pts.push({ d, h: ctx.elev[k], c: cc, r: cr, sd: Math.sqrt(Math.max(0, sumSq[k] / cnt[k] - mu * mu)) });
  }
  const stats = (P) => {
    const diffs = P.map((p) => p.d).sort((a, b) => a - b);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / diffs.length);
    // a planar trend would indicate a real datum / registration problem, scatter alone is just relief below 463 m
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sxd = 0, syd = 0;
    const n = P.length;
    for (const p of P) { sx += p.c; sy += p.r; sxx += p.c * p.c; sxy += p.c * p.r; syy += p.r * p.r; sxd += p.c * p.d; syd += p.r * p.d; }
    const mc = sx / n, mr = sy / n;
    const a11 = sxx / n - mc * mc, a12 = sxy / n - mc * mr, a22 = syy / n - mr * mr;
    const b1 = sxd / n - mc * mean, b2 = syd / n - mr * mean;
    const det = a11 * a22 - a12 * a12;
    const gx = (b1 * a22 - b2 * a12) / det, gy = (b2 * a11 - b1 * a12) / det; // metres per context pixel
    return {
      n, mean: +mean.toFixed(2), median: +quant(diffs, 0.5).toFixed(2), stdDev: +sd.toFixed(2),
      p05: +quant(diffs, 0.05).toFixed(2), p95: +quant(diffs, 0.95).toFixed(2),
      trendPerKmEast: +((gx / (ctx.dLon * Math.PI / 180 * 3396190 * Math.cos(18.45 * Math.PI / 180))) * 1000).toFixed(3),
      trendPerKmNorth: +((-gy / (ctx.dLat * Math.PI / 180 * 3396190)) * 1000).toFixed(3),
    };
  };
  const bands = (P, key, nb = 6) => {
    const lo = Math.min(...P.map((p) => p[key])), hi = Math.max(...P.map((p) => p[key])) + 1;
    return Array.from({ length: nb }, (_, b) => {
      const q = P.filter((p) => p[key] >= lo + ((hi - lo) * b) / nb && p[key] < lo + ((hi - lo) * (b + 1)) / nb).map((p) => p.d).sort((x, y) => x - y);
      return q.length ? { n: q.length, median: +quant(q, 0.5).toFixed(1) } : null;
    });
  };
  const res = {
    all: stats(pts),
    flat: stats(pts.filter((p) => p.sd <= 4)),
    flatMedianByEastBand: bands(pts.filter((p) => p.sd <= 4), 'c'),
    flatMedianByNorthBand: bands(pts.filter((p) => p.sd <= 4), 'r'),
    definition: 'CTX DEM block-mean over each MOLA context pixel footprint minus the MOLA context height; only pixels whose whole footprint is inside the CTX DEM. "flat" = CTX height std dev within the footprint <= 4 m.',
  };
  log('  ', JSON.stringify(res));
  return res;
}

/* ------------------------------------------------------------------ imagery */

async function buildImage() {
  log('[3] CTX global mosaic, WMTS level', Z);
  const caps = (await fetchRaw(CTX_CAPS, 'ctx_caps.xml')).toString('utf8');
  if (!caps.includes('astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer/tile/')) throw new Error('capabilities ResourceURL changed');
  const x0 = (B.lonMin + 180) / DEG_PX, x1 = (B.lonMax + 180) / DEG_PX;
  const y0 = (90 - B.latMax) / DEG_PX, y1 = (90 - B.latMin) / DEG_PX;
  const tc0 = Math.floor(x0 / TILE), tc1 = Math.floor((x1 - 1e-9) / TILE);
  const tr0 = Math.floor(y0 / TILE), tr1 = Math.floor((y1 - 1e-9) / TILE);
  const mw = (tc1 - tc0 + 1) * TILE, mh = (tr1 - tr0 + 1) * TILE;
  const mosaic = Buffer.alloc(mw * mh);
  const jobs = [];
  for (let r = tr0; r <= tr1; r++) for (let c = tc0; c <= tc1; c++) jobs.push({ r, c, name: `ctx9/z${Z}_r${r}_c${c}.png` });
  fs.mkdirSync(path.join(RAW, 'ctx9'), { recursive: true });
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      j.buf = await fetchRaw(CTX_TILE(Z, j.r, j.c), j.name);
    }
  }));
  for (const j of jobs) {
    const { data, info } = await sharp(j.buf).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== TILE || info.height !== TILE || info.channels !== 1) throw new Error(`unexpected tile ${j.name}`);
    for (let y = 0; y < TILE; y++) data.copy(mosaic, (y + (j.r - tr0) * TILE) * mw + (j.c - tc0) * TILE, y * TILE, (y + 1) * TILE);
  }
  log(`  ${jobs.length} tiles, window ${(x1 - x0).toFixed(0)} x ${(y1 - y0).toFixed(0)} px at ${(DEG_PX * Math.PI / 180 * 3396190).toFixed(1)} m/px`);

  // exact bilinear resample of the fractional window [x0,x1] x [y0,y1] to ow x oh (edges = region edges)
  const resample = (ow, oh) => {
    const out = Buffer.alloc(ow * oh);
    const sx = (x1 - x0) / ow, sy = (y1 - y0) / oh;
    const wx0 = x0 - tc0 * TILE, wy0 = y0 - tr0 * TILE;
    // box-average when downsampling (factor > 1) via a small supersample, bilinear otherwise
    const ss = Math.max(1, Math.round(Math.max(sx, sy)));
    for (let j = 0; j < oh; j++) {
      for (let i = 0; i < ow; i++) {
        let acc = 0;
        for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) {
          const fx = Math.min(mw - 1.001, Math.max(0, wx0 + (i + (a + 0.5) / ss) * sx - 0.5));
          const fy = Math.min(mh - 1.001, Math.max(0, wy0 + (j + (b + 0.5) / ss) * sy - 0.5));
          const cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
          const p = cy * mw + cx;
          acc += mosaic[p] * (1 - tx) * (1 - ty) + mosaic[p + 1] * tx * (1 - ty) + mosaic[p + mw] * (1 - tx) * ty + mosaic[p + mw + 1] * tx * ty;
        }
        out[j * ow + i] = Math.round(acc / (ss * ss));
      }
    }
    return out;
  };

  // largest size that keeps the JPEG under 2.5 MB; keep source pixel aspect (uv is linear in lon/lat)
  let chosen = null;
  for (const ow of [4096, 3840, 3584, 3328, 3072]) {
    const oh = Math.round((ow * (y1 - y0)) / (x1 - x0));
    const grey = resample(ow, oh);
    const jpg = await sharp(grey, { raw: { width: ow, height: oh, channels: 1 } }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    log(`  try ${ow}x${oh}: ${(jpg.length / 1e6).toFixed(2)} MB`);
    if (jpg.length <= 2.5e6) { chosen = { ow, oh, jpg, grey }; break; }
  }
  if (!chosen) throw new Error('no size fits 2.5 MB');
  fs.writeFileSync(path.join(OUT, 'context.jpg'), chosen.jpg);

  // Brightness match against the 6 m controlled mosaic over the overlap (linear light, 2.2 gamma as the shader sees it)
  const dm = JSON.parse(fs.readFileSync(path.join(OUT, 'dem_meta.json'), 'utf8'));
  const pw = 512, ph = 485; // any size: only the mean matters, and uv is linear in lon/lat for both images
  const patchGrey = await sharp(path.join(OUT, 'ctx_2048.jpg')).greyscale().resize(pw, ph, { kernel: 'lanczos3' }).raw().toBuffer();
  const lin = (v) => (v / 255) ** 2.2;
  let sp = 0;
  for (const v of patchGrey) sp += lin(v);
  sp /= patchGrey.length;
  // the same ground window out of the context image
  const cx0 = ((dm.lonMin - B.lonMin) / (B.lonMax - B.lonMin)) * chosen.ow, cx1 = ((dm.lonMax - B.lonMin) / (B.lonMax - B.lonMin)) * chosen.ow;
  const cy0 = ((B.latMax - dm.latMax) / (B.latMax - B.latMin)) * chosen.oh, cy1 = ((B.latMax - dm.latMin) / (B.latMax - B.latMin)) * chosen.oh;
  let sw = 0, nw = 0;
  for (let y = Math.ceil(cy0); y < Math.floor(cy1); y++) for (let x = Math.ceil(cx0); x < Math.floor(cx1); x++) { sw += lin(chosen.grey[y * chosen.ow + x]); nw++; }
  sw /= nw;
  const gain = sp / sw;
  log(`  mean linear brightness: patch mosaic ${sp.toFixed(4)}, context image ${sw.toFixed(4)} over the patch footprint, gain ${gain.toFixed(3)}`);

  // registration check: normalised cross-correlation of patch vs context over the overlap at integer pixel shifts
  const reg = await registrationCheck(chosen, dm, cx0, cy0, cx1, cy1);
  return { width: chosen.ow, height: chosen.oh, bytes: chosen.jpg.length, gain, window: { x0, x1, y0, y1, tc0, tc1, tr0, tr1 }, tiles: jobs.map((j) => j.name), registration: reg };
}

async function registrationCheck(ch, dm, cx0, cy0, cx1, cy1) {
  const w = Math.floor(cx1) - Math.ceil(cx0), h = Math.floor(cy1) - Math.ceil(cy0);
  const patch = await sharp(path.join(OUT, 'ctx_2048.jpg')).greyscale().resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer();
  const ox = Math.ceil(cx0), oy = Math.ceil(cy0);
  const ncc = (dx, dy) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = 40; y < h - 40; y += 2) for (let x = 40; x < w - 40; x += 2) {
      const a = patch[y * w + x], b = ch.grey[(oy + y + dy) * ch.ow + ox + x + dx];
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
    }
    const ma = sa / n, mb = sb / n;
    return (sab / n - ma * mb) / Math.sqrt((saa / n - ma * ma) * (sbb / n - mb * mb));
  };
  let best = { dx: 0, dy: 0, v: -1 };
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const v = ncc(dx, dy); if (v > best.v) best = { dx, dy, v }; }
  const mPerPxX = ((dm.lonMax - dm.lonMin) * Math.PI / 180 * 3396190 * Math.cos(18.466 * Math.PI / 180)) / w;
  const mPerPxY = ((dm.latMax - dm.latMin) * Math.PI / 180 * 3396190) / h;
  const res = { bestShiftPx: [best.dx, best.dy], bestShiftM: [+(best.dx * mPerPxX).toFixed(0), +(best.dy * mPerPxY).toFixed(0)], nccAtZero: +ncc(0, 0).toFixed(3), nccBest: +best.v.toFixed(3) };
  log('  registration vs controlled 6 m mosaic:', JSON.stringify(res));
  return res;
}

/* ------------------------------------------------------------------ main */

const ctx = await buildDem();
const dem = loadCtxDem();
const datum = datumCheck(ctx, dem);
const img = await buildImage();

const meta = {
  productLabel: 'MGS MOLA MEGDR 128 ppd topography (megt44n000hb) + MRO CTX global mosaic (Caltech beta01, level 9)',
  sourceUrl: MOLA_IMG,
  width: ctx.width, height: ctx.height,
  lonMin: B.lonMin, lonMax: B.lonMax, latMin: B.latMin, latMax: B.latMax,
  dLon: ctx.dLon, dLat: ctx.dLat,
  nominalResM: 463,
  encoding: { type: 'int16le', scale: ctx.scale, offset: 0, nodata: -32768 },
  file: 'context_dem.i16',
  elevMin: ctx.elevMin, elevMax: ctx.elevMax, hRef: ctx.hRef,
  datum: 'Mars 2000 sphere R=3396190 m; MOLA topography above the areoid (GMM-3), same reference as the CTX DEM',
  imageFile: 'context.jpg', imageWidth: img.width, imageHeight: img.height,
  imageSourceUrl: CTX_CAPS,
  imageGainToPatch: +img.gain.toFixed(4),
  datumCheck: datum,
  imageRegistration: img.registration,
  credit: 'NASA/GSFC/MGS MOLA (PDS Geosciences Node); NASA/JPL/MSSS/The Caltech Murray Lab/Esri (MRO CTX global mosaic via JPL Mars Trek)',
};
fs.writeFileSync(path.join(OUT, 'context_meta.json'), JSON.stringify(meta));

/* ------------------------------------------------------------------ manifest (append, keep existing) */

const manPath = path.join(ROOT, 'data/source_manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const now = new Date().toISOString();
const rawEntry = (name) => ({ rawFile: 'data/raw/context/' + name, ...rawMeta[name] });
const record = (file, entry) => {
  const full = path.join(OUT, file);
  const buf = fs.readFileSync(full);
  man.files['public/data/' + file] = { output: 'public/data/' + file, outputBytes: buf.length, outputSha256: sha256(buf), licence: LICENCE, ...entry };
};
const molaRaw = [`megt44n000hb.lbl`, `megt44n000hb_rows${MOLA_R0}_${MOLA_R1}.bin`];
record('context_dem.i16', {
  sourceUrls: [MOLA_IMG, MOLA_LBL],
  productLabel: 'megt44n000hb (MGS MOLA MEGDR, 128 pixel/degree topography)',
  mission: 'Mars Global Surveyor', instrument: 'Mars Orbiter Laser Altimeter (MOLA)',
  projection: 'Simple cylindrical, 1/128 degree, Mars 2000 sphere',
  datum: meta.datum, credit: meta.credit,
  resolution: `${meta.nominalResM} m/px (1/128 degree); stored ${ctx.width}x${ctx.height}`,
  raws: molaRaw.map(rawEntry),
  processing: [
    `Range request for rows ${MOLA_R0}..${MOLA_R1} of megt44n000hb.img (16-bit MSB, metres above the areoid).`,
    `Bilinear resample to ${ctx.width}x${ctx.height} so the outer edges equal lon ${B.lonMin}..${B.lonMax}, lat ${B.latMin}..${B.latMax}.`,
    `Encoded Int16 LE with scale ${ctx.scale} m, offset 0. hRef (median) ${ctx.hRef} m.`,
    `Datum check vs the CTX DEM (${datum.all.n} footprints): mean ${datum.all.mean} m, median ${datum.all.median} m, sd ${datum.all.stdDev} m; flat footprints (${datum.flat.n}): median ${datum.flat.median} m.`,
    'The PDS server sends an incomplete TLS chain, so the download used curl --insecure; integrity is covered by the datum check.',
  ],
});
record('context_meta.json', {
  sourceUrls: [MOLA_IMG, CTX_CAPS], productLabel: meta.productLabel, mission: 'MGS + MRO', instrument: 'MOLA + CTX',
  projection: 'n/a (metadata)', datum: meta.datum, credit: meta.credit, resolution: 'n/a',
  raws: [], processing: ['Written by scripts/prepare-context.mjs.'],
});
record('context.jpg', {
  sourceUrls: [CTX_CAPS, CTX_TILE(Z, '{row}', '{col}'), ...img.tiles.map((n) => rawMeta[n].url)],
  productLabel: CTX_LABEL, mission: 'Mars Reconnaissance Orbiter', instrument: 'Context Camera (CTX), global mosaic (uncontrolled, beta01)',
  projection: `Geographic (EPSG:104905 Mars 2000 sphere), WMTS default028mm level ${Z}`, datum: 'Mars 2000 sphere R=3396190 m',
  credit: 'NASA/JPL/MSSS/The Caltech Murray Lab/Esri (MRO CTX global mosaic via JPL Mars Trek)',
  resolution: `WMTS level ${Z}: ${(DEG_PX * Math.PI / 180 * 3396190).toFixed(1)} m/px at the equator; stored ${img.width}x${img.height}`,
  raws: [rawEntry('ctx_caps.xml'), ...img.tiles.map(rawEntry)],
  processing: [
    `Parsed Trek's WMTSCapabilities.xml; its ResourceURL points at astro.arcgis.com (the trek.nasa.gov tile path returns 404). Fetched ${img.tiles.length} level ${Z} tiles.`,
    `Stitched, then bilinear resample of the fractional window bounded by lon ${B.lonMin}..${B.lonMax}, lat ${B.latMin}..${B.latMax} to ${img.width}x${img.height} (box-averaged).`,
    `Greyscale JPEG quality 80 (mozjpeg), ${(img.bytes / 1e6).toFixed(2)} MB.`,
    `Registration vs the controlled 6 m mosaic: best integer shift ${img.registration.bestShiftPx.join(',')} px (${img.registration.bestShiftM.join(',')} m); NCC ${img.registration.nccAtZero} at zero shift.`,
    `imageGainToPatch ${meta.imageGainToPatch}: linear-light brightness gain matching the 6 m mosaic over the overlap (applied in the shader).`,
  ],
});
man.files['public/data/context_dem.i16'].generatedOn = now;
fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
log('done. context.jpg', (img.bytes / 1e6).toFixed(2), 'MB');
