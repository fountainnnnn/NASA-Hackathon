#!/usr/bin/env node
/**
 * MarsWalk Copilot GLOBAL data pipeline (globe revamp).
 *
 *   node scripts/prepare-global.mjs
 *
 * Downloads real NASA / USGS global products (cached in data/raw/global/, gitignored) and writes
 * public/data/global/* as described by src/lib/globeContracts.ts, plus data/global_manifest_sources.json
 * and data/global_validation.json.
 *
 * Conventions: Mars 2000 sphere R = 3 396 190 m, planetocentric latitude, longitude POSITIVE EAST in -180..180.
 * Every raster is equirectangular: lon -180..180 left->right, lat 90..-90 top->bottom, pixel-edge aligned
 * (pixel (i,j) covers lon -180+i*360/W .. +(i+1)*360/W, lat 90-j*180/H .. 90-(j+1)*180/H).
 *
 * NOTE: pds-geosciences.wustl.edu fails TLS verification behind the Claude Code sandbox proxy; run unsandboxed
 * if downloads from it fail. Idempotent: re-running reuses data/raw/global/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';
import sharp from 'sharp';
import shapefile from 'shapefile';
import JSZip from 'jszip';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data/raw/global');
const OUT = path.join(ROOT, 'public/data/global');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const R = 3_396_190;
const RAD = Math.PI / 180;
const LICENCE = 'NASA data: generally not copyrighted, cite source. USGS data: public domain, cite publication.';
const TREK = 'https://trek.nasa.gov';
const TREK_STREAM = TREK + '/mars/TrekWS/rest/cat/data/stream?label=';
const TREK_CATALOG = TREK + '/mars/TrekServices/ws/index/eq/searchItems?rows=2100&start=0&q=*';
const MDIM_LABEL = 'Mars_Viking_MDIM21_ClrMosaic_global_232m';
const MDIM_CAPS = `${TREK}/tiles/Mars/EQ/${MDIM_LABEL}/1.0.0/WMTSCapabilities.xml`;
const MDIM_TILE = (z, r, c) => `${TREK}/tiles/Mars/EQ/${MDIM_LABEL}/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`;
const PDS = 'https://pds-geosciences.wustl.edu';
const MEGDR_URL = `${PDS}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img`;
const TI_URL = `${PDS}/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.img`;
const H2O_URL = `${PDS}/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab`;
const GAZ_URL = 'https://planetarynames.wr.usgs.gov/shapefiles/MARS_nomenclature_center_pts.zip';

const sources = []; // data/global_manifest_sources.json entries
const rawMeta = {}; // raw name -> {url, sha256, bytes, downloadedOn}
const log = (...a) => console.log(...a);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, n) => Number(v.toFixed(n));

/* ------------------------------------------------------------------ helpers */

async function curlTo(url, file) {
  // curl honours HTTP(S)_PROXY (Node fetch does not), so it is the primary transport.
  await execFileP('curl', ['-sSfL', '--retry', '3', '--max-time', '1500', '-A', 'marswalk-data-prep/1.0', '-o', file, url]);
}
/** Download `url` to data/raw/global/<name> unless cached. */
async function download(url, name) {
  const file = path.join(RAW, name);
  const metaFile = file + '.meta.json';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file) || (!fs.existsSync(metaFile) && !fs.existsSync(file + '.nometa'))) {
    log(`  downloading ${url}`);
    try {
      await curlTo(url, file + '.part');
    } catch (e) {
      const res = await fetch(url, { headers: { 'User-Agent': 'marswalk-data-prep/1.0' } });
      if (!res.ok) throw new Error(`download failed ${url}: ${e.message}; fetch HTTP ${res.status}`);
      fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
    }
    fs.renameSync(file + '.part', file);
    fs.writeFileSync(metaFile, JSON.stringify({ url, downloadedOn: new Date().toISOString() }));
  }
  const buf = fs.readFileSync(file);
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  rawMeta[name] = { url, sha256: sha256(buf), bytes: buf.length, downloadedOn: meta.downloadedOn ?? 'cached earlier in this session (2026-11-14)' };
  return buf;
}
async function httpStatus(url) {
  try {
    const { stdout } = await execFileP('curl', ['-sSL', '-o', '/dev/null', '-m', '30', '-A', 'marswalk-data-prep/1.0', '-w', '%{http_code}', url]);
    return Number(stdout.trim());
  } catch {
    return 0;
  }
}
function writeOut(name, data) {
  fs.writeFileSync(path.join(OUT, name), data);
  return fs.statSync(path.join(OUT, name)).size;
}
function addSource(entry) {
  sources.push({ licence: LICENCE, ...entry });
}
const rawEntry = (name) => ({ rawFile: 'data/raw/global/' + name, ...rawMeta[name] });
const outInfo = (name) => {
  const b = fs.readFileSync(path.join(OUT, name));
  return { output: 'public/data/global/' + name, outputBytes: b.length, outputSha256: sha256(b) };
};

/** Area-weighted box resample of a float grid (NaN = nodata, skipped). Returns Float32Array dw*dh. */
function boxResample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let j = 0; j < dh; j++) {
    const y0 = j * fy;
    const y1 = y0 + fy;
    for (let i = 0; i < dw; i++) {
      const x0 = i * fx;
      const x1 = x0 + fx;
      let acc = 0;
      let wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
          const v = src[yy * sw + xx];
          if (v !== v) continue;
          const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0));
          acc += v * w;
          wsum += w;
        }
      }
      out[j * dw + i] = wsum > 0 ? acc / wsum : NaN;
    }
  }
  return out;
}

/** piecewise-linear colour ramp over [t, r,g,b] stops. */
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const f = (t - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f];
    }
  }
  return stops[stops.length - 1].slice(1);
}
const INFERNO = [
  [0, 0, 0, 4], [0.13, 31, 12, 72], [0.25, 85, 15, 109], [0.38, 136, 34, 106], [0.5, 186, 54, 85],
  [0.63, 227, 89, 51], [0.75, 249, 140, 10], [0.88, 249, 201, 50], [1, 252, 255, 164],
];
const VIRIDIS = [
  [0, 68, 1, 84], [0.13, 72, 36, 117], [0.25, 65, 68, 135], [0.38, 53, 95, 141], [0.5, 42, 120, 142],
  [0.63, 34, 168, 132], [0.75, 68, 191, 112], [0.88, 122, 209, 81], [1, 253, 231, 37],
];
const YLGNBU = [
  [0, 255, 255, 217], [0.15, 237, 248, 177], [0.3, 199, 233, 180], [0.45, 127, 205, 187], [0.6, 65, 182, 196],
  [0.75, 29, 145, 192], [0.88, 34, 94, 168], [1, 12, 44, 132],
];
/** Hypsometric tint for Mars heights (m above areoid): deep basins blue-violet, lowlands teal, mid tan, highlands brown, summits white. */
const HYPSO = [
  [-8200, 36, 28, 99], [-6000, 51, 62, 140], [-4000, 62, 108, 168], [-2000, 88, 160, 170], [-500, 156, 195, 140],
  [500, 214, 205, 130], [2500, 196, 150, 96], [5000, 160, 108, 74], [9000, 130, 88, 66], [14000, 196, 184, 170],
  [21300, 255, 255, 255],
];

