#!/usr/bin/env node
// Earth link data from NASA JPL Horizons (https://ssd.jpl.nasa.gov/api/horizons.api, format=json).
// Output: public/data/earth_link.json (+ one entry appended to data/source_manifest.json).
//   A) one-way light time Earth -> Mars, 1 d steps 2026-01-01..2040-12-31 (observer = Mars centre 500@499, QUANTITIES 20,21).
//   B) Earth azimuth/elevation as seen from Jezero (topocentric site on Mars, QUANTITIES 4):
//      10 min steps 2026-11-14..2026-11-21 and 1 h steps 2026-11-01..2027-01-31.
// Longitude convention (verified against the API): Mars is an IAU west-positive body, so SITE_COORD longitude is
// WEST-positive: Jezero 77.4509 deg EAST is passed as -77.4509 (positive 77.4509 is rejected with
// "Input east-longitude as negative for IAU west-positive body #499"). Cross-checked with a Sun query (target 10)
// against the repo's Mars24 sun model (agrees within 0.1 deg).
// Usage: node scripts/fetch-horizons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_REL = 'public/data/earth_link.json';
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const SITE = { name: 'Jezero crater (Octavia E. Butler landing site)', latDeg: 18.4446, lonEastDeg: 77.4509, altKm: -2.567 };
const SITE_COORD = `${-SITE.lonEastDeg},${SITE.latDeg},${SITE.altKm}`; // west-positive longitude, see header

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function horizons(params) {
  const qs = new URLSearchParams({ format: 'json', OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", CSV_FORMAT: "'YES'", ...params });
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`${API}?${qs}`);
      if (res.ok) {
        const j = await res.json();
        if (j.error) throw new Error(`Horizons: ${j.error}`);
        const t = j.result;
        const a = t.indexOf('$$SOE'), b = t.indexOf('$$EOE');
        if (a < 0 || b < 0) throw new Error(`no ephemeris block: ${t.slice(0, 400)}`);
        return t.slice(a + 5, b).trim().split('\n').map((l) => l.split(',').map((s) => s.trim()));
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt === 5 || String(e.message).startsWith('Horizons:')) throw e;
      await sleep(3000 * attempt);
    }
  }
}

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "2026-Nov-15 00:10" -> UTC ms */
function parseCal(s) {
  const m = /^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s);
  return Date.UTC(+m[1], MON[m[2]], +m[3], +m[4], +m[5]);
}
const r = (x, d) => Number(x.toFixed(d));
const iso = (ms) => new Date(ms).toISOString();

// ---- A) light time
const QUERY_A = {
  COMMAND: "'399'", EPHEM_TYPE: "'OBSERVER'", CENTER: "'500@499'",
  START_TIME: "'2026-01-01'", STOP_TIME: "'2040-12-31'", STEP_SIZE: "'1 d'", QUANTITIES: "'20,21'",
};
console.log('A) light time ...');
const rowsA = await horizons(QUERY_A);
const t0A = parseCal(rowsA[0][0]);
rowsA.forEach((row, i) => { if (parseCal(row[0]) !== t0A + i * 86_400_000) throw new Error(`light-time row ${i} not on a 1-day grid: ${row[0]}`); });
const lightTime = {
  start: iso(t0A), stepDays: 1, count: rowsA.length,
  rangeAu: rowsA.map((x) => r(parseFloat(x[3]), 6)), // apparent (light-time aberrated) range Mars centre -> Earth centre
  oneWayMin: rowsA.map((x) => r(parseFloat(x[5]), 4)), // Horizons "1-way_down_LT", minutes
};

