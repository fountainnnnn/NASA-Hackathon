#!/usr/bin/env node
/**
 * Native-resolution CTX detail tiles for close-range views of the Jezero scene (run: node scripts/prepare-ctx-tiles.mjs).
 *
 * Input: data/raw/ortho.tif (JEZ_ctx_B_soc_008_orthoMosaic_6m, JPL Mars Trek) and data/raw/dem.tif, both downloaded by
 * prepare-data.mjs. The ortho is cropped to the DEM's outer edges exactly as ctx.jpg is, then cut into overlapping
 * 2048 px tiles at the mosaic's own 6 m posting (no resampling, so no detail is invented or lost). ctx.jpg stays the base
 * layer (4096 px, about 7.8 m per pixel); the scene swaps the nearest tile in when the camera is close to the ground.
 * Output: public/data/ctx_tiles/r{row}c{col}.jpg and index.json (tile rectangles in the base texture's UV space,
 * v = 0 at the north edge, matching lib/scene/textures.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fromFile } from 'geotiff';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RAW = path.join(ROOT, 'data/raw');
const OUT = path.join(ROOT, 'public/data/ctx_tiles');
const TILE = 2048, STRIDE = 1600;

const dem = await (await fromFile(path.join(RAW, 'dem.tif'))).getImage();
const [dx0, dy0] = dem.getOrigin();
const dres = Math.abs(dem.getResolution()[0]);
const DW = dem.getWidth(), DH = dem.getHeight();

const img = await (await fromFile(path.join(RAW, 'ortho.tif'))).getImage();
const [ox, oy] = img.getOrigin();
const res = Math.abs(img.getResolution()[0]);
const c0 = Math.round((dx0 - ox) / res), c1 = Math.round((dx0 + DW * dres - ox) / res);
const r0 = Math.round((oy - dy0) / res), r1 = Math.round((oy - (dy0 - DH * dres)) / res);
const W = c1 - c0, H = r1 - r0;
console.log(`ortho ${img.getWidth()}x${img.getHeight()} at ${res.toFixed(3)} m; crop ${W}x${H} (cols ${c0}..${c1}, rows ${r0}..${r1})`);
const win = (await img.readRasters({ window: [c0, r0, c1, r1], interleave: false }))[0];
const buf = Buffer.from(win.buffer, win.byteOffset, win.byteLength);

const starts = (n) => { const s = []; for (let p = 0; ; p += STRIDE) { if (p + TILE >= n) { s.push(Math.max(0, n - TILE)); break; } s.push(p); } return [...new Set(s)]; };
fs.mkdirSync(OUT, { recursive: true });
const tiles = [];
for (const [ri, y] of starts(H).entries()) for (const [ci, x] of starts(W).entries()) {
  const w = Math.min(TILE, W - x), h = Math.min(TILE, H - y);
  const file = `r${ri}c${ci}.jpg`;
  await sharp(buf, { raw: { width: W, height: H, channels: 1 } }).extract({ left: x, top: y, width: w, height: h })
    .jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(OUT, file));
  tiles.push({ file, px: [x, y, w, h], uv: [x / W, y / H, w / W, h / H] });
  console.log(`  ${file} ${w}x${h} ${(fs.statSync(path.join(OUT, file)).size / 1e6).toFixed(2)} MB`);
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  source: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0 (NASA/JPL/MSSS/USGS, MRO CTX via JPL Mars Trek)',
  note: 'Native posting crops of the same mosaic as ctx.jpg; uv = [u0, v0, du, dv] in the base texture, v = 0 north edge.',
  metresPerPixel: res, width: W, height: H, tile: TILE, tiles,
}, null, 1));
console.log(`${tiles.length} tiles -> ${path.relative(ROOT, OUT)}`);
