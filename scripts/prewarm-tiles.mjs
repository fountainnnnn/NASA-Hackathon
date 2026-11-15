#!/usr/bin/env node
/**
 * Warm the CTX tile proxy (and the edge CDN in front of it) for the Jezero region: every CTX tile within ±1 degree of the
 * crater centre at levels 8 to 12 (about 2,900 tiles), requested through the app's own /api/tiles/ctx route.
 *
 *   node scripts/prewarm-tiles.mjs https://heymars.up.railway.app
 *   PREWARM_LEVELS=8-11 PREWARM_SPAN=0.5 PREWARM_CONCURRENCY=8 node scripts/prewarm-tiles.mjs http://localhost:5200
 *
 * Run it after each deploy, from the region the users are in (the edge cache is per point of presence). Cold upstream
 * tiles take 2 to 22 s each, so a full run takes a while; it is safe to stop and rerun (warm tiles come back in ms).
 */
const base = (process.argv[2] ?? process.env.PREWARM_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const [lo, hi] = (process.env.PREWARM_LEVELS ?? '8-12').split('-').map(Number);
const span = Number(process.env.PREWARM_SPAN ?? 1);
const conc = Number(process.env.PREWARM_CONCURRENCY ?? 8);
const LON = 77.43, LAT = 18.47;   // Jezero crater centre

const tiles = [];
for (let z = lo; z <= (hi ?? lo); z++) {
  const n = 2 ** z, deg = 180 / n;
  const x0 = Math.floor((LON - span + 180) / deg), x1 = Math.floor((LON + span + 180) / deg);
  const y0 = Math.floor((90 - (LAT + span)) / deg), y1 = Math.floor((90 - (LAT - span)) / deg);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push(`${base}/api/tiles/ctx/${z}/${y}/${x}`);
}

const t0 = Date.now();
const counts = { ok: 0, hit: 0, empty: 0, truncated: 0, error: 0 };
let i = 0, done = 0;
async function worker() {
  while (i < tiles.length) {
    const url = tiles[i++];
    try {
      const r = await fetch(url);
      await r.arrayBuffer();
      const s = r.headers.get('x-tile-status') ?? (r.ok ? 'ok' : 'error');
      counts[s in counts ? s : 'error']++;
      if (r.headers.get('x-tile-cache') === 'hit') counts.hit++;
    } catch { counts.error++; }
    if (++done % 100 === 0 || done === tiles.length) {
      console.log(`${done}/${tiles.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s  ${JSON.stringify(counts)}`);
    }
  }
}
console.log(`prewarming ${tiles.length} CTX tiles (levels ${lo}-${hi ?? lo}, ±${span}° of Jezero) at ${base}, ${conc} at a time`);
await Promise.all(Array.from({ length: conc }, worker));
