#!/usr/bin/env node
// Pre-fetch normalised Perseverance raw-image JSON for ~25 sols along the traverse.
// Output: public/data/rover_cache/<sol>.json = { sol, images: RoverImage[] } (<= 12 images, camera mix).
// Source: https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N
// Normalisation mirrors src/lib/science/rover.ts (kept in sync by hand; .mjs cannot import the TS module).
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/rover_cache');
const WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json';
const API = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=';
// Sols of the curated sites (see public/data/science_sites.json coordinateSource).
const SITE_SOLS = [13, 278, 502, 652, 1210, 1478];
const TARGET = 25, MAX_IMAGES = 12;

const FULL = {
  MCZ_LEFT: 'Mastcam-Z Left', MCZ_RIGHT: 'Mastcam-Z Right',
  NAVCAM_LEFT: 'Navigation Camera Left', NAVCAM_RIGHT: 'Navigation Camera Right',
  FRONT_HAZCAM_LEFT_A: 'Front Hazard Camera Left', FRONT_HAZCAM_RIGHT_A: 'Front Hazard Camera Right',
  FRONT_HAZCAM_LEFT_B: 'Front Hazard Camera Left (B)', FRONT_HAZCAM_RIGHT_B: 'Front Hazard Camera Right (B)',
  REAR_HAZCAM_LEFT: 'Rear Hazard Camera Left', REAR_HAZCAM_RIGHT: 'Rear Hazard Camera Right',
};
// Navcam first: wide landscape frames at eye height (mirrors cameraRank in src/lib/science/rover.ts)
const rank = (c) => (c.startsWith('NAVCAM_') ? 0 : c.startsWith('MCZ_') ? 1 : c.startsWith('FRONT_HAZCAM_') ? 2 : c.startsWith('REAR_HAZCAM_') ? 3 : 99);
const num = (v) => { const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : undefined; };
/** viewScore in rover.ts: camera class, then how far the mast points from the horizon (Navcam -25° to 20°, Mastcam-Z -8° to 12°). */
const BAND = { 0: [-25, 20], 1: [-8, 12] };
const score = (i) => {
  const r = rank(i.camera), b = BAND[r];
  let s = r * 100;
  if (b && i.mastElDeg != null) { if (i.mastElDeg < b[0] || i.mastElDeg > b[1]) s += 250; s += Math.abs(i.mastElDeg + 5); }
  return s;
};

function normalise(raw, sol) {
  const out = [];
  for (const r of raw) {
    const camera = r.camera?.instrument ?? '';
    if (rank(camera) >= 99) continue;
    const st = (r.sample_type ?? 'Full').toLowerCase();
    if (st === 'thumbnail' || st === 'subframe') continue;
    const m = r.extended?.dimension?.match(/\((\d+),\s*(\d+)\)/);
    if (m && (Number(m[1]) < 400 || Number(m[2]) < 400)) continue; // subframe crop
    const url = r.image_files?.medium ?? r.image_files?.large;
    if (!url || !r.imageid || !/^https:\/\/mars\.nasa\.gov\//.test(url)) continue;
    const sclk = num(r.extended?.sclk), mastElDeg = num(r.extended?.mastEl), mastAzDeg = num(r.extended?.mastAz);
    out.push({
      id: r.imageid, sol: r.sol ?? sol, earthDate: (r.date_taken_utc ?? '').slice(0, 10),
      camera, cameraFull: FULL[camera] ?? camera, url, pageUrl: r.link,
      credit: camera.startsWith('MCZ_') ? 'NASA/JPL-Caltech/ASU' : 'NASA/JPL-Caltech',
      ...(sclk != null ? { sclk } : {}), ...(mastElDeg != null ? { mastElDeg } : {}), ...(mastAzDeg != null ? { mastAzDeg } : {}),
    });
  }
  return out;
}

/**
 * Up to 12 distinct looks, best view first (score above): a frame within 60 s of one already kept is the same look (a
 * stereo partner or the next mosaic tile) and is skipped, so the app can choose between genuinely different frames.
 */
function pick(images) {
  const picked = [];
  for (const im of [...images].sort((a, b) => score(a) - score(b))) {
    if (picked.length >= MAX_IMAGES) break;
    if (im.sclk != null && picked.some((p) => p.sclk != null && Math.abs(p.sclk - im.sclk) < 60)) continue;
    picked.push(im);
  }
  return picked;
}

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.json();
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw new Error(`failed: ${url}`);
}

const wp = await getJson(WAYPOINTS);
const allSols = [...new Set(wp.features.map((f) => f.properties.sol))].sort((a, b) => a - b);
const chosen = new Set(SITE_SOLS.map((s) => allSols.reduce((b, x) => (Math.abs(x - s) < Math.abs(b - s) ? x : b))));
const even = TARGET - chosen.size;
for (let i = 0; i < even; i++) chosen.add(allSols[Math.round((i * (allSols.length - 1)) / Math.max(1, even - 1))]);

await mkdir(OUT, { recursive: true });
const index = [];
for (const sol of [...chosen].sort((a, b) => a - b)) {
  try {
    const body = await getJson(API + sol);
    const images = pick(normalise(body.images ?? [], sol));
    if (!images.length) { console.log(`sol ${sol}: no usable images, skipped`); continue; }
    await writeFile(join(OUT, `${sol}.json`), JSON.stringify({ sol, images }) + '\n');
    index.push(sol);
    console.log(`sol ${sol}: ${images.length} images`);
  } catch (e) { console.log(`sol ${sol}: ${e.message}`); }
}
// the app reads this list to pick the nearest cached sol without probing for files that are not there
await writeFile(join(OUT, 'index.json'), JSON.stringify({ source: 'NASA Mars 2020 raw images API, normalised by scripts/fetch-rover-cache.mjs', sols: index }) + '\n');
console.log(`wrote ${index.length} files and index.json to ${OUT}`);