function rgbaPng(file, buf, w, h, { palette = false } = {}) {
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } })
    .png(palette ? { palette: true, quality: 90, effort: 10, colours: 256, dither: 0 } : { compressionLevel: 9, effort: 10 })
    .toFile(path.join(OUT, file));
}

/* ------------------------------------------------------------------ 1. display texture (Mars Trek WMTS, MDIM 2.1 colour) */

async function prepareTexture() {
  log('[1] display texture: Viking MDIM 2.1 colorized via Mars Trek WMTS');
  const caps = (await download(MDIM_CAPS, 'mdim_caps.xml')).toString('utf8');
  // Parse the capabilities: tile size and the matrix at the zoom we use (level 4 = 32 x 16 tiles of 256 = 8192 x 4096).
  const mats = [...caps.matchAll(/<TileMatrix>([\s\S]*?)<\/TileMatrix>/g)].map((m) => ({
    id: /<ows:Identifier>([^<]*)</.exec(m[1])[1],
    w: Number(/<MatrixWidth>([^<]*)</.exec(m[1])[1]),
    h: Number(/<MatrixHeight>([^<]*)</.exec(m[1])[1]),
    tw: Number(/<TileWidth>([^<]*)</.exec(m[1])[1]),
    th: Number(/<TileHeight>([^<]*)</.exec(m[1])[1]),
    corner: /<TopLeftCorner>([^<]*)</.exec(m[1])[1].trim(),
  }));
  const z = 4;
  const m = mats[z];
  if (!m || m.id !== String(z) || m.w * m.tw !== 8192 || m.h * m.th !== 4096 || m.corner !== '-180.0 90.0') {
    throw new Error('unexpected WMTS matrix ' + JSON.stringify(m));
  }
  log(`  matrix ${m.id}: ${m.w}x${m.h} tiles of ${m.tw}px, top-left ${m.corner}`);
  const tiles = [];
  for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) tiles.push([r, c]);
  let next = 0;
  const hashes = [];
  async function worker() {
    for (;;) {
      const k = next++;
      if (k >= tiles.length) return;
      const [r, c] = tiles[k];
      const name = `mdim/z${z}_${r}_${c}.jpg`;
      const file = path.join(RAW, name);
      const complete = () => fs.existsSync(file) && fs.statSync(file).size > 200 && fs.readFileSync(file).subarray(-2).equals(Buffer.from([0xff, 0xd9]));
      for (let attempt = 0; !complete(); attempt++) {
        if (attempt >= 4) throw new Error('tile failed ' + name);
        await curlTo(MDIM_TILE(z, r, c), file);
      }
    }
  }
  await Promise.all(Array.from({ length: 12 }, worker));
  const comps = [];
  for (const [r, c] of tiles) {
    const buf = fs.readFileSync(path.join(RAW, `mdim/z${z}_${r}_${c}.jpg`));
    hashes.push(sha256(buf));
    comps.push({ input: buf, left: c * 256, top: r * 256 });
  }
  const full = await sharp({ create: { width: 8192, height: 4096, channels: 3, background: '#000' } })
    .composite(comps)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      if (info.channels !== 3 || info.width !== 8192 || info.height !== 4096) throw new Error('unexpected stitch layout ' + JSON.stringify(info));
      return data;
    });
  const mk = (w) => sharp(full, { raw: { width: 8192, height: 4096, channels: 3 } });
  await mk(8192).jpeg({ quality: 82, mozjpeg: true }).toFile(path.join(OUT, 'mars_8k.jpg'));
  await mk(8192).resize(2048, 1024, { kernel: 'lanczos3' }).jpeg({ quality: 85, mozjpeg: true }).toFile(path.join(OUT, 'mars_2k.jpg'));
  addSource({
    ...outInfo('mars_8k.jpg'),
    source: 'Viking MDIM 2.1 colorized global mosaic (232 m/px) via JPL Mars Trek WMTS',
    url: MDIM_CAPS,
    tileTemplate: MDIM_TILE('{z}', '{row}', '{col}'),
    rawFile: 'data/raw/global/mdim/ (512 tiles z4)',
    tilesSha256Digest: sha256(hashes.join('')),
    processing: ['Read WMTSCapabilities.xml; matrix default028mm level 4 = 32x16 tiles of 256 px, top-left (-180, 90)', 'Fetched all 512 JPEG tiles (row/col order as in the template)', 'Stitched without resampling into 8192x4096', 'JPEG q82 (mozjpeg)'],
  });
  addSource({ ...outInfo('mars_2k.jpg'), source: 'same as mars_8k.jpg', url: MDIM_CAPS, processing: ['Lanczos3 downsample of the 8192x4096 stitch to 2048x1024', 'JPEG q85 (mozjpeg)'] });
  return { sha: sha256(hashes.join('')) };
}

/* ------------------------------------------------------------------ 2. DEM (MOLA MEGDR 16 ppd -> 2880x1440) */

const DW = 2880;
const DH = 1440;
let DEM; // Int16Array DW*DH, metres, row 0 = north, col 0 = lon -180
async function prepareDem() {
  log('[2] DEM: MGS MOLA MEGDR 16 ppd -> 2880x1440 (1/8 deg)');
  const buf = await download(MEGDR_URL, 'pds/megt_p.img');
  if (buf.length !== 5760 * 2880 * 2) throw new Error('unexpected MEGDR size ' + buf.length);
  const src = new Int16Array(5760 * 2880);
  for (let i = 0; i < src.length; i++) src[i] = buf.readInt16BE(i * 2);
  // Source columns cover lon 0..360 east (col c: c/16..(c+1)/16). Output col j covers -180+j/8: source col (2*j + 2880) mod 5760 (+1).
  DEM = new Int16Array(DW * DH);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < DH; j++) {
    for (let i = 0; i < DW; i++) {
      const c0 = (2 * i + 2880) % 5760;
      const c1 = (c0 + 1) % 5760;
      const v = (src[2 * j * 5760 + c0] + src[2 * j * 5760 + c1] + src[(2 * j + 1) * 5760 + c0] + src[(2 * j + 1) * 5760 + c1]) / 4;
      const q = Math.round(v);
      DEM[j * DW + i] = q;
      if (q < min) min = q;
      if (q > max) max = q;
    }
  }
  const raw = Buffer.from(DEM.buffer, DEM.byteOffset, DEM.byteLength);
  writeOut('mola_2880.i16.gz', zlib.gzipSync(raw, { level: 9 }));
  addSource({
    ...outInfo('mola_2880.i16.gz'),
    source: 'MGS MOLA MEGDR median topography, 16 pixel/degree (megt90n000eb), PDS Geosciences Node; ODY not involved',
    url: MEGDR_URL,
    ...rawEntryAny('pds/megt_p.img'),
    processing: ['Big-endian int16 5760x2880, lon 0..360 E, top row = 90N, heights in m above the MOLA areoid', 'Rotated columns by 180 deg so col 0 = lon -180', '2x2 box mean to 2880x1440 (1/8 deg ~ 7.4 km at the equator), rounded to integer metres', 'Int16 little-endian, scale 1, offset 0, nodata -32768 (none present), gzip -9'],
    stats: { minM: min, maxM: max },
  });
  log(`  min ${min} m, max ${max} m`);
  return { min, max };
}
function rawEntryAny(name) {
  return rawEntry(name);
}