// ---- B) Earth in the Jezero sky
const QUERY_B_COMMON = {
  COMMAND: "'399'", EPHEM_TYPE: "'OBSERVER'", CENTER: "'coord@499'", COORD_TYPE: "'GEODETIC'",
  SITE_COORD: `'${SITE_COORD}'`, QUANTITIES: "'4'", ANG_FORMAT: "'DEG'", APPARENT: "'AIRLESS'",
};
const SEGMENTS = [
  { label: 'hour', START_TIME: "'2026-11-01 00:00'", STOP_TIME: "'2027-01-31 23:00'", STEP_SIZE: "'1 h'", stepMin: 60 },
  { label: 'ten-minute', START_TIME: "'2026-11-14 00:00'", STOP_TIME: "'2026-11-21 23:50'", STEP_SIZE: "'10 m'", stepMin: 10 },
];
const series = [];
for (const seg of SEGMENTS) {
  console.log(`B) Earth az/el, ${seg.label} steps ...`);
  await sleep(1500);
  const rows = await horizons({ ...QUERY_B_COMMON, START_TIME: seg.START_TIME, STOP_TIME: seg.STOP_TIME, STEP_SIZE: seg.STEP_SIZE });
  const t0 = parseCal(rows[0][0]);
  rows.forEach((row, i) => { if (parseCal(row[0]) !== t0 + i * seg.stepMin * 60_000) throw new Error(`${seg.label} row ${i} off-grid: ${row[0]}`); });
  series.push({
    start: iso(t0), stepMin: seg.stepMin, count: rows.length,
    azDeg: rows.map((x) => r(parseFloat(x[3]), 2)), elDeg: rows.map((x) => r(parseFloat(x[4]), 2)),
  });
}

const retrieved = new Date().toISOString();
const doc = {
  source: {
    title: 'NASA JPL Horizons',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    api: API,
    ephemeris: 'Earth: DE441; Mars centre: mar099 (as reported by Horizons)',
    query: {
      lightTime: { ...QUERY_A, format: 'json', CSV_FORMAT: "'YES'" },
      earthSky: {
        ...QUERY_B_COMMON, format: 'json', CSV_FORMAT: "'YES'",
        segments: SEGMENTS.map(({ START_TIME, STOP_TIME, STEP_SIZE }) => ({ START_TIME, STOP_TIME, STEP_SIZE })),
        note: 'SITE_COORD longitude is west-positive for Mars (IAU): -77.4509 = 77.4509 deg East.',
      },
    },
    retrieved,
  },
  lightTime: { ...lightTime, units: { rangeAu: 'au', oneWayMin: 'minutes' }, note: 'one-way Earth<->Mars-centre light time; times are UTC' },
  earthSky: {
    site: SITE, horizonsSiteCoord: SITE_COORD,
    note: 'Apparent (airless) azimuth (deg from north, clockwise) and elevation of Earth centre above the local geodetic horizon; times UTC. Segments may overlap: finest step wins.',
    series,
  },
};
const text = JSON.stringify(doc);
await writeFile(join(ROOT, OUT_REL), text);
console.log(`wrote ${OUT_REL}: ${text.length} bytes`);

// ---- manifest entry (idempotent upsert)
const mPath = join(ROOT, 'data/source_manifest.json');
const manifest = JSON.parse(await readFile(mPath, 'utf8'));
manifest.files[OUT_REL] = {
  output: OUT_REL,
  outputBytes: text.length,
  outputSha256: createHash('sha256').update(text).digest('hex'),
  licence: 'NASA data: generally not copyrighted; cite source.',
  sourceUrls: ['https://ssd.jpl.nasa.gov/horizons/', 'https://ssd-api.jpl.nasa.gov/doc/horizons.html', API],
  productLabel: 'Earth light time (2026-2040) and Earth az/el at Jezero from NASA JPL Horizons',
  mission: 'Solar System Dynamics',
  instrument: 'JPL Horizons on-line ephemeris system (DE441 / mar099), observer API',
  projection: 'n/a (time series)',
  datum: 'Mars IAU_MARS body-fixed frame; Jezero 18.4446 N, 77.4509 E, -2.567 km (west-positive longitude -77.4509 passed to Horizons)',
  resolution: 'light time 1 d; Earth az/el 10 min (2026-11-14..21) and 1 h (2026-11-01..2027-01-31)',
  credit: 'NASA/JPL Solar System Dynamics (Horizons)',
  raws: [],
  processing: `scripts/fetch-horizons.mjs: queried Horizons API, rounded (range 6 dp au, light time 4 dp min, az/el 2 dp deg), retrieved ${retrieved}`,
};
await writeFile(mPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest updated');
