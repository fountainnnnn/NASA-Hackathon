#!/usr/bin/env node
/**
 * MarsWalk Copilot data pipeline.
 *
 *   node scripts/prepare-data.mjs
 *
 * Downloads real NASA / USGS products (cached in data/raw/, gitignored) and writes the
 * runtime assets in public/data/ that src/lib/contracts.ts describes, plus
 * data/source_manifest.json and data/validation.json.
 *
 * Geometry conventions (see contracts.ts): Mars 2000 sphere R = 3 396 190 m, longitude positive
 * east, latitude planetocentric, heights above the areoid. Every raster is resampled/cropped so its
 * outer edges equal the DEM outer edges exactly (uv linear in lon/lat, row 0 = north).
 *
 * Idempotent: re-running reuses data/raw/ and overwrites outputs deterministically.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';
import sharp from 'sharp';
import JSZip from 'jszip';
import shapefile from 'shapefile';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const R = 3_396_190;
const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;
const LICENCE = 'NASA data: generally not copyrighted; cite source. USGS data: public domain, cite publication.';
const TREK_STREAM = 'https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=';
const DEM_LABEL = 'JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0';
const ORTHO_LABEL = 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0';
const THEMIS = {
  themisDay: { label: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', out: 'themis_day.png' },
  themisNight: { label: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', out: 'themis_night.png' },
};
const THEMIS_BASE = (label) => `https://trek.nasa.gov/tiles/Mars/EQ/${label}/1.0.0/`;
const GEO_SERVICE = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Jezero_FeatureServiceFromPro/FeatureServer';
const OUT_SR = '{"wkt":"GEOGCS[\\"GCS_Mars_2000_Sphere\\",DATUM[\\"D_Mars_2000_Sphere\\",SPHEROID[\\"Mars_2000_Sphere\\",3396190.0,0.0]],PRIMEM[\\"Reference_Meridian\\",0.0],UNIT[\\"Degree\\",0.0174532925199433]]"}';
const WAYPOINTS_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const TREK_SEARCH_URL = 'https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?rows=2100&start=0&q=*';
const TRAVERSE_PATH_LABEL = 'Perseverance_Traverse_Path';
const GAZETTEER_URL = 'https://planetarynames.wr.usgs.gov/shapefiles/MARS_nomenclature_center_pts.zip';

const manifest = {}; // output path -> entry
const rawMeta = {}; // raw file name -> { url, sha256, bytes, downloadedOn }

/* ------------------------------------------------------------------ helpers */

const round = (v, n) => Number(v.toFixed(n));
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log(...a);