/** bilinear height sample at lon/lat (east, deg) from the 2880x1440 DEM. */
function demAt(lon, lat) {
  const u = (lon + 180) / 0.125 - 0.5;
  const v = (90 - lat) / 0.125 - 0.5;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fx = u - i0;
  const fy = v - j0;
  const g = (i, j) => DEM[clamp(j, 0, DH - 1) * DW + (((i % DW) + DW) % DW)];
  return (g(i0, j0) * (1 - fx) + g(i0 + 1, j0) * fx) * (1 - fy) + (g(i0, j0 + 1) * (1 - fx) + g(i0 + 1, j0 + 1) * fx) * fy;
}

/* ------------------------------------------------------------------ 3. layers */

const LW = 2048;
const LH = 1024;
const layers = [];
const layerInfos = {};

async function layerElevationSlope() {
  log('[3a] elevation + slope layers');
  const f = new Float32Array(DW * DH);
  for (let i = 0; i < f.length; i++) f[i] = DEM[i];
  const elev = boxResample(f, DW, DH, LW, LH);
  const px = Buffer.alloc(LW * LH * 4);
  for (let i = 0; i < elev.length; i++) {
    const [r, g, b] = ramp(HYPSO, elev[i]);
    px.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  await rgbaPng('layer_elevation.png', px, LW, LH);
  const elevInfo = {
    id: 'elevation', file: 'layer_elevation.png', width: LW, height: LH,
    title: 'MOLA elevation (hypsometric tint)', mission: 'Mars Global Surveyor', instrument: 'Mars Orbiter Laser Altimeter (MOLA)', kind: 'topographic',
    provenance: 'observed', credit: 'NASA/GSFC MGS MOLA Science Team; PDS Geosciences Node MEGDR (Smith et al. 2003)', sourceUrl: MEGDR_URL,
    note: 'Display only: -8200 m (violet-blue) to +21300 m (white), metres above the MOLA areoid. Point values: read manifest.dem (mola_2880.i16.gz), same footprint, 1/8 degree.',
  };
  layers.push(elevInfo);
  addSource({ ...outInfo('layer_elevation.png'), source: 'derived from public/data/global/mola_2880.i16.gz (MOLA MEGDR)', url: MEGDR_URL, processing: ['Area-weighted box resample 2880x1440 -> 2048x1024', 'Hypsometric colour ramp -8200..21300 m'] });

  // Slope from the 2880x1440 DEM: central differences, metric spacing on the sphere.
  const dLat = 0.125 * RAD * R;
  const slope = new Float32Array(DW * DH);
  for (let j = 0; j < DH; j++) {
    const lat = (90 - (j + 0.5) * 0.125) * RAD;
    const dx = Math.max(Math.cos(lat), 0.02) * 0.125 * RAD * R;
    const jn = Math.max(j - 1, 0);
    const js = Math.min(j + 1, DH - 1);
    for (let i = 0; i < DW; i++) {
      const ie = (i + 1) % DW;
      const iw = (i + DW - 1) % DW;
      const dzdx = (DEM[j * DW + ie] - DEM[j * DW + iw]) / (2 * dx);
      const dzdy = (DEM[jn * DW + i] - DEM[js * DW + i]) / ((js - jn) * dLat);
      slope[j * DW + i] = Math.atan(Math.hypot(dzdx, dzdy)) / RAD;
    }
  }
  const slope2 = boxResample(slope, DW, DH, LW, LH);
  const sv = new Uint8Array(LW * LH);
  const sp = Buffer.alloc(LW * LH * 4);
  for (let i = 0; i < slope2.length; i++) {
    sv[i] = clamp(Math.round(slope2[i] / 0.25), 0, 254);
    const [r, g, b] = ramp(VIRIDIS, clamp(slope2[i] / 20, 0, 1));
    sp.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  await rgbaPng('layer_slope.png', sp, LW, LH, { palette: true });
  writeOut('layer_slope.u8.gz', zlib.gzipSync(Buffer.from(sv), { level: 9 }));
  const maxSlope = slope2.reduce((a, b) => Math.max(a, b), 0);
  layers.push({
    id: 'slope', file: 'layer_slope.png', width: LW, height: LH, valueFile: 'layer_slope.u8.gz',
    valueEncoding: { type: 'uint8', scale: 0.25, offset: 0, nodata: 255, unit: 'deg' },
    title: 'Surface slope from the global MOLA DEM', mission: 'Mars Global Surveyor', instrument: 'Mars Orbiter Laser Altimeter (MOLA), slope computed by this pipeline', kind: 'derived',
    provenance: 'computed', credit: 'Computed from NASA/GSFC MGS MOLA MEGDR; method: central differences on the 1/8 degree grid', sourceUrl: MEGDR_URL,
    note: 'Baseline ~14.8 km (2 pixels of ~7.4 km): this is regional slope, NOT lander-scale slope; it cannot see rocks, scarps under ~km width or crater rims. valueFile is gzip (suffix .gz). Display: viridis 0..20 deg.',
  });
  addSource({ ...outInfo('layer_slope.png'), source: 'computed from mola_2880.i16.gz', url: MEGDR_URL, processing: ['Central-difference gradient on the sphere (dx = R cos(lat) dlon, dy = R dlat), slope = atan(|grad|)', 'Box resample to 2048x1024', 'viridis colour ramp 0..20 deg, 256-colour palette PNG'] });
  addSource({ ...outInfo('layer_slope.u8.gz'), source: 'computed from mola_2880.i16.gz', url: MEGDR_URL, processing: ['Slope in degrees, 2048x1024, uint8 value = deg/0.25 (max 63.5 deg), nodata 255 (none), gzip -9'], stats: { maxSlopeDeg: round(maxSlope, 2) } });
}

async function layerThermalInertia() {
  log('[3b] thermal inertia: Putzig & Mellon TES night map');
  const buf = await download(TI_URL, 'pds/ti_full.img');
  const lbl = await download(TI_URL.replace('.img', '.lbl'), 'pds/global_ti_night_2007.lbl');
  if (buf.length !== 7200 * 3600 * 2 || !/MSB_INTEGER/.test(lbl.toString())) throw new Error('unexpected TI file');
  const f = new Float32Array(7200 * 3600);
  for (let i = 0; i < f.length; i++) {
    const v = buf.readInt16BE(i * 2);
    f[i] = v >= 5 && v <= 5000 ? v : NaN; // 5..5000 tiu is the derived range; 0 = not computed
  }
  const t = boxResample(f, 7200, 3600, LW, LH);
  const vi = new Int16Array(LW * LH);
  const px = Buffer.alloc(LW * LH * 4);
  const lo = Math.log10(25);
  const hi = Math.log10(1200);
  let nvalid = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== t[i]) {
      vi[i] = -32768;
      continue;
    }
    nvalid++;
    vi[i] = Math.round(t[i]);
    const [r, g, b] = ramp(INFERNO, clamp((Math.log10(t[i]) - lo) / (hi - lo), 0, 1));
    px.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  await rgbaPng('layer_thermal_inertia.png', px, LW, LH, { palette: true });
  writeOut('layer_thermal_inertia.i16.gz', zlib.gzipSync(Buffer.from(vi.buffer), { level: 9 }));
  layers.push({
    id: 'thermalInertia', file: 'layer_thermal_inertia.png', width: LW, height: LH, valueFile: 'layer_thermal_inertia.i16.gz',
    valueEncoding: { type: 'int16le', scale: 1, offset: 0, nodata: -32768, unit: 'J m^-2 K^-1 s^-1/2 (tiu)' },
    title: 'TES nighttime apparent thermal inertia (Putzig & Mellon 2007)', mission: 'Mars Global Surveyor', instrument: 'Thermal Emission Spectrometer (TES)', kind: 'thermal',
    provenance: 'observed', credit: 'N. E. Putzig & M. T. Mellon (2007), Icarus 191; PDS MGS-M-TES-5-TIMAP-V1.0 (NASA PDS Geosciences Node)', sourceUrl: TI_URL,
    note: 'Night map, 20 pixel/degree (~3 km), derived range 5..5000 tiu; transparent = not computed (poles beyond +/-87 deg, outside 5..5000). Apparent TI from a surface-temperature model, so higher = more rock/induration, lower = dust/sand. valueFile is gzip (suffix .gz). Display: inferno, log scale 25..1200.',
  });
  addSource({ ...outInfo('layer_thermal_inertia.png'), source: 'MGS TES night thermal inertia map, PDS', url: TI_URL, ...rawEntry('pds/ti_full.img'), processing: ['Big-endian int16 7200x3600, -180..180 E, 20 ppd; values outside 5..5000 treated as nodata', 'Area-weighted box resample (valid pixels only) to 2048x1024', 'inferno ramp, log10 25..1200 tiu; nodata transparent'], validPixelFraction: round(nvalid / t.length, 4) });
  addSource({ ...outInfo('layer_thermal_inertia.i16.gz'), source: 'same', url: TI_URL, ...rawEntry('pds/ti_full.img'), processing: ['Resampled values rounded to integer tiu, int16 LE, nodata -32768, gzip -9'] });
}

async function layerHydrogen() {
  log('[3c] hydrogen: Odyssey GRS H2O (water-equivalent hydrogen) map');
  const txt = (await download(H2O_URL, 'pds/h2o_sr_5x5.tab')).toString('utf8');
  await download(H2O_URL.replace('.tab', '.lbl'), 'pds/h2o_sr_5x5.lbl');
  const NC = 72;
  const NR = 36;
  const grid = new Float32Array(NC * NR).fill(NaN);
  let valid = 0;
  for (const line of txt.split('\n')) {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length < 5) continue;
    const [lat, lonE, c] = p;
    let lon = lonE;
    if (lon > 180) lon -= 360;
    const col = Math.floor((lon + 180) / 5);
    const row = Math.floor((90 - lat) / 5);
    if (c < 9000) {
      grid[row * NC + col] = c;
      valid++;
    }
  }
  const W = 720;
  const H = 360;
  const out = new Float32Array(W * H).fill(NaN);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = ((i + 0.5) / W) * NC - 0.5;
      const v = ((j + 0.5) / H) * NR - 0.5;
      const nc = clamp(Math.round(u), 0, NC - 1);
      const nr = clamp(Math.round(v), 0, NR - 1);
      if (grid[nr * NC + nc] !== grid[nr * NC + nc]) continue; // nearest bin has no data
      const c0 = Math.floor(u);
      const r0 = Math.floor(v);
      let acc = 0;
      let ws = 0;
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = 0; dc <= 1; dc++) {
          const cc = (((c0 + dc) % NC) + NC) % NC;
          const rr = clamp(r0 + dr, 0, NR - 1);
          const val = grid[rr * NC + cc];
          if (val !== val) continue;
          const w = (dc ? u - c0 : 1 - (u - c0)) * (dr ? v - r0 : 1 - (v - r0));
          acc += val * w;
          ws += w;
        }
      }
      if (ws > 0) out[j * W + i] = acc / ws;
    }
  }
  const vals = new Uint8Array(W * H);
  const px = Buffer.alloc(W * H * 4);
  let mx = 0;
  let mn = Infinity;
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== out[i]) {
      vals[i] = 255;
      continue;
    }
    mx = Math.max(mx, out[i]);
    mn = Math.min(mn, out[i]);
    vals[i] = clamp(Math.round(out[i] / 0.1), 0, 254);
    const [r, g, b] = ramp(YLGNBU, clamp(out[i] / 12, 0, 1));
    px.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  await rgbaPng('layer_hydrogen.png', px, W, H, { palette: true });
  writeOut('layer_hydrogen.u8.gz', zlib.gzipSync(Buffer.from(vals), { level: 9 }));
  layers.push({
    id: 'hydrogen', file: 'layer_hydrogen.png', width: W, height: H, valueFile: 'layer_hydrogen.u8.gz',
    valueEncoding: { type: 'uint8', scale: 0.1, offset: 0, nodata: 255, unit: 'wt% H2O (water-equivalent hydrogen)' },
    title: 'Odyssey GRS water-equivalent hydrogen (Boynton et al. 2007)', mission: '2001 Mars Odyssey', instrument: 'Gamma Ray Spectrometer (GRS)', kind: 'chemical',
    provenance: 'observed', credit: 'W. V. Boynton et al. (2007), JGR 112, E12S99; PDS ODY-M-GRS-5-ELEMENTS-V1.0 (NASA PDS Geosciences Node)', sourceUrl: H2O_URL,
    note: `Smoothed 5x5 degree bins (10 degree boxcar), ${valid} of 2592 bins have data; transparent = no data (high latitudes, where the GRS H signal needs a different model, are NOT covered). Resolution is ~300 km: it describes the regional upper ~1 m, never a site. Resampled bilinearly between valid bin centres for display. valueFile is gzip (suffix .gz). Display: YlGnBu 0..12 wt%.`,
  });
  addSource({ ...outInfo('layer_hydrogen.png'), source: 'ODY GRS element concentration map h2o_sr_5x5', url: H2O_URL, ...rawEntry('pds/h2o_sr_5x5.tab'), processing: ['Parsed 2592 ASCII rows (lat, lon E 0..360, wt% H2O, sigma); 9999.999 = no data', 'Re-indexed to lon -180..180 and 5 degree bins', 'Bilinear between valid bin centres onto a 720x360 grid; no-data bins stay transparent', 'YlGnBu ramp 0..12 wt%, palette PNG'], stats: { validBins: valid, minWtPct: round(mn, 2), maxWtPct: round(mx, 2) } });
  addSource({ ...outInfo('layer_hydrogen.u8.gz'), source: 'same', url: H2O_URL, ...rawEntry('pds/h2o_sr_5x5.tab'), processing: ['uint8 value = wt%/0.1 (max 25.4), nodata 255, 720x360, gzip -9'] });
}

