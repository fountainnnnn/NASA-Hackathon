#!/usr/bin/env node
/**
 * HiRISE orthoimage patch around the Jezero base for walking-scale views (run: node scripts/prepare-hirise.mjs).
 *
 * Source: "MRO HiRISE, Jezero Mosaic, Controlled" (JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd), the
 * USGS/HiRISE orthomosaic that was the Mars 2020 Terrain-Relative Navigation basemap, served by JPL Mars Trek as a
 * geographic (EPSG 104905, equirectangular in degrees) WMTS pyramid. The full product is about 9.8 GB, so this script reads
 * only Trek's WMTS level 15 (180/2^15/256 degrees per pixel, 1.27 m north-south and 1.21 m east-west at 18.4°N) over a
 * window that covers the base and the western delta. No resampling: the tiles are stitched at their own posting and cropped
 * on pixel boundaries, so the lon/lat edges below are exact.
 *
 * Radiometry: HiRISE red-filter DN and the CTX mosaic differ in gain and offset. A single linear map (mean and standard
 * deviation of the HiRISE window, block-averaged to the CTX 6 m posting, matched to the same window of the CTX mosaic) is
 * applied so the patch does not change brightness where it fades into CTX. No local filtering, no synthetic detail.
 *
 * Output: public/data/hirise/jezero_base.jpg (greyscale), mask.png (1 = HiRISE data, 1/8 resolution, eroded so the
 * feather never reaches nodata) and meta.json (lon/lat outer edges, posting, provenance). Tiles are cached in
 * data/raw/hirise_tiles/. Appends an entry to data/source_manifest.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd';
const TILE_URL = (z, r, c) => `https://trek.nasa.gov/tiles/Mars/EQ/${LABEL}/1.0.0/default/default028mm/${z}/${r}/${c}.png`;
const RAW = path.join(ROOT, 'data/raw/hirise_tiles');
const OUT = path.join(ROOT, 'public/data/hirise');
const R = 3_396_190, RAD = Math.PI / 180;
const Z = 15, TS = 256;
const PX = 180 / 2 ** Z / TS; // degrees per pixel
// window: base (77.4509E 18.4446N) and the western delta target (77.3867E 18.4341N), about 1.3 km margin east and west
const LON_C = 77.4188, LAT_C = 18.4410, W = 5120, H = 4096;
const MASK_DIV = 8;

const px0 = Math.round((LON_C + 180) / PX - W / 2), py0 = Math.round((90 - LAT_C) / PX - H / 2);
const lonMin = -180 + px0 * PX, lonMax = lonMin + W * PX, latMax = 90 - py0 * PX, latMin = latMax - H * PX;
const tc0 = Math.floor(px0 / TS), tc1 = Math.floor((px0 + W - 1) / TS), tr0 = Math.floor(py0 / TS), tr1 = Math.floor((py0 + H - 1) / TS);
console.log(`window ${W}x${H} px, lon ${lonMin.toFixed(6)}..${lonMax.toFixed(6)}, lat ${latMin.toFixed(6)}..${latMax.toFixed(6)}; tiles ${(tc1 - tc0 + 1) * (tr1 - tr0 + 1)}`);

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function getTile(r, c) {
  const f = path.join(RAW, `${Z}_${r}_${c}.png`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(TILE_URL(Z, r, c));
      if (res.status === 404) { fs.writeFileSync(f, Buffer.alloc(0)); return Buffer.alloc(0); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(f, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1)));
    }
  }
}

// stitch: grey + alpha into the window buffers
const grey = new Uint8Array(W * H), alpha = new Uint8Array(W * H);
const jobs = [];
for (let r = tr0; r <= tr1; r++) for (let c = tc0; c <= tc1; c++) jobs.push([r, c]);
let done = 0;
async function worker() {
  for (;;) {
    const j = jobs.pop();
    if (!j) return;
    const [r, c] = j;
    const buf = await getTile(r, c);
    done++;
    if (done % 40 === 0) console.log(`  ${done}/${(tc1 - tc0 + 1) * (tr1 - tr0 + 1)} tiles`);
    if (!buf.length) continue;
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    for (let y = 0; y < TS; y++) {
      const gy = r * TS + y - py0;
      if (gy < 0 || gy >= H) continue;
      for (let x = 0; x < TS; x++) {
        const gx = c * TS + x - px0;
        if (gx < 0 || gx >= W) continue;
        const s = (y * TS + x) * ch, d = gy * W + gx;
        grey[d] = data[s]; alpha[d] = data[s + ch - 1];
      }
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

// CTX reference over the same window, for the linear radiometric match
const ortho = await (await fromFile(path.join(ROOT, 'data/raw/ortho.tif'))).getImage();
const [ox, oy] = ortho.getOrigin();
const ores = Math.abs(ortho.getResolution()[0]);
const cx0 = Math.round((lonMin * RAD * R - ox) / ores), cx1 = Math.round((lonMax * RAD * R - ox) / ores);
const cy0 = Math.round((oy - latMax * RAD * R) / ores), cy1 = Math.round((oy - latMin * RAD * R) / ores);
const ctx = (await ortho.readRasters({ window: [cx0, cy0, cx1, cy1], interleave: false }))[0];
const CW = cx1 - cx0, CH = cy1 - cy0;
let hs = 0, hs2 = 0, cs = 0, cs2 = 0, n = 0;
for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
  const gx0 = Math.floor((i / CW) * W), gx1 = Math.floor(((i + 1) / CW) * W), gy0 = Math.floor((j / CH) * H), gy1 = Math.floor(((j + 1) / CH) * H);
  let a = 0, m = 0, ok = true;
  for (let y = gy0; y < gy1 && ok; y++) for (let x = gx0; x < gx1; x++) { const k = y * W + x; if (alpha[k] < 250) { ok = false; break; } a += grey[k]; m++; }
  const cv = ctx[j * CW + i];
  if (!ok || !m || !(cv > 0)) continue;
  const h = a / m;
  hs += h; hs2 += h * h; cs += cv; cs2 += cv * cv; n++;
}
const hm = hs / n, hsd = Math.sqrt(hs2 / n - hm * hm), cm = cs / n, csd = Math.sqrt(cs2 / n - cm * cm);
const gain = csd / hsd, offset = cm - gain * hm;
console.log(`radiometric match over ${n} CTX cells: HiRISE mean ${hm.toFixed(1)} sd ${hsd.toFixed(1)}, CTX mean ${cm.toFixed(1)} sd ${csd.toFixed(1)} -> v' = ${gain.toFixed(4)} v + ${offset.toFixed(2)}`);

let valid = 0;
const outGrey = Buffer.alloc(W * H);
for (let k = 0; k < W * H; k++) {
  if (alpha[k] >= 128) { valid++; outGrey[k] = Math.max(0, Math.min(255, Math.round(gain * grey[k] + offset))); } else outGrey[k] = Math.round(cm);
}
// mask at 1/MASK_DIV resolution: a cell is 1 only when every pixel in it and in its 8 neighbours is data (eroded by one cell)
const MW = W / MASK_DIV, MH = H / MASK_DIV;
const cell = new Uint8Array(MW * MH);
for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
  let ok = 1;
  for (let y = j * MASK_DIV; y < (j + 1) * MASK_DIV && ok; y++) for (let x = i * MASK_DIV; x < (i + 1) * MASK_DIV; x++) if (alpha[y * W + x] < 128) { ok = 0; break; }
  cell[j * MW + i] = ok;
}
const mask = Buffer.alloc(MW * MH);
for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
  let ok = 255;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const jj = j + dj, ii = i + di;
    if (jj < 0 || ii < 0 || jj >= MH || ii >= MW || !cell[jj * MW + ii]) ok = 0;
  }
  mask[j * MW + i] = ok;
}

const imgFile = path.join(OUT, 'jezero_base.jpg'), maskFile = path.join(OUT, 'mask.png');
await sharp(outGrey, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 82, mozjpeg: true }).toFile(imgFile);
await sharp(mask, { raw: { width: MW, height: MH, channels: 1 } }).png({ compressionLevel: 9 }).toFile(maskFile);
const mPerPxNS = PX * RAD * R, mPerPxEW = mPerPxNS * Math.cos(LAT_C * RAD);
const meta = {
  productLabel: LABEL,
  title: 'MRO HiRISE, Jezero Mosaic, Controlled',
  credit: 'NASA/JPL-Caltech/University of Arizona/USGS (MRO HiRISE via JPL Mars Trek)',
  source: `${TILE_URL(Z, '{row}', '{col}')} (WMTS level ${Z}, EPSG 104905)`,
  file: 'jezero_base.jpg', mask: 'mask.png', maskDiv: MASK_DIV,
  width: W, height: H, lonMin, lonMax, latMin, latMax,
  metresPerPixel: { northSouth: +mPerPxNS.toFixed(3), eastWest: +mPerPxEW.toFixed(3) },
  validFraction: +(valid / (W * H)).toFixed(4),
  radiometry: { gain: +gain.toFixed(5), offset: +offset.toFixed(3), note: 'linear map matching mean and standard deviation to the CTX 6 m mosaic over this window' },
  note: 'Native WMTS level-15 posting of the 25 cm controlled mosaic, stitched and cropped on pixel boundaries. uv linear in lon/lat, v = 0 at the north edge.',
};
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
console.log(`wrote ${path.relative(ROOT, imgFile)} ${(fs.statSync(imgFile).size / 1e6).toFixed(2)} MB, mask ${MW}x${MH}, valid ${(100 * valid / (W * H)).toFixed(1)} %`);

// provenance: append (or replace) the entry in data/source_manifest.json
const manPath = path.join(ROOT, 'data/source_manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
man.files['public/data/hirise/jezero_base.jpg'] = {
  output: 'public/data/hirise/jezero_base.jpg',
  outputBytes: fs.statSync(imgFile).size,
  outputSha256: sha(imgFile),
  licence: man.licence,
  sourceUrls: [TILE_URL(Z, '{row}', '{col}'), `https://trek.nasa.gov/tiles/Mars/EQ/${LABEL}/1.0.0/WMTSCapabilities.xml`],
  productLabel: LABEL,
  mission: 'Mars Reconnaissance Orbiter',
  instrument: 'High Resolution Imaging Science Experiment (HiRISE), controlled orthomosaic (Mars 2020 TRN basemap)',
  projection: 'Geographic (EPSG 104905, equirectangular in degrees), Mars 2000 sphere R=3396190 m',
  credit: meta.credit,
  generatedBy: 'scripts/prepare-hirise.mjs',
  generatedOn: new Date().toISOString(),
  resolution: `${mPerPxNS.toFixed(2)} m/px N-S, ${mPerPxEW.toFixed(2)} m/px E-W (WMTS level ${Z} of the 25 cm mosaic)`,
  extent: { lonMin, lonMax, latMin, latMax },
  processing: [
    `Fetched ${(tc1 - tc0 + 1) * (tr1 - tr0 + 1)} WMTS tiles (level ${Z}, rows ${tr0}..${tr1}, cols ${tc0}..${tc1}); cached in data/raw/hirise_tiles/.`,
    `Stitched and cropped to ${W}x${H} px on pixel boundaries (no resampling).`,
    `Linear radiometric match to the CTX 6 m mosaic over the same window: v' = ${gain.toFixed(4)} v + ${offset.toFixed(2)}.`,
    `Nodata (alpha < 128) filled with the CTX mean and masked out in mask.png (1/${MASK_DIV} resolution, eroded by one cell).`,
  ],
};
fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n');
console.log('manifest updated');