/** Download `url` to data/raw/<name> unless cached; sidecar <name>.meta.json keeps first-download date. */
async function download(url, name) {
  const file = path.join(RAW, name);
  const metaFile = file + '.meta.json';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || !fs.existsSync(metaFile)) {
    log(`  downloading ${url}`);
    let buf;
    for (let attempt = 1; ; attempt++) {
      try {
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'marswalk-data-prep/1.0' } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buf = Buffer.from(await res.arrayBuffer());
        } catch (fetchErr) {
          // Node's fetch ignores HTTP(S)_PROXY; curl honours it (needed behind a proxy / in sandboxes).
          if (String(fetchErr.message).startsWith('HTTP ')) throw fetchErr;
          buf = execFileSync('curl', ['-sSfL', '--max-time', '900', '-A', 'marswalk-data-prep/1.0', url], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
        }
        break;
      } catch (e) {
        if (attempt >= 4) throw new Error(`download failed ${url}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    fs.writeFileSync(file, buf);
    fs.writeFileSync(metaFile, JSON.stringify({ url, downloadedOn: new Date().toISOString() }));
  }
  const buf = fs.readFileSync(file);
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  rawMeta[name] = { url, sha256: sha256(buf), bytes: buf.length, downloadedOn: meta.downloadedOn };
  return buf;
}
async function downloadJson(url, name) {
  return JSON.parse((await download(url, name)).toString('utf8'));
}

function record(outFile, entry) {
  const full = path.join(OUT, outFile);
  manifest['public/data/' + outFile] = {
    output: 'public/data/' + outFile,
    outputBytes: fs.statSync(full).size,
    outputSha256: sha256(fs.readFileSync(full)),
    licence: LICENCE,
    ...entry,
  };
}
const rawEntries = (...names) => names.map((n) => ({ rawFile: 'data/raw/' + n, ...rawMeta[n] }));

function writeJson(file, obj) {
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(obj));
}

function median(sorted) {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
}

/** Bilinear resample of a window [x0,x1)x[y0,y1) (float source pixel coords, edges) to ow x oh, 8-bit. */
function resampleWindow(src, sw, sh, x0, x1, y0, y1, ow, oh) {
  const out = Buffer.alloc(ow * oh);
  for (let j = 0; j < oh; j++) {
    const v = y0 + ((j + 0.5) * (y1 - y0)) / oh - 0.5;
    const r0 = Math.max(0, Math.min(sh - 1, Math.floor(v)));
    const r1 = Math.min(sh - 1, r0 + 1);
    const fy = Math.min(1, Math.max(0, v - r0));
    for (let i = 0; i < ow; i++) {
      const u = x0 + ((i + 0.5) * (x1 - x0)) / ow - 0.5;
      const c0 = Math.max(0, Math.min(sw - 1, Math.floor(u)));
      const c1 = Math.min(sw - 1, c0 + 1);
      const fx = Math.min(1, Math.max(0, u - c0));
      const a = src[r0 * sw + c0] * (1 - fx) + src[r0 * sw + c1] * fx;
      const b = src[r1 * sw + c0] * (1 - fx) + src[r1 * sw + c1] * fx;
      out[j * ow + i] = Math.round(a * (1 - fy) + b * fy);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ 1. DEM */

async function prepareDem() {
  log('[1] DEM');
  const demUrl = TREK_STREAM + DEM_LABEL;
  await download(demUrl, 'dem.tif');
  const tiff = await fromFile(path.join(RAW, 'dem.tif'));
  const img = await tiff.getImage();
  const W = img.getWidth();
  const H = img.getHeight();
  const [x0, y0] = img.getOrigin(); // projected metres, outer top-left corner (GTRasterType = PixelIsArea)
  const [resX, resY] = img.getResolution();
  if (Math.abs(resX) !== Math.abs(resY)) throw new Error('non-square DEM pixels');
  const geoKeys = img.getGeoKeys();
  if (geoKeys.GeogSemiMajorAxisGeoKey !== R || geoKeys.ProjCenterLongGeoKey !== 0 || geoKeys.ProjStdParallel1GeoKey !== 0 || geoKeys.GTRasterTypeGeoKey !== 1) {
    throw new Error('unexpected DEM georeferencing: ' + JSON.stringify(geoKeys));
  }
  const nodata = img.getGDALNoData();
  const raster = (await img.readRasters({ interleave: false }))[0];

  // Equirectangular, lat_ts = 0, lon0 = 0: X = R·lon, Y = R·lat. Pixel edges are exactly linear in lon/lat.
  const lonMin = (x0 / R) * DEG;
  const lonMax = ((x0 + W * Math.abs(resX)) / R) * DEG;
  const latMax = (y0 / R) * DEG;
  const latMin = ((y0 - H * Math.abs(resY)) / R) * DEG;
  const dLon = (lonMax - lonMin) / W;
  const dLat = (latMax - latMin) / H;

  const valid = [];
  let elevMin = Infinity;
  let elevMax = -Infinity;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (!Number.isFinite(v) || v === nodata || v < -1e30) continue;
    valid.push(v);
    if (v < elevMin) elevMin = v;
    if (v > elevMax) elevMax = v;
  }
  const sorted = Float64Array.from(valid).sort();
  const hRef = round(median(sorted), 3);

  // 0.05 m quantisation if the range fits int16 (±32500 steps), else the finest scale that fits.
  const mid = Math.round((elevMin + elevMax) / 2);
  const scale = Math.max(0.05, Math.ceil(((elevMax - elevMin) / 65000) * 1e4) / 1e4);
  const i16 = new Int16Array(W * H);
  let maxQuantErr = 0;
  for (let i = 0; i < raster.length; i++) {
    const v = raster[i];
    if (!Number.isFinite(v) || v === nodata || v < -1e30) {
      i16[i] = -32768;
      continue;
    }
    const q = Math.round((v - mid) / scale);
    i16[i] = q;
    maxQuantErr = Math.max(maxQuantErr, Math.abs(mid + q * scale - v));
  }
  fs.writeFileSync(path.join(OUT, 'dem.i16'), Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength));

  // Row-wise delta (first value of each row as-is, then differences), Int16 LE, gzip -9. Differences use
  // wrap-around Int16 arithmetic, so the transform is always lossless (decoder adds with the same wrap).
  const delta = new Int16Array(W * H);
  let maxAbsDelta = 0, wrapped = 0;
  for (let r = 0; r < H; r++) {
    const o = r * W;
    delta[o] = i16[o];
    for (let c = 1; c < W; c++) {
      const d = i16[o + c] - i16[o + c - 1];
      if (Math.abs(d) > 32767) wrapped++;
      else maxAbsDelta = Math.max(maxAbsDelta, Math.abs(d));
      delta[o + c] = d; // typed-array store wraps modulo 2^16
    }
  }
  const gz = zlib.gzipSync(Buffer.from(delta.buffer, delta.byteOffset, delta.byteLength), { level: 9 });
  fs.writeFileSync(path.join(OUT, 'dem.i16.gz'), gz);
  log(`  dem.i16.gz ${gz.length} bytes (plain ${i16.byteLength}); max |delta| ${maxAbsDelta}; ${wrapped} deltas wrapped (nodata edges, still lossless)`);

  const meta = {
    productLabel: DEM_LABEL,
    sourceUrl: demUrl,
    width: W, height: H,
    lonMin, lonMax, latMin, latMax,
    dLon, dLat,
    nominalResM: Math.abs(resX),
    encoding: { type: 'int16le', scale, offset: mid, nodata: -32768, delta: 'row', compression: 'gzip' },
    file: 'dem.i16.gz',
    elevMin: round(elevMin, 3), elevMax: round(elevMax, 3),
    hRef,
    datum: 'Mars 2000 sphere R=3396190 m; heights above areoid',
  };
  writeJson('dem_meta.json', meta);
  log(`  ${W}x${H}  lon ${lonMin.toFixed(5)}..${lonMax.toFixed(5)}  lat ${latMin.toFixed(5)}..${latMax.toFixed(5)}  hRef ${hRef}  elev ${meta.elevMin}..${meta.elevMax}  quant ${scale} m (max err ${maxQuantErr.toFixed(4)} m)`);

  // Sanity: bounds should roughly match the values quoted for the product.
  const expect = { lonMin: 77.1605, lonMax: 77.699, latMin: 18.211, latMax: 18.7212 };
  for (const k of Object.keys(expect)) {
    if (Math.abs(meta[k] - expect[k]) > 0.005) throw new Error(`DEM bound ${k}=${meta[k]} differs from expected ${expect[k]}`);
  }

  const common = {
    sourceUrls: [demUrl], productLabel: DEM_LABEL, mission: 'Mars Reconnaissance Orbiter', instrument: 'Context Camera (CTX) stereo DTM, MOLA-controlled',
    projection: 'Equirectangular (lat_ts 0, lon0 0), Mars 2000 sphere R=3396190 m', datum: meta.datum,
    credit: 'NASA/JPL/MSSS/USGS (MRO CTX via JPL Mars Trek)',
  };
  record('dem.i16', {
    ...common, raws: rawEntries('dem.tif'), resolution: '20 m/px (native)',
    processing: [
      'Read Float32 GeoTIFF with geotiff.js; origin/pixel scale give outer edges (PixelIsArea).',
      'Converted projected X,Y to lon/lat edges: lon = X/R, lat = Y/R (equirectangular, lat_ts 0, lon0 0).',
      `Encoded Int16 LE: v = round((h - ${mid}) / ${scale}); nodata -32768; max quantisation error ${maxQuantErr.toFixed(4)} m.`,
      `hRef = median of ${valid.length} valid cells.`,
    ],
  });
  record('dem_meta.json', { ...common, raws: rawEntries('dem.tif'), resolution: '20 m/px (native)', processing: ['Metadata describing dem.i16.'] });
  return { meta, raster, W, H, x0, y0, resM: Math.abs(resX) };
}

/* ------------------------------------------------------------------ 2. CTX ortho mosaic */

async function prepareCtx(dem) {
  log('[2] CTX mosaic');
  const url = TREK_STREAM + ORTHO_LABEL;
  await download(url, 'ortho.tif');
  const tiff = await fromFile(path.join(RAW, 'ortho.tif'));
  const img = await tiff.getImage();
  const [ox, oy] = img.getOrigin();
  const [rx] = img.getResolution();
  const res = Math.abs(rx);
  const ow = img.getWidth();
  const oh = img.getHeight();
  // DEM outer edges expressed in ortho pixel coordinates (floats).
  const c0 = (dem.x0 - ox) / res;
  const c1 = (dem.x0 + dem.W * dem.resM - ox) / res;
  const r0 = (oy - dem.y0) / res;
  const r1 = (oy - (dem.y0 - dem.H * dem.resM)) / res;
  const aligned = [c0, c1, r0, r1].every((v) => Math.abs(v - Math.round(v)) < 1e-3);
  if (!aligned) throw new Error(`ortho/DEM grids not pixel-aligned: ${[c0, c1, r0, r1]}`);
  const [ic0, ic1, ir0, ir1] = [c0, c1, r0, r1].map(Math.round);
  if (ic0 < 0 || ir0 < 0 || ic1 > ow || ir1 > oh) throw new Error('ortho does not cover DEM');
  const cw = ic1 - ic0;
  const ch = ir1 - ir0;
  log(`  ortho ${ow}x${oh}; crop cols ${ic0}..${ic1}, rows ${ir0}..${ir1} (${cw}x${ch}) = DEM edges`);
  const win = (await img.readRasters({ window: [ic0, ir0, ic1, ir1], interleave: false }))[0];
  const buf = Buffer.from(win.buffer, win.byteOffset, win.byteLength);

  const sizes = { 'ctx.jpg': 4096, 'ctx_2048.jpg': 2048 };
  const outputs = {};
  for (const [name, w] of Object.entries(sizes)) {
    const h = Math.round((w * ch) / cw);
    await sharp(buf, { raw: { width: cw, height: ch, channels: 1 } })
      .resize(w, h, { kernel: 'lanczos3' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(path.join(OUT, name));
    outputs[name] = { width: w, height: h };
    log(`  ${name} ${w}x${h} ${(fs.statSync(path.join(OUT, name)).size / 1e6).toFixed(2)} MB`);
    record(name, {
      sourceUrls: [url], productLabel: ORTHO_LABEL, mission: 'Mars Reconnaissance Orbiter', instrument: 'Context Camera (CTX)',
      projection: 'Equirectangular (lat_ts 0, lon0 0), Mars 2000 sphere R=3396190 m', datum: 'Mars 2000 sphere R=3396190 m',
      resolution: `6 m/px native, resampled to ${w} px wide (${(dem.W * dem.resM / w).toFixed(2)} m/px)`,
      credit: 'NASA/JPL/MSSS/USGS (MRO CTX via JPL Mars Trek)', raws: rawEntries('ortho.tif'),
      processing: [
        `Cropped ortho columns ${ic0}..${ic1}, rows ${ir0}..${ir1} so edges equal the DEM outer edges exactly (grids share an origin and are pixel-aligned).`,
        `Lanczos3 resample to ${w}x${h}, greyscale JPEG quality 85 (mozjpeg).`,
      ],
    });
  }
  return { ...outputs, edges: bboxOf(dem.meta) };
}

const bboxOf = (m) => ({ lonMin: m.lonMin, lonMax: m.lonMax, latMin: m.latMin, latMax: m.latMax });

/* ------------------------------------------------------------------ 3. THEMIS */

function parseTileMatrix(xml) {
  const tms = [];
  const re = /<TileMatrix>\s*<ows:Identifier>(\d+)<\/ows:Identifier>\s*<ScaleDenominator>([^<]+)<\/ScaleDenominator>\s*<TopLeftCorner>([^<]+)<\/TopLeftCorner>\s*<TileWidth>(\d+)<\/TileWidth>\s*<TileHeight>(\d+)<\/TileHeight>\s*<MatrixWidth>([^<]+)<\/MatrixWidth>\s*<MatrixHeight>([^<]+)<\/MatrixHeight>\s*<\/TileMatrix>/g;
  const stripped = xml.replace(/<!--[\s\S]*?-->/g, ''); // capabilities contain a commented-out alternative set
  for (const m of stripped.matchAll(re)) {
    const [lon0, lat0] = m[3].trim().split(/\s+/).map(Number);
    tms.push({ id: Number(m[1]), scaleDenominator: Number(m[2]), lon0, lat0, tw: Number(m[4]), th: Number(m[5]), mw: Number(m[6]), mh: Number(m[7]) });
  }
  return tms;
}

async function prepareThemis(key, dem) {
  const { label, out } = THEMIS[key];
  log(`[3] ${key} (${label})`);
  const base = THEMIS_BASE(label);
  const capsName = `${key}_caps.xml`;
  const caps = (await download(base + 'WMTSCapabilities.xml', capsName)).toString('utf8');
  const tms = parseTileMatrix(caps);
  if (!tms.length) throw new Error('no TileMatrix parsed');
  // Geographic matrix set: degrees per pixel = 360 / (matrixWidth * tileWidth). Ground sampling at the
  // equator = R·rad. Pick the level whose ground sampling is nearest 100 m/px, preferring finer on ties.
  const withRes = tms.map((t) => ({ ...t, degPx: 360 / (t.mw * t.tw) })).map((t) => ({ ...t, mPx: t.degPx * RAD * R }));
  const target = withRes.reduce((best, t) => (Math.abs(Math.log(t.mPx / 100)) < Math.abs(Math.log(best.mPx / 100)) ? t : best));
  log(`  levels ${tms.length}; using ${target.id}: ${target.mPx.toFixed(1)} m/px at equator (${target.mw}x${target.mh} tiles)`);

  const m = dem.meta;
  const px = (lon) => (lon - target.lon0) / target.degPx;
  const py = (lat) => (target.lat0 - lat) / target.degPx;
  const x0 = px(m.lonMin);
  const x1 = px(m.lonMax);
  const y0 = py(m.latMax);
  const y1 = py(m.latMin);
  const tc0 = Math.floor(x0 / target.tw);
  const tc1 = Math.floor((x1 - 1e-9) / target.tw);
  const tr0 = Math.floor(y0 / target.th);
  const tr1 = Math.floor((y1 - 1e-9) / target.th);
  const mosW = (tc1 - tc0 + 1) * target.tw;
  const mosH = (tr1 - tr0 + 1) * target.th;
  const mosaic = Buffer.alloc(mosW * mosH);
  const names = [];
  let minAlpha = 255;
  for (let r = tr0; r <= tr1; r++) {
    for (let c = tc0; c <= tc1; c++) {
      const name = `${key}/z${target.id}_r${r}_c${c}.png`;
      names.push(name);
      const buf = await download(`${base}default/default028mm/${target.id}/${r}/${c}.png`, name); // sequential: polite
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (info.width !== target.tw || info.height !== target.th) throw new Error('unexpected tile size');
      const ch = info.channels; // greyscale tiles decode as 1 colour channel + alpha
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const o = (y * info.width + x) * ch;
          mosaic[(y + (r - tr0) * target.th) * mosW + x + (c - tc0) * target.tw] = data[o];
          minAlpha = Math.min(minAlpha, data[o + ch - 1]);
        }
      }
    }
  }
  if (minAlpha < 255) log(`  warning: some tile pixels are transparent (min alpha ${minAlpha})`);
  // Output at native sampling (no invented detail): window size in source pixels, rounded.
  const ow = Math.round(x1 - x0);
  const oh = Math.round(y1 - y0);
  const grey = resampleWindow(mosaic, mosW, mosH, x0 - tc0 * target.tw, x1 - tc0 * target.tw, y0 - tr0 * target.th, y1 - tr0 * target.th, ow, oh);
  await sharp(grey, { raw: { width: ow, height: oh, channels: 1 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, out));
  log(`  ${out} ${ow}x${oh}  tiles ${names.length}  (${(fs.statSync(path.join(OUT, out)).size / 1e3).toFixed(0)} kB)`);
  record(out, {
    sourceUrls: [base + 'WMTSCapabilities.xml', ...names.map((n) => rawMeta[n].url)],
    productLabel: label, mission: 'Mars Odyssey', instrument: 'THEMIS (Thermal Emission Imaging System), IR',
    projection: 'Geographic (EPSG:104905 Mars 2000 sphere), WMTS default028mm', datum: 'Mars 2000 sphere R=3396190 m',
    resolution: `WMTS level ${target.id}: ${target.mPx.toFixed(1)} m/px at equator (finest level; product nominal 100 m)`,
    credit: 'NASA/JPL/ASU (Mars Odyssey THEMIS via JPL Mars Trek)',
    raws: [...rawEntries(capsName), ...rawEntries(...names)],
    processing: [
      `Parsed TileMatrixSet; selected level ${target.id}; fetched ${names.length} tiles sequentially.`,
      'Stitched tiles; bilinear resample of the window bounded by the DEM outer edges (fractional-pixel exact) to native sampling.',
      `Output ${ow}x${oh} 8-bit greyscale PNG (relative brightness, not calibrated).`,
    ],
  });
  return { file: out, width: ow, height: oh, edges: { lonMin: target.lon0 + x0 * target.degPx, lonMax: target.lon0 + x1 * target.degPx, latMax: target.lat0 - y0 * target.degPx, latMin: target.lat0 - y1 * target.degPx } };
}

/* ------------------------------------------------------------------ 4. Geology */

// Our own palette (NOT the USGS map colours). Ordered like unitOrder indices below.
const UNIT_COLORS = {
  Aeb: '#f2c14e', Nue: '#8e6bbf', Nnp1: '#4f9d8f', Nnp2: '#2f6f9f', Nrb: '#d96c5b', cr: '#a0724a', su: '#9aa5b1',
  Nle: '#c78fd1', ce: '#e08e45', NHjf2: '#3fb0d8', Njf: '#7cb342', ci: '#5d4e8c', NHjf1: '#1f8a70', Hnpf: '#e4577a',
};
const EXTRA_COLORS = ['#b5651d', '#6b8e23', '#00838f', '#c2185b']; // fallbacks if USGS adds units

const SIMPLIFY_TOL = 1.0e-5; // deg ≈ 0.6 m, 10x finer than the 6 m CTX base

function ringArea(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2; // >0 counter-clockwise (x east, y north)
}
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const ringBbox = (ring) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of ring) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
};

/** Iterative Douglas-Peucker on an open polyline (planar lon/lat, tolerance in degrees). */
function simplifyLine(pts, tol) {
  const n = pts.length;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Split an Esri multi-part polygon into polygons of (outer ring + holes). Esri: outer = clockwise. */
function splitEsriRings(rings, prec) {
  const clean = rings.map((r) => {
    const out = [];
    for (const [x, y] of r) {
      const p = [round(x, prec), round(y, prec)];
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
    return out;
  }).map((r) => { const q = simplifyLine(r, SIMPLIFY_TOL); return q.length >= 4 ? q : r; }).filter((r) => r.length >= 4);
  const outers = [];
  const holes = [];
  for (const r of clean) (ringArea(r) < 0 ? outers : holes).push(r);
  if (!outers.length && holes.length) outers.push(holes.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a))).shift());
  const polys = outers.map((o) => ({ outer: o, area: Math.abs(ringArea(o)), holes: [] }));
  let orphans = 0;
  for (const h of holes) {
    const host = polys.filter((p) => pointInRing(h[0], p.outer)).sort((a, b) => a.area - b.area)[0];
    if (host) host.holes.push(h); else orphans++;
  }
  return { polys: polys.map((p) => [p.outer, ...p.holes]), orphans };
}

async function fetchGeologyLayer(layer, prefix) {
  const features = [];
  for (let offset = 0; ; offset += 2000) {
    const q = new URLSearchParams({ where: '1=1', outFields: '*', outSR: OUT_SR, geometryPrecision: '6', resultOffset: String(offset), resultRecordCount: '2000', f: 'json' });
    const page = await downloadJson(`${GEO_SERVICE}/${layer}/query?${q}`, `${prefix}_${offset}.json`);
    if (page.error) throw new Error('ArcGIS error: ' + JSON.stringify(page.error));
    features.push(...page.features);
    if (!page.exceededTransferLimit && page.features.length < 2000) break;
  }
  return features;
}

async function prepareGeology(dem) {
  log('[4] Geology');
  const PREC = 5; // 1e-5 deg ≈ 0.6 m, finer than the 6 m CTX base; keeps the file small
  const unitFeatures = await fetchGeologyLayer(8, 'geology_units');
  const ellipseFeatures = await fetchGeologyLayer(2, 'geology_ellipse');
  const m = dem.meta;
  const bbox = [m.lonMin, m.latMin, m.lonMax, m.latMax];
  const overlaps = (b) => b[0] <= bbox[2] && b[2] >= bbox[0] && b[1] <= bbox[3] && b[3] >= bbox[1];

  const units = {};
  const counts = {};
  const polygons = [];
  let orphanHoles = 0;
  for (const f of unitFeatures) {
    const a = f.attributes;
    const symbol = a.symbol; // 'Crater riim unit' typo variant shares symbol 'cr' so it dedupes by key
    if (!symbol || !f.geometry?.rings) continue;
    const name = a.name === 'Crater riim unit' ? 'Crater rim unit' : a.name;
    const { polys, orphans } = splitEsriRings(f.geometry.rings, PREC);
    orphanHoles += orphans;
    for (const rings of polys) {
      const b = ringBbox(rings[0]);
      if (!overlaps(b)) continue;
      polygons.push({ unit: symbol, rings, bbox: b.map((v) => round(v, PREC)) });
      counts[symbol] = (counts[symbol] || 0) + 1;
      const u = units[symbol] ?? (units[symbol] = { symbol, name, description: '', interpretation: '', color: '' });
      if (!u.description && a.Unit_Description) u.description = a.Unit_Description.trim();
      if (!u.interpretation && a.Unit_Interpretation) u.interpretation = a.Unit_Interpretation.trim();
    }
  }
  // Deterministic order: most polygons first, symbol as tie-break.
  const unitOrder = Object.keys(units).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  let extra = 0;
  for (const s of unitOrder) units[s].color = UNIT_COLORS[s] ?? EXTRA_COLORS[extra++ % EXTRA_COLORS.length];
  const unitsOrdered = Object.fromEntries(unitOrder.map((s) => [s, units[s]]));

  const ellipse = ellipseFeatures.flatMap((f) => splitEsriRings(f.geometry.rings, PREC).polys.map((r) => r[0]));
  log(`  ${unitFeatures.length} polygons fetched -> ${polygons.length} (outer rings) in DEM bbox; units ${unitOrder.length}; orphan holes ${orphanHoles}; ellipse rings ${ellipse.length}`);

  const geology = {
    source: { title: 'Geologic Map of Jezero Crater and the Nili Planum Region, Mars', authors: 'Sun, V.Z. and Stack, K.M.', year: 2020, url: 'https://pubs.usgs.gov/publication/sim3464', scale: '1:75,000' },
    colorNote: 'Unit colours are this project\'s own palette for legibility; they are NOT the USGS SIM 3464 map colours.',
    unitOrder,
    units: unitsOrdered,
    polygons,
    ellipse,
  };
  writeJson('geology.json', geology);
  log(`  geology.json ${(fs.statSync(path.join(OUT, 'geology.json')).size / 1e6).toFixed(2)} MB`);

  // geology_idx.png: even-odd scanline rasterisation at pixel centres; R = unit index + 1, 0 = unmapped.
  const GW = 2048;
  const GH = Math.round((GW * m.height) / m.width);
  const idx = new Uint8Array(GW * GH);
  const dx = (m.lonMax - m.lonMin) / GW;
  const dy = (m.latMax - m.latMin) / GH;
  const order = new Map(unitOrder.map((s, i) => [s, i + 1]));
  for (const p of polygons) {
    const val = order.get(p.unit);
    const [bx0, by0, bx1, by1] = p.bbox;
    const j0 = Math.max(0, Math.floor((m.latMax - by1) / dy - 0.5));
    const j1 = Math.min(GH - 1, Math.ceil((m.latMax - by0) / dy - 0.5));
    for (let j = j0; j <= j1; j++) {
      const lat = m.latMax - (j + 0.5) * dy;
      if (lat < by0 || lat > by1) continue;
      const xs = [];
      for (const ring of p.rings) {
        for (let k = 0, n = ring.length - 1; k < n; k++) {
          const [xa, ya] = ring[k];
          const [xb, yb] = ring[k + 1];
          if (ya > lat !== yb > lat) xs.push(xa + ((lat - ya) / (yb - ya)) * (xb - xa));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - m.lonMin) / dx - 0.5));
        const i1 = Math.min(GW - 1, Math.floor((xs[k + 1] - m.lonMin) / dx - 0.5));
        for (let i = i0; i <= i1; i++) idx[j * GW + i] = val;
      }
    }
  }
  const rgb = Buffer.alloc(GW * GH * 3);
  for (let i = 0; i < idx.length; i++) rgb[i * 3] = idx[i];
  await sharp(rgb, { raw: { width: GW, height: GH, channels: 3 } }).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'geology_idx.png'));
  const mapped = idx.reduce((n, v) => n + (v ? 1 : 0), 0);
  log(`  geology_idx.png ${GW}x${GH}; mapped ${(100 * mapped / idx.length).toFixed(1)}% of pixels`);

  const rawNames = unitFeatures.length ? Object.keys(rawMeta).filter((k) => k.startsWith('geology_')) : [];
  const common = {
    sourceUrls: [`${GEO_SERVICE}/8`, `${GEO_SERVICE}/2`, 'https://pubs.usgs.gov/publication/sim3464'],
    productLabel: 'USGS SIM 3464 Jezero_FeatureServiceFromPro (layer 8 Geologic Units, layer 2 LandingEllipse)',
    mission: 'Mars 2020 landing-site mapping (map compiled on MRO CTX/HiRISE imagery)', instrument: 'Geologic map, Sun & Stack 2020',
    projection: 'Source MTM (central meridian 77.5E, Mars 2000 sphere) reprojected server-side to Mars 2000 geographic (outSR)', datum: 'Mars 2000 sphere R=3396190 m',
    resolution: '1:75,000 map scale', credit: 'USGS / Sun & Stack 2020 (SIM 3464)', raws: rawEntries(...rawNames),
  };
  record('geology.json', {
    ...common,
    processing: [
      'Paged layer 8 with resultOffset (maxRecordCount 2000), outSR Mars 2000 geographic, geometryPrecision 6.',
      'Split Esri multipart polygons into outer ring (clockwise) + holes; kept polygons whose outer-ring bbox overlaps the DEM bbox (not clipped).',
      `Vertices rounded to ${PREC} decimals (~0.6 m) with consecutive duplicates removed; Douglas-Peucker simplification at 1e-5 deg (~0.6 m).`,
      'Units keyed by symbol; "Crater riim unit" typo variant merged into "cr" ("Crater rim unit").',
      'Colours assigned by this project (not USGS). Added fields: unitOrder, colorNote.',
      'Landing ellipse (layer 2) outer rings stored in `ellipse`.',
    ],
  });
  record('geology_idx.png', {
    ...common,
    processing: [`Even-odd scanline rasterisation of polygons (holes honoured) at pixel centres onto a ${GW}x${GH} grid spanning the DEM outer edges; later polygons overwrite earlier.`, 'Red channel = index into geology.json unitOrder + 1 (0 = unmapped); G,B = 0.'],
  });
  return { width: GW, height: GH, unitOrder };
}

/* ------------------------------------------------------------------ 5. Traverse */

async function prepareTraverse(dem) {
  log('[5] Traverse');
  const wp = await downloadJson(WAYPOINTS_URL, 'waypoints.json');
  const m = dem.meta;
  const inside = (lon, lat) => lon >= m.lonMin && lon <= m.lonMax && lat >= m.latMin && lat <= m.latMax;
  const points = [];
  for (const f of wp.features) {
    const p = f.properties;
    if (![p.sol, p.lon, p.lat, p.elev_geoid, p.dist_total_m].every(Number.isFinite)) continue;
    if (!inside(p.lon, p.lat)) continue;
    points.push({ sol: p.sol, lon: p.lon, lat: p.lat, elevGeoid: p.elev_geoid, distTotalM: p.dist_total_m });
  }
  points.sort((a, b) => a.distTotalM - b.distTotalM || a.sol - b.sol);
  writeJson('traverse.json', { source: { title: 'Mars 2020 Perseverance rover waypoints (NASA MMGIS, M20_waypoints)', url: WAYPOINTS_URL }, points });
  log(`  waypoints total ${wp.features.length}; inside DEM ${points.length}; last sol ${points.at(-1)?.sol}, ${points.at(-1)?.distTotalM} m`);
  record('traverse.json', {
    sourceUrls: [WAYPOINTS_URL], productLabel: wp.name ?? 'M20_waypoints', mission: 'Mars 2020 (Perseverance)', instrument: 'Rover localisation (waypoints, NASA MMGIS)',
    projection: 'Geographic lon/lat as published (east-positive)', datum: 'Mars 2000 sphere; elev_geoid above areoid', resolution: 'per-waypoint',
    credit: 'NASA/JPL-Caltech (Mars 2020 MMGIS waypoints)', raws: rawEntries('waypoints.json'),
    processing: ['Kept waypoints with finite sol/lon/lat/elev_geoid/dist_total_m inside the DEM outer edges.', 'Fields renamed to contract (elevGeoid, distTotalM); sorted by cumulative distance.'],
  });

  // Optional: continuous path from the Mars Trek shapefile.
  let pathInfo = null;
  try {
    const url = TREK_STREAM + TRAVERSE_PATH_LABEL;
    const zbuf = await download(url, 'traverse_path.zip');
    const zip = await JSZip.loadAsync(zbuf);
    const names = Object.keys(zip.files);
    const get = async (ext) => zip.files[names.find((n) => n.toLowerCase().endsWith(ext))].async('nodebuffer');
    const shp = await shapefile.read(await get('.shp'), await get('.dbf'));
    const segs = shp.features
      .filter((f) => f.geometry?.type === 'LineString')
      .sort((a, b) => a.properties.SCLK_START - b.properties.SCLK_START);
    const line = [];
    for (const s of segs) {
      for (const [lon, lat] of s.geometry.coordinates) {
        const p = [round(lon, 6), round(lat, 6)];
        const last = line[line.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) line.push(p);
      }
    }
    const kept = line.filter(([lon, lat]) => inside(lon, lat));
    writeJson('traverse_path.json', kept);
    log(`  traverse_path.json: ${segs.length} segments -> ${line.length} vertices, ${kept.length} inside DEM`);
    record('traverse_path.json', {
      sourceUrls: [url], productLabel: TRAVERSE_PATH_LABEL, mission: 'Mars 2020 (Perseverance)', instrument: 'Rover traverse path (Mars Trek vector product)',
      projection: 'Geographic Mars 2000 (shapefile .prj), lon east-positive', datum: 'Mars 2000 sphere R=3396190 m', resolution: 'vector',
      credit: 'NASA/JPL-Caltech (Mars 2020 traverse via JPL Mars Trek)', raws: rawEntries('traverse_path.zip'),
      processing: ['Parsed zipped shapefile (332 LineString segments) with shapefile + JSZip.', 'Sorted segments by SCLK_START, concatenated, dropped repeated vertices, kept vertices inside DEM bounds; [lon,lat][] with 6 decimals.',
        'Segments are joined end-to-start; gaps between drives (if any) appear as straight connectors.'],
    });
    pathInfo = { segments: segs.length, vertices: kept.length };
  } catch (e) {
    log('  traverse_path skipped: ' + e.message);
  }
  return { points, pathInfo };
}

/* ------------------------------------------------------------------ 6. Nomenclature */

async function prepareNomenclature(dem) {
  log('[6] Nomenclature');
  const m = dem.meta;
  const PAD = 0.2;
  const inBox = (lon, lat) => lon >= m.lonMin - PAD && lon <= m.lonMax + PAD && lat >= m.latMin - PAD && lat <= m.latMax + PAD;
  const norm = (lon) => (lon > 180 ? lon - 360 : lon);
  const shortType = (t) => { const s = String(t).split(',')[0].trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

  // (a) Mars Trek search index (primary request). Records what it holds for the DEM area.
  const trek = await downloadJson(TREK_SEARCH_URL, 'trek_search_all.json');
  const trekNames = [];
  for (const d of trek.response.docs) {
    if (d.itemType !== 'nomenclature') continue;
    const mm = /^POINT \(([-\d.eE+]+) ([-\d.eE+]+)\)/.exec(d.shape || '');
    if (!mm) continue;
    const lon = norm(Number(mm[1]));
    const lat = Number(mm[2]);
    if (inBox(lon, lat)) trekNames.push({ name: d.title, type: shortType(d.productCat2 ?? ''), lon, lat });
  }
  log(`  Mars Trek nomenclature items: ${trek.response.docs.filter((d) => d.itemType === 'nomenclature').length} global, ${trekNames.length} near DEM (${trekNames.map((t) => t.name).join(', ')})`);

  // (b) USGS Gazetteer of Planetary Nomenclature, Mars centre points (authoritative IAU list, richer).
  const zip = await JSZip.loadAsync(await download(GAZETTEER_URL, 'gazetteer_mars_pts.zip'));
  const names = Object.keys(zip.files);
  const get = async (ext) => zip.files[names.find((n) => n.toLowerCase().endsWith(ext))].async('nodebuffer');
  const src = await shapefile.read(await get('.shp'), await get('.dbf'), { encoding: 'utf-8' });
  const features = [];
  for (const f of src.features) {
    const p = f.properties;
    const lon = norm(Number(p.center_lon));
    const lat = Number(p.center_lat);
    if (!inBox(lon, lat)) continue;
    const fixMojibake = (s) => (s && /Ã|Â/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s);
    const feat = { name: p.name, type: shortType(p.type), lon: round(lon, 4), lat: round(lat, 4) };
    if (Number.isFinite(p.diameter) && p.diameter > 0) feat.diameterKm = round(p.diameter, 3);
    if (p.origin) feat.origin = fixMojibake(p.origin);
    features.push(feat);
  }
  features.sort((a, b) => (b.diameterKm ?? 0) - (a.diameterKm ?? 0) || a.name.localeCompare(b.name));
  const have = new Set(features.map((f) => f.name));
  for (const t of trekNames) if (!have.has(t.name)) features.push(t);
  writeJson('nomenclature.json', {
    source: { title: 'IAU Gazetteer of Planetary Nomenclature, Mars (USGS Astrogeology); Mars Trek nomenclature search consulted', url: 'https://planetarynames.wr.usgs.gov' },
    features,
  });
  log(`  nomenclature.json: ${features.length} features within DEM bbox ±${PAD}°: ${features.map((f) => f.name).join(', ')}`);
  record('nomenclature.json', {
    sourceUrls: [TREK_SEARCH_URL, GAZETTEER_URL], productLabel: 'IAU Planetary Nomenclature: Mars', mission: 'n/a (IAU names)', instrument: 'n/a',
    projection: 'Planetocentric lon/lat, converted to east-positive -180..180', datum: 'Mars 2000', resolution: 'point (feature centre)',
    credit: 'IAU Working Group for Planetary System Nomenclature / USGS Astrogeology', raws: rawEntries('trek_search_all.json', 'gazetteer_mars_pts.zip'),
    processing: [
      `Mars Trek search (rows=2100, q=*) holds ${trek.response.docs.filter((d) => d.itemType === 'nomenclature').length} nomenclature items, only ${trekNames.length} near the DEM, so the USGS Gazetteer centre-point shapefile was used as the main source.`,
      `Kept features with centre inside DEM bbox ±${PAD}°; type reduced to the singular head word; diameter in km as published; Trek-only names added if missing.`,
    ],
  });
  return features.length;
}

/* ------------------------------------------------------------------ 7. layers.json */

function writeLayers(dem, ctx, themisDay, themisNight, geo, hasPath) {
  const trekCredit = { ctx: 'NASA/JPL/MSSS/USGS (MRO CTX via JPL Mars Trek)', themis: 'NASA/JPL/ASU (Mars Odyssey THEMIS via JPL Mars Trek)' };
  const sim = 'https://pubs.usgs.gov/publication/sim3464';
  const layers = [
    { id: 'ctx', file: 'ctx.jpg', width: ctx['ctx.jpg'].width, height: ctx['ctx.jpg'].height, title: 'MRO CTX visible mosaic (6 m)', mission: 'Mars Reconnaissance Orbiter', instrument: 'Context Camera (CTX)', kind: 'optical', provenance: 'observed', sourceUrl: TREK_STREAM + ORTHO_LABEL, credit: trekCredit.ctx, note: 'Greyscale relative brightness, uncalibrated. A 2048 px version is ctx_2048.jpg.' },
    { id: 'themisDay', file: themisDay.file, width: themisDay.width, height: themisDay.height, title: 'THEMIS daytime infrared mosaic (100 m)', mission: 'Mars Odyssey', instrument: 'THEMIS (Thermal Emission Imaging System)', kind: 'thermal', provenance: 'observed', sourceUrl: THEMIS_BASE(THEMIS.themisDay.label) + 'WMTSCapabilities.xml', credit: trekCredit.themis, note: 'Relative brightness (8-bit), not calibrated temperature. Coarse: ~100 m/px, about 5x coarser than the DEM.' },
    { id: 'themisNight', file: themisNight.file, width: themisNight.width, height: themisNight.height, title: 'THEMIS nighttime infrared mosaic (100 m)', mission: 'Mars Odyssey', instrument: 'THEMIS (Thermal Emission Imaging System)', kind: 'thermal', provenance: 'observed', sourceUrl: THEMIS_BASE(THEMIS.themisNight.label) + 'WMTSCapabilities.xml', credit: trekCredit.themis, note: 'Relative brightness (8-bit), not calibrated temperature. Brighter generally means warmer at night; this is a qualitative thermal-inertia cue only.' },
    { id: 'geology', file: 'geology_idx.png', width: geo.width, height: geo.height, title: 'Geologic units (Sun & Stack 2020, 1:75,000)', mission: 'Mars 2020 landing-site mapping (map compiled on MRO CTX/HiRISE imagery)', instrument: 'Geologic map (USGS SIM 3464)', kind: 'geologic', provenance: 'observed', sourceUrl: sim, credit: 'USGS / Sun & Stack 2020 (SIM 3464)', note: 'Index raster (R = unitOrder index + 1, 0 = unmapped); vector polygons in geology.json. Display colours are this project\'s own, not USGS colours.' },
    { id: 'slope', file: '', width: 0, height: 0, title: 'Slope (derived from the CTX DEM)', mission: 'Mars Reconnaissance Orbiter', instrument: 'Context Camera (CTX) stereo DTM', kind: 'derived', provenance: 'computed', sourceUrl: TREK_STREAM + DEM_LABEL, credit: trekCredit.ctx, note: 'Computed client-side from dem.i16 at 20 m posting; slope over a 20 m baseline.' },
    { id: 'traverse', file: 'traverse.json', width: 0, height: 0, title: 'Perseverance traverse waypoints', mission: 'Mars 2020 (Perseverance)', instrument: 'Rover localisation (NASA MMGIS waypoints)', kind: 'topographic', provenance: 'observed', sourceUrl: WAYPOINTS_URL, credit: 'NASA/JPL-Caltech (Mars 2020 MMGIS waypoints)', note: hasPath ? 'Vector layer. Continuous drive path in traverse_path.json (Mars Trek Perseverance_Traverse_Path).' : 'Vector layer.' },
    { id: 'ellipse', file: 'geology.json', width: 0, height: 0, title: 'Mars 2020 landing ellipse', mission: 'Mars 2020 (Perseverance)', instrument: 'Geologic map layer LandingEllipse (USGS SIM 3464)', kind: 'geologic', provenance: 'observed', sourceUrl: sim, credit: 'USGS / Sun & Stack 2020 (SIM 3464)', note: 'Vector rings stored in the `ellipse` field of geology.json.' },
  ];
  writeJson('layers.json', layers);
  record('layers.json', { sourceUrls: [], productLabel: 'layer catalogue', mission: 'n/a', instrument: 'n/a', projection: 'n/a', datum: 'n/a', resolution: 'n/a', credit: 'see per-layer credits', raws: [], processing: ['Hand-written catalogue assembled by prepare-data.mjs from the generated files.'] });
  return layers;
}

/* ------------------------------------------------------------------ 9. Validation */

function validate(dem, trav, rasters) {
  log('[9] Validation');
  const m = dem.meta;
  const { W, H } = dem;
  const elev = dem.raster;
  const sample = (lon, lat) => {
    const fx = (lon - m.lonMin) / m.dLon - 0.5; // pixel centres at +0.5
    const fy = (m.latMax - lat) / m.dLat - 0.5;
    const c = Math.floor(fx);
    const r = Math.floor(fy);
    if (c < 0 || r < 0 || c + 1 >= W || r + 1 >= H) return null;
    const tx = fx - c;
    const ty = fy - r;
    const v = [elev[r * W + c], elev[r * W + c + 1], elev[(r + 1) * W + c], elev[(r + 1) * W + c + 1]];
    if (v.some((x) => !Number.isFinite(x) || x < -1e30)) return null;
    return (v[0] * (1 - tx) + v[1] * tx) * (1 - ty) + (v[2] * (1 - tx) + v[3] * tx) * ty;
  };
  const rows = [];
  let skipped = 0;
  for (const p of trav.points) {
    const h = sample(p.lon, p.lat);
    if (h === null) { skipped++; continue; }
    rows.push({ sol: p.sol, lon: p.lon, lat: p.lat, waypointElev: p.elevGeoid, demElev: round(h, 3), residual: round(h - p.elevGeoid, 3) });
  }
  const res = rows.map((r) => r.residual);
  const abs = res.map(Math.abs).sort((a, b) => a - b);
  const mean = res.reduce((a, b) => a + b, 0) / res.length;
  const std = Math.sqrt(res.reduce((a, b) => a + (b - mean) ** 2, 0) / res.length);
  const medRes = median(Float64Array.from(res).sort());
  const p95 = abs[Math.min(abs.length - 1, Math.ceil(0.95 * abs.length) - 1)];
  const worst = [...rows].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 5);
  const landing = rows.find((r) => Math.abs(r.lon - 77.45088572) < 1e-6 && Math.abs(r.lat - 18.44462715) < 1e-6);

  // Texture bounds must equal DEM edges (all rasters are built from those edges; edges re-derived independently here).
  const demEdges = bboxOf(m);
  const tol = 1e-9;
  const textureBounds = {};
  for (const [name, e] of Object.entries(rasters)) {
    const dif = Math.max(...['lonMin', 'lonMax', 'latMin', 'latMax'].map((k) => Math.abs(e[k] - demEdges[k])));
    textureBounds[name] = { ...e, maxAbsDiffDeg: dif, ok: dif < tol };
    if (dif >= tol) throw new Error(`texture ${name} bounds differ from DEM edges by ${dif} deg`);
  }
  const result = {
    count: rows.length, skippedOutsideOrNodata: skipped,
    meanResidualM: round(mean, 3), medianResidualM: round(medRes, 3), stdResidualM: round(std, 3),
    p95AbsResidualM: round(p95, 3), maxAbsResidualM: round(abs.at(-1), 3),
    residualDefinition: 'DEM bilinear sample minus waypoint elev_geoid (m)',
    worstFive: worst,
    landingWaypointSol13: landing ?? null,
    demEdges, textureBounds,
  };
  fs.writeFileSync(path.join(DATA, 'validation.json'), JSON.stringify(result, null, 2));
  log(JSON.stringify({ count: result.count, mean: result.meanResidualM, median: result.medianResidualM, std: result.stdResidualM, p95Abs: result.p95AbsResidualM, maxAbs: result.maxAbsResidualM, landing: landing ?? null }, null, 1));
  log('  worst five:');
  for (const w of worst) log(`   sol ${w.sol} (${w.lon}, ${w.lat}) wp ${w.waypointElev} dem ${w.demElev} res ${w.residual}`);
  log('  all texture bounds equal DEM edges (tol 1e-9 deg)');
  return result;
}

/* ------------------------------------------------------------------ main */

const dem = await prepareDem();
const ctx = await prepareCtx(dem);
const themisDay = await prepareThemis('themisDay', dem);
const themisNight = await prepareThemis('themisNight', dem);
const geo = await prepareGeology(dem);
const trav = await prepareTraverse(dem);
await prepareNomenclature(dem);
const layers = writeLayers(dem, ctx, themisDay, themisNight, geo, !!trav.pathInfo);
const validation = validate(dem, trav, { ctx: ctx.edges, themisDay: themisDay.edges, themisNight: themisNight.edges, geology_idx: bboxOf(dem.meta) });

fs.writeFileSync(
  path.join(DATA, 'source_manifest.json'),
  JSON.stringify({ generatedBy: 'scripts/prepare-data.mjs', generatedOn: new Date().toISOString(), aiAssistance: 'Processing code written with AI assistance (Claude Code); the data values are unmodified NASA/USGS products. See docs/AI_USE.md.', licence: LICENCE, files: manifest }, null, 2),
);
const total = fs.readdirSync(OUT).filter((f) => fs.statSync(path.join(OUT, f)).isFile()).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
log(`done. public/data total (this script's files + others) ${(total / 1e6).toFixed(2)} MB; layers ${layers.length}; validation n=${validation.count}`);