async function layerDust() {
  log('[3d] dust: Trek TES Global Dust (colourised display only)');
  await download(TREK_STREAM + 'TES_Dust', 'TES_Dust.tif');
  const t = await fromFile(path.join(RAW, 'TES_Dust.tif'));
  const im = await t.getImage();
  const bb = im.getBoundingBox();
  if (im.getWidth() !== 2880 || im.getHeight() !== 1440 || bb[0] !== -180 || bb[2] !== 180 || bb[1] !== -90 || bb[3] !== 90) throw new Error('unexpected TES_Dust geometry');
  const ras = await im.readRasters({ interleave: true });
  const ch = im.getSamplesPerPixel();
  const rgba = Buffer.alloc(DW * DH * 4);
  for (let i = 0; i < DW * DH; i++) {
    const r = ras[i * ch];
    const g = ras[i * ch + 1];
    const b = ras[i * ch + 2];
    const empty = r === 0 && g === 0 && b === 0;
    rgba.set([r, g, b, empty ? 0 : 255], i * 4);
  }
  await sharp(rgba, { raw: { width: DW, height: DH, channels: 4 } }).resize(1024, 512, { kernel: 'cubic' }).png({ palette: true, quality: 85, effort: 10, colours: 128, dither: 0 }).toFile(path.join(OUT, 'layer_dust.png'));
  layers.push({
    id: 'dust', file: 'layer_dust.png', width: 1024, height: 512,
    title: 'TES Dust Cover Index (Ruff & Christensen 2002), colourised', mission: 'Mars Global Surveyor', instrument: 'Thermal Emission Spectrometer (TES)', kind: 'thermal',
    provenance: 'observed', credit: 'S. W. Ruff & P. R. Christensen (2002), JGR 107(E12), 5127; image via NASA/JPL Mars Trek "MGS TES, Global Dust"', sourceUrl: TREK + '/mars/#v=0.1&x=0&y=0&z=1&p=EQ&i=TES_Dust',
    note: 'DISPLAY ONLY, no valueFile: Mars Trek and ASU serve only the colourised image (blue = more dust-covered, red = less dust, scale not published with the file), the DCI numbers are not on PDS/Trek, so no value is invented for point queries. Spectral index applies to dust thick enough to mask TIR spectra, 3.5 km pixels, coverage about +/-60..70 deg (black = no data -> transparent).',
  });
  addSource({ ...outInfo('layer_dust.png'), source: 'Mars Trek TES_Dust (MGS TES Global Dust Cover Index, colourised GeoTIFF 2880x1440)', url: TREK_STREAM + 'TES_Dust', ...rawEntry('TES_Dust.tif'), processing: ['Read 8-bit RGB GeoTIFF (bbox -180,-90,180,90)', 'Pure black = no data -> alpha 0', 'Cubic resample to 1024x512 (keeps total size under 25 MB), 128-colour palette PNG', 'Values NOT recovered (colour scale unpublished)'] });
}

/* ------------------------------------------------------------------ 4. geology (USGS SIM 3292) */

const GEO_URL = 'https://pubs.usgs.gov/sim/3292/';
let GEO; // {units, polygons} with bbox
let GEO_ORDER = []; // symbols, index+1 = raster value

function epochOf(sym) {
  const m = /^([eml]?)([NHA])/.exec(sym);
  return m ? { sub: m[1], per: m[2] } : { sub: '', per: '?' };
}
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function unitColor(sym, i) {
  const { sub, per } = epochOf(sym);
  const base = { N: 22, H: 150, A: 235 }[per];
  if (base === undefined) return hsl(280, 25, 55); // e.g. impact / basin units without an age letter
  const light = { e: 36, m: 48, l: 62, '': 50 }[sub];
  const jitter = (((i * 37) % 11) - 5) * 3;
  return hsl(base + jitter, per === 'N' ? 58 : 48, light);
}
function dp(pts, tol) {
  // iterative Douglas-Peucker on [lon,lat]
  const n = pts.length;
  if (n <= 4) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0;
    let mi = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (L2 === 0) d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      else {
        const t = clamp(((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / L2, 0, 1);
        d = Math.hypot(pts[i][0] - (ax + t * dx), pts[i][1] - (ay + t * dy));
      }
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return Math.abs(a / 2);
}

async function prepareGeology() {
  log('[4] geology: USGS SIM 3292 (Tanaka et al. 2014) via Mars Trek stream of the USGS shapefile');
  await download(TREK_STREAM + 'SIM3292_Global_Geology', 'SIM3292_Global_Geology.zip');
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(RAW, 'SIM3292_Global_Geology.zip')));
  const shp = await zip.file('SIM3292_Global_Geology.shp').async('nodebuffer');
  const dbf = await zip.file('SIM3292_Global_Geology.dbf').async('nodebuffer');
  const src = await shapefile.open(shp, dbf);
  const raw = [];
  const unitInfo = {};
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    const p = r.value.properties;
    const g = r.value.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const rings of polys) raw.push({ unit: p.Unit, rings });
    unitInfo[p.Unit] ??= { desc: p.UnitDesc, n: 0 };
    unitInfo[p.Unit].n++;
  }
  GEO_ORDER = Object.keys(unitInfo).sort();
  const PER = { N: 'Noachian', H: 'Hesperian', A: 'Amazonian' };
  const SUB = { e: 'Early', m: 'Middle', l: 'Late', '': '' };
  const units = {};
  GEO_ORDER.forEach((sym, i) => {
    const { sub, per } = epochOf(sym);
    const age = PER[per] ? `${SUB[sub] ? SUB[sub] + ' ' : ''}${PER[per]}` : 'age per map legend';
    units[sym] = {
      name: unitInfo[sym].desc,
      description: `${unitInfo[sym].desc} (map unit "${sym}", ${age}). Geologic Map of Mars, USGS SIM 3292 (Tanaka et al. 2014), mapped at 1:20,000,000 with global THEMIS/MOLA/Viking/CTX-HiRISE context.`,
      color: unitColor(sym, i),
    };
  });
  // Simplified polygons for runtime lookup.
  const TOL = 0.03; // degrees (~1.8 km)
  const polygons = [];
  let verts = 0;
  for (const p of raw) {
    const rings = [];
    p.rings.forEach((ring, k) => {
      let r = dp(ring, TOL);
      if (k > 0 && ringArea(r) < 0.0005) return; // drop tiny holes (<~1.7 km2... after simplification)
      if (r.length < 4) {
        if (k === 0) r = ring.length >= 4 ? [ring[0], ring[Math.floor(ring.length / 3)], ring[Math.floor((2 * ring.length) / 3)], ring[0]] : ring;
        else return;
      }
      rings.push(r.map(([x, y]) => [round(x, 3), round(y, 3)]));
      verts += r.length;
    });
    const o = rings[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of o) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    polygons.push({ unit: p.unit, rings, bbox: [x0, y0, x1, y1] });
  }
  GEO = { units, polygons };
  const body = JSON.stringify({
    source: 'USGS Scientific Investigations Map 3292, Geologic Map of Mars (Tanaka et al., 2014)',
    sourceUrl: GEO_URL,
    note: 'Longitudes east-positive -180..180, planetocentric latitude. Polygons: rings[0] outer, rings[1..] holes; Douglas-Peucker tolerance 0.03 deg (~1.8 km), coordinates rounded to 0.001 deg. Colours assigned by this pipeline (hue = epoch Noachian orange / Hesperian green / Amazonian blue, lightness = early/middle/late), not USGS cartographic colours.',
    ...GEO,
  });
  const size = writeOut('geology_global.json', body);
  log(`  ${raw.length} polygons, ${verts} vertices after simplification, ${(size / 1e6).toFixed(2)} MB`);
  if (size > 6e6) throw new Error('geology_global.json exceeds 6 MB; raise TOL');

  // Index raster from the FULL-resolution polygons (even-odd scanline fill, pixel-centre sampling).
  const idx = new Uint8Array(LW * LH);
  const symIndex = Object.fromEntries(GEO_ORDER.map((s, i) => [s, i + 1]));
  for (const p of raw) {
    const v = symIndex[p.unit];
    const rows = new Map();
    for (const ring of p.rings) {
      for (let k = 0; k < ring.length - 1; k++) {
        const [xa, ya] = ring[k];
        const [xb, yb] = ring[k + 1];
        if (ya === yb) continue;
        const ja = (90 - ya) / (180 / LH) - 0.5;
        const jb = (90 - yb) / (180 / LH) - 0.5;
        const jlo = Math.ceil(Math.min(ja, jb));
        const jhi = Math.floor(Math.max(ja, jb));
        for (let j = Math.max(0, jlo); j <= Math.min(LH - 1, jhi); j++) {
          if (j === Math.max(ja, jb)) continue; // half-open
          const lat = 90 - (j + 0.5) * (180 / LH);
          const t = (lat - ya) / (yb - ya);
          const x = xa + t * (xb - xa);
          let arr = rows.get(j);
          if (!arr) rows.set(j, (arr = []));
          arr.push(x);
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] + 180) / (360 / LW) - 0.5));
        const i1 = Math.min(LW - 1, Math.floor((xs[k + 1] + 180) / (360 / LW) - 0.5));
        for (let i = i0; i <= i1; i++) idx[j * LW + i] = v;
      }
    }
  }
  const lut = [[0, 0, 0, 0]];
  for (const s of GEO_ORDER) {
    const c = units[s].color;
    lut.push([parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255]);
  }
  const px = Buffer.alloc(LW * LH * 4);
  let covered = 0;
  for (let i = 0; i < idx.length; i++) {
    px.set(lut[idx[i]], i * 4);
    if (idx[i]) covered++;
  }
  await rgbaPng('layer_geology.png', px, LW, LH, { palette: true });
  writeOut('layer_geology_idx.u8.gz', zlib.gzipSync(Buffer.from(idx), { level: 9 }));
  layers.push({
    id: 'geology', file: 'layer_geology.png', width: LW, height: LH, valueFile: 'layer_geology_idx.u8.gz',
    valueEncoding: { type: 'uint8', scale: 1, offset: 0, nodata: 0, unit: `unit index: value k = k-th unit symbol in sorted order of geology_global.json "units" (1-based): ${GEO_ORDER.join(',')}` },
    title: 'Geologic Map of Mars (USGS SIM 3292), unit raster', mission: 'Multiple (Viking, MGS, Mars Odyssey, MRO, Mars Express data used by the map)', instrument: 'Map compilation (THEMIS, MOLA, HRSC, CTX, HiRISE, Viking VIS); not an instrument product', kind: 'geologic',
    provenance: 'observed', credit: 'Tanaka, K. L., Skinner, J. A. Jr., Dohm, J. M., Irwin, R. P. III, Kolb, E. J., Fortezzo, C. M., Platz, T., Michael, G. G., Hare, T. M. (2014), USGS SIM 3292', sourceUrl: GEO_URL,
    note: 'Display raster rasterised at 2048x1024 (~0.18 deg) from the full-resolution polygons; for exact unit lookups use geology_global.json (simplified 0.03 deg). Colours are assigned by this pipeline (not USGS cartographic colours). Geologic units are interpretations at 1:20,000,000. valueFile is gzip (suffix .gz).',
  });
  addSource({ ...outInfo('geology_global.json'), source: 'USGS SIM 3292 shapefile SIM3292_Global_Geology (served by Mars Trek item SIM3292_Global_Geology; publication ' + GEO_URL + ')', url: TREK_STREAM + 'SIM3292_Global_Geology', ...rawEntry('SIM3292_Global_Geology.zip'), processing: ['Read shapefile (GCS_Mars_2000, lon -180..180 E already) with the Unit and UnitDesc attributes', `${raw.length} polygons, ${GEO_ORDER.length} units`, `Douglas-Peucker 0.03 deg per ring, tiny holes dropped, coords rounded to 0.001 deg, bbox per polygon`, 'Colours assigned by hue per epoch (no colours in the dbf)'], stats: { polygons: polygons.length, vertices: verts, units: GEO_ORDER.length } });
  addSource({ ...outInfo('layer_geology.png'), source: 'rasterised SIM 3292', url: GEO_URL, ...rawEntry('SIM3292_Global_Geology.zip'), processing: ['Even-odd scanline fill of the full-resolution polygons at 2048x1024, pixel-centre sampling', 'Palette PNG; unmapped pixels transparent'], stats: { coveredFraction: round(covered / idx.length, 4) } });
  addSource({ ...outInfo('layer_geology_idx.u8.gz'), source: 'rasterised SIM 3292', url: GEO_URL, processing: ['uint8 unit index, 0 = none, gzip -9'] });
}

function geologyAt(lon, lat) {
  const hits = [];
  for (const p of GEO.polygons) {
    const [x0, y0, x1, y1] = p.bbox;
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
    let inside = false;
    for (const ring of p.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) hits.push(p.unit);
  }
  return hits;
}

/* ------------------------------------------------------------------ 5. sites */

const MISSIONS = [
  { id: 'viking-1', name: 'Viking 1', bookmark: 'Viking 1_bookmark', date: '1976-07-20', page: 'https://science.nasa.gov/mission/viking-1/', summary: 'First successful Mars landing; Chryse Planitia. Returned the first surface images and the first in-situ biology experiments.' },
  { id: 'viking-2', name: 'Viking 2', bookmark: 'Viking 2_bookmark', date: '1976-09-03', page: 'https://science.nasa.gov/mission/viking-2/', summary: 'Utopia Planitia lander; imaged frost on the surface and operated for about 3.5 years.' },
  { id: 'pathfinder', name: 'Mars Pathfinder (Sojourner)', product: 'sojourner_hirise_mosaic', date: '1997-07-04', page: 'https://science.nasa.gov/mission/mars-pathfinder/', summary: 'Ares Vallis outflow plain; delivered Sojourner, the first rover on Mars.' },
  { id: 'spirit', name: 'Spirit (MER-A)', bookmark: 'Spirit Landing Site_bookmark', date: '2004-01-04', page: 'https://science.nasa.gov/mission/mer-spirit/', summary: 'Gusev crater rover; later climbed into the Columbia Hills.' },
  { id: 'opportunity', name: 'Opportunity (MER-B)', bookmark: 'Opportunity Landing Site_bookmark', date: '2004-01-25', page: 'https://science.nasa.gov/mission/mer-opportunity/', summary: 'Meridiani Planum rover; found sulfate-rich sediments formed in water.' },
  { id: 'phoenix', name: 'Phoenix', bookmark: 'Phoenix Landing Site_bookmark', date: '2008-05-25', page: 'https://science.nasa.gov/mission/phoenix/', summary: 'Arctic lander (Vastitas Borealis); dug into and confirmed shallow water ice.' },
  { id: 'curiosity', name: 'Curiosity (MSL)', bookmark: 'Curiosity Landing Site_bookmark', date: '2012-08-06', page: 'https://science.nasa.gov/mission/msl-curiosity/', summary: 'Gale crater rover exploring Aeolis Mons (Mount Sharp) layered sediments.' },
  { id: 'insight', name: 'InSight', bookmark: 'InSight Landing Site_bookmark', date: '2018-11-26', page: 'https://science.nasa.gov/mission/insight/', summary: 'Elysium Planitia lander with a seismometer and heat probe.' },
  { id: 'perseverance', name: 'Perseverance (Mars 2020)', fixed: [77.4509, 18.4446], date: '2021-02-18', page: 'https://science.nasa.gov/mission/mars-2020-perseverance/', summary: 'Jezero crater rover caching samples for return to Earth; touched down at Octavia E. Butler Landing.' },
];

const FEATURES = [
  'Olympus Mons', 'Ascraeus Mons', 'Pavonis Mons', 'Arsia Mons', 'Elysium Mons', 'Alba Mons', 'Hecates Tholus', 'Apollinaris Mons',
  'Hellas Planitia', 'Argyre Planitia', 'Isidis Planitia', 'Utopia Planitia', 'Chryse Planitia', 'Amazonis Planitia', 'Acidalia Planitia', 'Elysium Planitia', 'Arcadia Planitia', 'Vastitas Borealis',
  'Valles Marineris', 'Noctis Labyrinthus', 'Kasei Valles', 'Ares Vallis', 'Mawrth Vallis', 'Ma\'adim Vallis', 'Shalbatana Vallis', 'Dao Vallis',
  'Jezero', 'Gale', 'Gusev', 'Eberswalde', 'Holden', 'Hale', 'Lyot', 'Korolev', 'Schiaparelli', 'Huygens', 'Cassini', 'Copernicus', 'Henry', 'Galle', 'Tharsis Montes', 'Syrtis Major Planum', 'Terra Sirenum', 'Arabia Terra', 'Meridiani Planum',
];
const KIND_LABEL = (t) => t.split(',')[0].trim().toLowerCase();

async function prepareSites(catalog) {
  log('[5] sites');
  const docs = catalog.response.docs;
  const sites = [];
  for (const m of MISSIONS) {
    let lon;
    let lat;
    let how;
    if (m.fixed) {
      [lon, lat] = m.fixed;
      how = 'Perseverance landing coordinates 77.4509 E, 18.4446 N as specified for this project';
    } else {
      const d = m.bookmark ? docs.find((x) => x.productLabel === m.bookmark) : docs.find((x) => x.productLabel === m.product);
      const [x0, y0, x1, y1] = d.bbox.split(',').map(Number);
      lon = (x0 + x1) / 2;
      lat = (y0 + y1) / 2;
      how = `centre of the Mars Trek ${d.itemType === 'bookmark' ? 'landing-site bookmark' : 'product'} "${d.productLabel}" bbox (${d.bbox}); approximate site centre, accurate to the bookmark extent (~0.1-1 deg)`;
    }
    const status = await httpStatus(m.page);
    if (status !== 200) throw new Error(`mission page ${m.page} -> HTTP ${status}`);
    sites.push({ id: m.id, name: m.name, lon: round(lon, 4), lat: round(lat, 4), kind: 'landing', mission: m.name.split(' (')[0], date: m.date, summary: `${m.summary} Position: ${how}.`, sourceUrl: m.page });
  }
  // Gazetteer features
  const zip = await JSZip.loadAsync(await download(GAZ_URL, 'gazetteer_mars_pts.zip'));
  const src = await shapefile.open(await zip.file('MARS_nomenclature_center_pts.shp').async('nodebuffer'), await zip.file('MARS_nomenclature_center_pts.dbf').async('nodebuffer'));
  const all = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    all.push(r.value.properties);
  }
  const feats = [];
  for (const nm of FEATURES) {
    const cands = all.filter((p) => p.clean_name === nm || p.name === nm);
    if (!cands.length) throw new Error('feature not in gazetteer: ' + nm);
    const p = cands.sort((a, b) => b.diameter - a.diameter)[0];
    let lon = p.center_lon;
    if (lon > 180) lon -= 360;
    const status = await httpStatus(p.link.replace('http://', 'https://'));
    feats.push({ p, lon, status });
    sites.push({
      id: 'feature-' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name: nm, lon: round(lon, 4), lat: round(p.center_lat, 4), kind: 'feature',
      summary: `IAU-approved ${KIND_LABEL(p.type)}, ${p.diameter >= 100 ? Math.round(p.diameter) : round(p.diameter, 1)} km across. Quadrangle: ${p.quad_name} (${p.quad_code}). Centre coordinates from the USGS Gazetteer of Planetary Nomenclature.`,
      sourceUrl: p.link.replace('http://', 'https://'),
    });
  }
  const bad = feats.filter((f) => f.status !== 200);
  if (bad.length) log('  WARNING gazetteer pages not HTTP 200:', bad.map((b) => b.p.name + ' ' + b.status).join(', '));
  writeOut('sites.json', JSON.stringify(sites, null, 1));
  addSource({ ...outInfo('sites.json'), source: 'Mars Trek landing-site bookmarks (searchItems) + NASA mission pages; USGS Gazetteer of Planetary Nomenclature (MARS_nomenclature_center_pts)', url: GAZ_URL, catalogUrl: TREK_CATALOG, ...rawEntry('gazetteer_mars_pts.zip'), processing: ['Landing coordinates: bbox centre of the Trek bookmark (Pathfinder: Trek product sojourner_hirise_mosaic bbox; Perseverance: given coordinates)', 'Mission pages checked HTTP 200 during this run', `${FEATURES.length} IAU features picked by name from the gazetteer, lon converted 0..360 E -> -180..180 E, each linked to its planetarynames page (HTTP status checked)`], gazetteerNon200: bad.map((b) => b.p.name) });
  return sites;
}

/* ------------------------------------------------------------------ main + manifest + validation */

async function main() {
  // Remove only the files this script generates. Hand-curated files in OUT (landing_criteria.json,
  // edl_mars2020.json) are owned elsewhere and must survive a re-run.
  const KEEP = new Set(['landing_criteria.json', 'edl_mars2020.json']);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (!KEEP.has(f)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
  const catBuf = await download(TREK_CATALOG, 'catalog.json');
  const catalog = JSON.parse(catBuf.toString('utf8'));
  await prepareTexture();
  const demStats = await prepareDem();
  await layerElevationSlope();
  await prepareGeology();
  await layerHydrogen();
  await layerThermalInertia();
  await layerDust();
  const sites = await prepareSites(catalog);

  const order = ['elevation', 'geology', 'hydrogen', 'thermalInertia', 'dust', 'slope'];
  layers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const manifest = {
    texture: {
      file: 'mars_8k.jpg', width: 8192, height: 4096,
      lowResFile: 'mars_2k.jpg', lowResWidth: 2048, lowResHeight: 1024,
      title: 'Viking MDIM 2.1 colorized global mosaic (232 m/px)',
      credit: 'NASA/JPL-Caltech/USGS Astrogeology Science Center (Viking Orbiter, MDIM 2.1), served by NASA JPL Mars Trek WMTS',
      sourceUrl: MDIM_CAPS,
    },
    dem: {
      file: 'mola_2880.i16.gz', width: DW, height: DH,
      encoding: { type: 'int16le', scale: 1, offset: 0, nodata: -32768 },
      resKm: 7.4,
      title: 'MGS MOLA MEGDR topography, 16 ppd binned to 1/8 degree (heights above the MOLA areoid; file is gzip, 2880x1440 Int16 LE, height = value*scale + offset)',
      credit: 'NASA/GSFC MGS MOLA Science Team (Smith et al.); PDS MGS-M-MOLA-5-MEGDR-L3-V1.0, megt90n000eb',
      sourceUrl: MEGDR_URL,
    },
    layers,
    geology: { file: 'geology_global.json', title: 'Geologic Map of Mars (SIM 3292)', authors: 'Tanaka, K.L., Skinner, J.A. Jr., Dohm, J.M., Irwin, R.P. III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., Hare, T.M.', year: 2014, url: GEO_URL, scale: '1:20,000,000' },
    sites: { file: 'sites.json' },
  };
  writeOut('manifest.json', JSON.stringify(manifest, null, 1));

  // ---- validation
  const checks = {};
  const [pLon, pLat] = [77.4509, 18.4446];
  const pers = demAt(pLon, pLat);
  const px = DEM[Math.floor((90 - pLat) / 0.125) * DW + Math.floor((pLon + 180) / 0.125)];
  checks.a_perseverance_dem = { sampleBilinearM: round(pers, 1), sampleNearestPixelM: px, ctx20mReferenceM: -2567, differenceBilinearM: round(pers + 2567, 1), withinTolerance100m: Math.abs(pers + 2567) <= 100, note: 'Global DEM is ~7.4 km/pixel, so one pixel averages crater floor, rim and the surrounding plain; a difference well above 100 m is expected resolution loss, not an error.' };
  const regionStat = (lon0, lon1, lat0, lat1, fn) => {
    let best = fn === 'max' ? -Infinity : Infinity;
    let at = null;
    for (let j = 0; j < DH; j++) {
      const lat = 90 - (j + 0.5) * 0.125;
      if (lat < lat0 || lat > lat1) continue;
      for (let i = 0; i < DW; i++) {
        const lon = -180 + (i + 0.5) * 0.125;
        if (lon < lon0 || lon > lon1) continue;
        const v = DEM[j * DW + i];
        if (fn === 'max' ? v > best : v < best) { best = v; at = [lon, lat]; }
      }
    }
    return { valueM: best, at };
  };
  checks.b_olympus_max = { ...regionStat(-140, -125, 14, 24, 'max'), expectedApproxM: 21200, region: 'lon -140..-125, lat 14..24' };
  checks.b_hellas_min = { ...regionStat(50, 90, -55, -28, 'min'), expectedApproxM: -8000, region: 'lon 50..90, lat -55..-28 (Hellas basin)' };
  checks.b_global_extremes = demStats;
  const geoJez = geologyAt(pLon, pLat);
  const geoCrater = geologyAt(77.69, 18.41);
  const idxBuf = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'layer_geology_idx.u8.gz')));
  const jj = Math.floor((90 - pLat) / (180 / LH));
  const ii = Math.floor((pLon + 180) / (360 / LW));
  const rasterSym = idxBuf[jj * LW + ii] ? GEO_ORDER[idxBuf[jj * LW + ii] - 1] : null;
  checks.c_geology_jezero = { atPerseverance: geoJez.map((s) => ({ symbol: s, ...GEO.units[s] })), atJezeroCraterCentre: geoCrater, rasterSymbolAtPerseverance: rasterSym, plausible: geoJez.length === 1 && geoJez[0] === rasterSym };
  // d. consistency
  const consistency = [];
  let total = 0;
  for (const f of fs.readdirSync(OUT)) total += fs.statSync(path.join(OUT, f)).size;
  for (const L of layers) {
    const meta = await sharp(path.join(OUT, L.file)).metadata();
    const okImg = meta.width === L.width && meta.height === L.height;
    let okVal = null;
    if (L.valueFile) {
      const vb = zlib.gunzipSync(fs.readFileSync(path.join(OUT, L.valueFile)));
      okVal = vb.length === L.width * L.height * (L.valueEncoding.type === 'int16le' ? 2 : 1);
    }
    consistency.push({ id: L.id, file: L.file, declared: [L.width, L.height], actual: [meta.width, meta.height], displayOk: okImg, valueFileBytesOk: okVal, aspect2to1: L.width === 2 * L.height });
  }
  const demBytes = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'mola_2880.i16.gz'))).length;
  const tex = await sharp(path.join(OUT, 'mars_8k.jpg')).metadata();
  const tex2 = await sharp(path.join(OUT, 'mars_2k.jpg')).metadata();
  checks.d_consistency = {
    layers: consistency,
    demBytesOk: demBytes === DW * DH * 2,
    texture8k: [tex.width, tex.height], texture2k: [tex2.width, tex2.height],
    allEquirect2to1: [DW / DH, tex.width / tex.height, tex2.width / tex2.height, ...consistency.map((c) => c.declared[0] / c.declared[1])].every((r) => r === 2),
    totalBytes: total, totalMB: round(total / 1e6, 2), under25MB: total <= 25e6,
  };
  fs.writeFileSync(path.join(DATA, 'global_validation.json'), JSON.stringify({ generatedOn: new Date().toISOString(), checks }, null, 2));
  fs.writeFileSync(path.join(DATA, 'global_manifest_sources.json'), JSON.stringify({ generatedOn: new Date().toISOString(), generator: 'scripts/prepare-global.mjs', sources, rawDownloads: rawMeta }, null, 2));
  log('\nVALIDATION'); log(JSON.stringify(checks, null, 2));
  log('\nFILES');
  for (const f of fs.readdirSync(OUT).sort()) log(String(fs.statSync(path.join(OUT, f)).size).padStart(10), f);
  log(String(total).padStart(10), 'TOTAL');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
