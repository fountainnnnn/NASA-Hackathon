/**
 * Pure builders for the Mission Log: from a tool's arguments and result (and the mission constraints) to key values,
 * formula lines with the real numbers substituted, and sources. Nothing here invents a number: every figure printed is
 * either present in the inputs or plain arithmetic on figures that are (and the line says so).
 */
import { G_MARS, R_MARS } from '../contracts';
import type { LonLat, MissionConstraints, RouteResult } from '../contracts';
import type { CommsResult, DaylightCheck, GoNoGo, GoNoGoItem } from '../opsContracts';
import { toblerKmh } from '../terrain/astar';
import { formatHms, ltstHours, marsState, sunPosition, sunriseSunset } from '../ops/mars24';
import { COMMS_NOGO_SHADOW_M, SUIT_ANTENNA_HEIGHT_M } from '../ops/assumptions';

export interface Src { title: string; url?: string }
export interface Explain { kv: [string, string][]; calcs: string[]; sources: Src[] }

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Rounded to `d` decimals, en-US grouping; a value that rounds to zero prints as 0, never "-0". */
export const fmt = (v: number, d = 1) => { const r = Math.round(v * 10 ** d) / 10 ** d; return (r === 0 ? 0 : r).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d }); };
const empty = (): Explain => ({ kv: [], calcs: [], sources: [] });
/** "13.69 deg", "60 deg" in source texts -> "13.69°", "60°". */
export const degSign = (t: string) => t.replace(/(\d)\s?deg\b/g, '$1°');

/** Battery used by a walk, from the suit power model: P x t / C. Returns the formula line, or null when an input is missing. */
export function batteryLine(powerW: unknown, evaMin: unknown, batteryWh: unknown): string | null {
  if (!isNum(powerW) || !isNum(evaMin) || !isNum(batteryWh) || batteryWh <= 0) return null;
  const h = evaMin / 60;
  return `battery = P_suit × t ÷ C = ${fmt(powerW, 0)} W × ${fmt(h, 2)} h ÷ ${fmt(batteryWh, 0)} Wh = ${fmt((powerW * h * 100) / batteryWh, 1)} %`;
}

/** Climb work: m x g x ascent. */
export function climbLine(massKg: unknown, ascentM: unknown): string | null {
  if (!isNum(massKg) || !isNum(ascentM)) return null;
  return `climb work = m × g × ascent = ${fmt(massKg, 0)} kg × ${G_MARS} m/s² × ${fmt(ascentM, 1)} m = ${fmt((massKg * G_MARS * ascentM) / 1000, 0)} kJ`;
}

/** One-way light time: range / c, with the range in au and c expressed in seconds per au (499.0). */
export function lightLine(rangeAu: unknown, minutes: unknown): string | null {
  if (!isNum(rangeAu) || !isNum(minutes)) return null;
  return `light time = range ÷ c = ${fmt(rangeAu, 3)} au × 499.0 s/au = ${fmt(minutes, 2)} min`;
}

/** Route totals and constraints to the walk's calculation lines. */
export function explainRoute(totals: Obj | null | undefined, c: Obj | null | undefined): Explain {
  const e = empty();
  if (!totals || !c) return e;
  const b = batteryLine(c.suitPowerW, totals.evaMin, c.batteryWh);
  if (b) e.calcs.push(b);
  if (isNum(totals.batteryUsedPct)) e.calcs.push(`reported battery used = ${fmt(totals.batteryUsedPct, 1)} % (route model), reserve ${fmt(c.batteryReservePct ?? NaN, 0)} %`);
  const k = climbLine(c.crewMassKg, totals.ascentM);
  if (k) e.calcs.push(k);
  if (isNum(totals.lengthM) && isNum(totals.walkMin)) e.calcs.push(`EVA time = walk + dwell = ${fmt(totals.walkMin, 0)} min walking + ${fmt(c.dwellMin ?? NaN, 0)} min at the target = ${fmt(totals.evaMin, 0)} min`);
  e.kv.push(['length', `${fmt(totals.lengthM / 1000, 2)} km`], ['max slope', `${fmt(totals.maxSlopeDeg, 1)}°`], ['EVA', `${fmt(totals.evaMin, 0)} min`]);
  e.sources.push({ title: 'MRO CTX DEM 20 m, JPL Mars Trek', url: 'https://trek.nasa.gov/mars/' });
  return e;
}

export function explainTool(name: string, args: unknown, result: unknown): Explain {
  const a = (args && typeof args === 'object' ? args : {}) as Obj;
  const r = (result && typeof result === 'object' ? result : {}) as Obj;
  const e = empty();
  if (r.error) { e.kv.push(['error', String(r.message ?? r.error)]); return e; }
  switch (name) {
    case 'get_site_conditions': {
      if (isNum(r.elevationM)) e.kv.push(['elevation', `${fmt(r.elevationM, 0)} m`]);
      if (isNum(r.slopeDeg)) { e.kv.push(['regional slope', `${fmt(r.slopeDeg, 1)}°`]); e.calcs.push(`slope = atan(√((∂z/∂x)² + (∂z/∂y)²)) = ${fmt(r.slopeDeg, 1)}° (Horn 3×3 on the global MOLA grid)`); }
      if (r.geology?.name) e.kv.push(['geology', `${r.geology.name}${r.geology.symbol ? ` (${r.geology.symbol})` : ''}`]);
      for (const l of (r.layers ?? []) as Obj[]) if (isNum(l.value)) e.kv.push([String(l.label), `${fmt(l.value, 2)} ${l.unit ?? ''}`.trim()]);
      const n = r.nearestSites?.[0]; if (n) e.kv.push(['nearest site', `${n.name}, ${fmt(n.distanceKm, 0)} km`]);
      e.sources.push({ title: 'MGS MOLA topography' }); if (r.geology) e.sources.push({ title: 'USGS SIM 3292' });
      break;
    }
    case 'check_landing_site': {
      const rows = (r.criteria ?? []) as Obj[];
      for (const c of rows) e.calcs.push(degSign(`${c.label}: ${c.value == null ? 'no data' : `${fmt(c.value, 2)} ${c.unit ?? ''}`.trim()} vs limit ${c.limit} → ${String(c.result).toUpperCase()}`));
      e.kv.push(['verdict', String(r.verdict ?? '')], ['criteria', `${rows.filter((c) => c.result === 'pass').length} pass, ${rows.filter((c) => c.result === 'fail').length} fail, ${rows.filter((c) => c.result === 'no data').length} no data`]);
      const seen = new Set<string>();
      for (const c of rows) if (c.sourceTitle && !seen.has(c.sourceTitle)) { seen.add(c.sourceTitle); e.sources.push({ title: c.sourceTitle, url: c.sourceUrl }); }
      break;
    }
    case 'run_landing_scenario': {
      if (isNum(r.samples) && isNum(r.okPercent)) {
        const ok = Math.round((r.okPercent / 100) * r.samples);
        e.calcs.push(`${fmt(r.samples, 0)} samples, seed ${r.seed ?? 'n/a'}, ok = ${fmt(ok, 0)} (${fmt(r.okPercent, 1)} %) at or under ${r.maxSlopeDeg}°, p50 slope ${r.slopeP50Deg ?? 'n/a'}°, p95 slope ${r.slopeP95Deg ?? 'n/a'}°`);
        e.calcs.push(`ok fraction = N_ok ÷ N = ${fmt(ok, 0)} ÷ ${fmt(r.samples, 0)} = ${fmt(r.okPercent, 1)} % (N_ok recovered from the reported percentage)`);
      }
      if (r.ellipse) e.calcs.push(`dispersion = truncated 2-D Gaussian, 3σ = semi-axes ${r.ellipse.semiMajorKm} × ${r.ellipse.semiMinorKm} km, azimuth ${r.ellipse.azimuthDeg}°`);
      e.kv.push(['terrain', String(r.terrainModel ?? '')], ['engine', String(r.engine ?? '')], ['slope limit', `${r.maxSlopeDeg}° (assumption)`]);
      e.sources.push({ title: String(r.terrainModel ?? 'terrain model') });
      break;
    }
    case 'show_edl_timeline': {
      const ph = (r.phases ?? []) as Obj[];
      for (const p of ph) e.calcs.push(`${p.label}: t = ${p.tStartS} s to ${p.tEndS} s`);
      if (ph.length) e.kv.push(['entry to touchdown', `${fmt(Math.max(...ph.map((p) => p.tEndS)) / 60, 1)} min`]);
      if (ph[0]) e.sources.push({ title: ph[0].sourceTitle, url: ph[0].sourceUrl });
      break;
    }
    case 'analyze_terrain': {
      if (isNum(r.pctAboveLimit)) e.calcs.push(`share over limit = cells above ${r.limitDeg}° ÷ cells within ${r.radiusM} m = ${fmt(r.pctAboveLimit, 1)} %`);
      e.kv.push(['mean slope', `${r.slopeMeanDeg}°`], ['p90 slope', `${r.slopeP90Deg}°`]);
      e.sources.push({ title: 'MRO CTX DEM 20 m, JPL Mars Trek' });
      break;
    }
    default: {
      for (const [k, v] of Object.entries(r)) if (e.kv.length < 6 && (isNum(v) || typeof v === 'string') && k !== 'scenarioId') e.kv.push([k, String(v).slice(0, 60)]);
    }
  }
  void a;
  return e;
}

/* ================================================================== structured steps for the MarsAgent thread */
/*
 * The builders below turn one committed route (and the ops checks run on it) into the "How I worked it out" steps,
 * the card rows and the report calculations. Every number printed is read from the route, the constraints, the ops
 * results or the Mars24 / Horizons functions, then substituted into the formula text. Nothing is typed by hand.
 */

export type ExTone = 'go' | 'caution' | 'nogo';
export interface ExStep { kind: 'input' | 'model' | 'tool' | 'calculation' | 'verdict'; title: string; meta?: string; durMs?: number; text?: string; code?: string[]; sources?: Src[]; raw?: unknown; tone?: ExTone }
const clockMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
/** Run a builder and return its result with the measured time of that work, ms. */
function timed<T>(f: () => T): [T, number] { const t0 = clockMs(); const r = f(); return [r, clockMs() - t0]; }
export interface ExRow { label: string; value: string; tone?: ExTone | 'info' | 'none'; src?: string }
export interface RouteOpsLike {
  goNoGo: GoNoGo; comms: CommsResult | null; daylight: DaylightCheck | null; startUtcMs: number; mastM: number; verdict: { word: string; tone: ExTone; reason: string };
  /** Blockers then cautions in the order they are numbered on the card and the map (routeOps.orderedIssues). */
  order?: GoNoGo['blockers'];
}

export const SRC = {
  dem: { title: 'MRO CTX DEM 20 m, JPL Mars Trek', url: 'https://trek.nasa.gov/mars/' },
  tobler: { title: 'Tobler 1993 hiking function; suit factor is an assumption' },
  mars24: { title: 'NASA GISS Mars24 algorithm (Allison and McEwen 2000)', url: 'https://www.giss.nasa.gov/tools/mars24/' },
  horizons: { title: 'NASA JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' },
  factsheet: { title: 'NASA Mars Fact Sheet, g = 3.721 m/s²', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html' },
  suit: { title: 'Suit power and battery are assumptions, not a NASA suit specification' },
  viewshed: { title: 'Line of sight on the MRO CTX DEM 20 m; mast and antenna heights are assumptions' },
} as const;

export const llStr = (p: LonLat, d = 4) => `${Math.abs(p.lat).toFixed(d)}${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(d)}${p.lon >= 0 ? 'E' : 'W'}`;
export const hmin = (min: number) => { const m = Math.round(min); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
export const kmStr = (m: number) => `${fmt(m / 1000, 2)} km`;
const DEG = Math.PI / 180;
function groundDistM(a: LonLat, b: LonLat): number {
  const lat = ((a.lat + b.lat) / 2) * DEG;
  return Math.hypot(R_MARS * Math.cos(lat) * (b.lon - a.lon) * DEG, R_MARS * (b.lat - a.lat) * DEG);
}
const STATUS_WORD: Record<string, string> = { go: 'pass', caution: 'caution', 'no-go': 'fail' };
const TONE_OF: Record<string, ExTone> = { go: 'go', caution: 'caution', 'no-go': 'nogo' };
export const itemTone = (i: GoNoGoItem | undefined): ExTone | 'none' => (i ? TONE_OF[i.status] : 'none');
const item = (g: GoNoGo, id: string) => g.items.find((i) => i.id === id);

/** Sunset of the sol containing `ms` at `p`, in UTC ms (null for polar day or night). */
export function sunsetAfter(p: LonLat, ms: number): { sunsetMs: number | null; polar: 'day' | 'night' | null } {
  try { const s = sunriseSunset(p.lat, p.lon, ms); return { sunsetMs: s.sunsetMs, polar: s.polar }; } catch { return { sunsetMs: null, polar: null }; }
}
export const ltstStr = (ms: number, lon: number) => formatHms(ltstHours(marsState(ms), lon)).slice(0, 5);

/** Daylight margin at return: sunset minus the end of the EVA. */
export function daylightMargin(route: RouteResult, startUtcMs: number): { text: string; min: number | null } {
  const end = startUtcMs + route.totals.evaMin * 60_000;
  const s = sunsetAfter(route.from, end);
  if (s.polar === 'day') return { text: 'sun up all sol', min: Infinity };
  if (s.polar === 'night' || s.sunsetMs == null) return { text: 'no daylight', min: null };
  const m = (s.sunsetMs - end) / 60_000;
  // under a minute either side of sunset reads "under 1 min", never "0 min"
  if (Math.abs(m) < 1) return { text: m >= 0 ? 'under 1 min' : 'under 1 min after sunset', min: m };
  return m >= 0 ? { text: hmin(m), min: m } : { text: `${hmin(-m)} after sunset`, min: m };
}

/** The six card rows for a committed route, each with its go/no-go status. */
export function routeRows(route: RouteResult, ops: RouteOpsLike, c: MissionConstraints): ExRow[] {
  const t = route.totals, g = ops.goNoGo;
  const left = 100 - t.batteryUsedPct;
  const comms = item(g, 'comms');
  const day = daylightMargin(route, ops.startUtcMs);
  // a row that blocks or cautions carries its number from the one ordered list, the same number its map label shows
  const order = ops.order ?? [...g.blockers, ...g.cautions];
  const num = (id: GoNoGo['blockers'][number], label: string) => { const k = order.indexOf(id); return k >= 0 ? `${k + 1}. ${label}` : label; };
  return [
    { label: 'Round trip', value: kmStr(t.lengthM), tone: 'info', src: 'A* on the 20 m DEM' },
    { label: num('eva-time', `Time on foot, incl. ${c.dwellMin} min at target`), value: hmin(t.evaMin), tone: itemTone(item(g, 'eva-time')), src: 'Tobler walking model' },
    { label: num('battery', 'Battery at return / reserve'), value: `${fmt(left, 1)} % / ${fmt(c.batteryReservePct, 0)} %`, tone: itemTone(item(g, 'battery')), src: 'P × t ÷ C' },
    { label: num('slope', 'Max slope / limit'), value: `${fmt(t.maxSlopeDeg, 1)}° / ${fmt(c.maxSlopeDeg, 0)}°`, tone: itemTone(item(g, 'slope')), src: 'MRO CTX DEM 20 m' },
    { label: num('comms', 'Longest comms shadow / limit'), value: comms?.value == null ? 'not checked' : `${fmt(comms.value / 1000, 1)} km / ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km`, tone: itemTone(comms), src: `line of sight from a ${ops.mastM} m mast` },
    { label: num('daylight', 'Daylight margin at return'), value: day.text, tone: itemTone(item(g, 'daylight')), src: 'Mars24' },
  ];
}

/** Walking time: Tobler with the suit factor, shown at each leg's mean grade, then the summed per-segment times. */
export function walkingCalc(route: RouteResult, c: MissionConstraints): string[] {
  const f = c.suitSpeedFactor;
  const out = ['v(θ) = f × 6 km/h × e^(-3.5 × |tan θ + 0.05|)'];
  route.legs.forEach((l, i) => {
    if (!(l.horizM > 0)) return;
    const name = route.roundTrip && i === route.legs.length - 1 ? 'return' : route.legs.length > 2 ? `leg ${i + 1}` : 'outbound';
    const g = (l.ascentM - l.descentM) / l.horizM;
    out.push(`${name}: tan θ = (${fmt(l.ascentM, 0)} - ${fmt(l.descentM, 0)}) m ÷ ${fmt(l.horizM, 0)} m = ${fmt(g, 3)}  →  v = ${fmt(f, 2)} × 6 × e^(-3.5 × |${fmt(g, 3)} + 0.05|) = ${fmt(toblerKmh(g, f), 2)} km/h`);
  });
  const parts = route.legs.map((l) => `${fmt(l.timeMin, 0)} min`).join(' + ');
  out.push(`t = Σ segment length ÷ v(θ segment) + dwell = ${parts} + ${fmt(c.dwellMin, 0)} min = ${hmin(route.totals.walkMin + c.dwellMin)}`);
  return out;
}

export function batteryCalc(powerW: number, evaMin: number, batteryWh: number, reservePct: number): { lines: string[]; leftPct: number; pass: boolean } {
  const h = evaMin / 60, used = (powerW * h * 100) / batteryWh, left = 100 - used, pass = left >= reservePct;
  return {
    leftPct: left, pass,
    lines: [
      `used = P × t ÷ C = ${fmt(powerW, 0)} W × ${fmt(h, 2)} h ÷ ${fmt(batteryWh, 0)} Wh = ${fmt(used, 1)} %`,
      `left = 100 % - ${fmt(used, 1)} % = ${fmt(left, 1)} %  (reserve ${fmt(reservePct, 0)} %)  ${pass ? 'pass' : 'fail'}`,
    ],
  };
}

export function commsCalc(route: RouteResult, comms: CommsResult | null, base: LonLat | null, mastM: number): string[] {
  if (!comms || !base) return ['comms not evaluated: no base station is set'];
  let far = 0;
  for (const l of route.legs) for (const p of l.path) far = Math.max(far, groundDistM(base, p));
  const longest = comms.shadows.reduce<CommsResult['shadows'][number] | null>((m, s) => (!m || s.lengthM > m.lengthM ? s : m), null);
  const status = comms.shadows.length === 0 ? 'pass' : comms.longestShadowM > COMMS_NOGO_SHADOW_M ? 'fail' : 'caution';
  return [
    `mast ${fmt(mastM, 0)} m (assumption), suit antenna ${fmt(SUIT_ANTENNA_HEIGHT_M, 1)} m, ray sampled every 10 m`,
    `curvature drop = d² ÷ 2R = (${fmt(far, 0)} m)² ÷ (2 × ${fmt(R_MARS, 0)} m) = ${fmt((far * far) / (2 * R_MARS), 2)} m`,
    longest
      ? `${comms.shadows.length} hidden stretch${comms.shadows.length === 1 ? '' : 'es'}, longest vertices ${longest.startIdx} to ${longest.endIdx}, ${kmStr(longest.lengthM)}`
      : `every one of ${comms.visible.length} vertices sees the mast`,
    `limit ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km per stretch  ${status}`,
  ];
}

export function sunCalc(route: RouteResult, ops: RouteOpsLike): string[] {
  const st = marsState(ops.startUtcMs);
  const end = ops.startUtcMs + route.totals.evaMin * 60_000;
  const e0 = sunPosition(ops.startUtcMs, route.from.lat, route.from.lon).elevationDeg;
  const e1 = sunPosition(end, route.from.lat, route.from.lon).elevationDeg;
  const s = sunsetAfter(route.from, end);
  const day = item(ops.goNoGo, 'daylight');
  return [
    `Mars24: MSD ${fmt(st.msd, 1)}, Ls ${fmt(st.lsDeg, 1)}°, LTST ${ltstStr(ops.startUtcMs, route.from.lon)} at the start`,
    // one decimal near the horizon, where a whole degree hides whether the sun is up
    `sun elevation ${fmt(e0, Math.abs(e0) < 10 ? 1 : 0)}° at the start, ${fmt(e1, Math.abs(e1) < 10 ? 1 : 0)}° at the end${ops.daylight ? `, lowest ${fmt(ops.daylight.minElevationDeg, Math.abs(ops.daylight.minElevationDeg) < 10 ? 1 : 0)}°` : ''}`,
    `${s.sunsetMs != null ? `sunset ${ltstStr(s.sunsetMs, route.from.lon)} LTST, ` : ''}daylight margin at return ${daylightMargin(route, ops.startUtcMs).text}  ${STATUS_WORD[day?.status ?? 'caution']}`,
  ];
}

export function earthCalc(rangeAu: number | null, minutes: number | null): string[] | null {
  if (rangeAu == null || minutes == null) return null;
  return [`one-way light time = range ÷ c = ${fmt(rangeAu, 6)} au × 499.005 s/au = ${fmt(rangeAu * 499.005, 1)} s = ${fmt(minutes, 1)} min`];
}

export function verdictLine(g: GoNoGo): string {
  const name: Record<string, string> = { slope: 'slope', battery: 'battery', 'eva-time': 'EVA time', daylight: 'daylight', comms: 'comms', data: 'data' };
  return g.items.map((i) => `${name[i.id] ?? i.id} ${STATUS_WORD[i.status]}`).join(', ');
}

/** "How I worked it out" for a committed route: the solver call, then each calculation, then the verdict. */
/** `opsMs`: measured time of the ops check (line of sight, sun, go/no-go), shown on the comms step, its dominant cost. */
export function routeSteps(route: RouteResult, ops: RouteOpsLike, c: MissionConstraints, base: LonLat | null, earth: { rangeAu: number | null; minutes: number | null } | null, opsMs?: number): ExStep[] {
  const t = route.totals;
  const out = route.legs[0], back = route.roundTrip ? route.legs[route.legs.length - 1] : null;
  const pts = route.legs.reduce((n, l) => n + l.path.length, 0);
  const steps: ExStep[] = [{
    kind: 'tool', title: 'plan_round_trip', meta: `${fmt(route.computeMs, 0)} ms`, durMs: route.computeMs, sources: [SRC.dem],
    code: [
      `// A* on a ${route.gridResM} m grid from the ${route.demResM} m CTX DEM, objective ${c.objective}`,
      `from ${llStr(route.from)}  to ${llStr(route.to)}`,
      `edge allowed if |grade| <= ${fmt(c.maxSlopeDeg, 0)}° and cell max slope <= ${fmt(c.maxSlopeDeg, 0)}° (both endpoint cells included)`,
      ...(route.legs.length
        ? [`path ${pts} vertices, outbound ${kmStr(out?.lengthM ?? 0)}${back ? ` + return ${kmStr(back.lengthM)} = ${kmStr(t.lengthM)}` : ''}, ascent ${fmt(t.ascentM, 1)} m`]
        : [
          ...(route.targetSlopeDeg != null ? [`target cell max slope ${fmt(route.targetSlopeDeg, 1)}° vs limit ${fmt(c.maxSlopeDeg, 0)}°  ${route.targetSlopeDeg > c.maxSlopeDeg ? 'fail' : 'pass'}`] : []),
          `no path in either direction: ${route.reasons.join(', ') || 'none found'}${route.minFeasibleSlopeDeg ? `; re-run at 1° steps: ${route.minFeasibleSlopeDeg}° is the smallest limit that works` : route.minFeasibleSlopeDeg === null ? '; none up to 45°' : ''}`,
        ]),
    ],
    raw: { args: { from: route.from, to: route.to, roundTrip: route.roundTrip, constraints: c }, result: { id: route.id, feasible: route.feasible, reasons: route.reasons, minFeasibleSlopeDeg: route.minFeasibleSlopeDeg ?? null, targetSlopeDeg: route.targetSlopeDeg ?? null, totals: t, gridResM: route.gridResM, demResM: route.demResM, computeMs: route.computeMs, legs: route.legs.map((l) => ({ lengthM: l.lengthM, ascentM: l.ascentM, descentM: l.descentM, maxSlopeDeg: l.maxSlopeDeg, timeMin: l.timeMin, vertices: l.path.length })) } },
  }];
  if (!route.legs.length) return steps;
  const [walk, walkMs] = timed(() => walkingCalc(route, c));
  steps.push({ kind: 'calculation', title: 'Walking time', durMs: walkMs, code: walk, sources: [SRC.tobler], raw: { suitSpeedFactor: c.suitSpeedFactor, legs: route.legs.map((l) => ({ horizM: l.horizM, ascentM: l.ascentM, descentM: l.descentM, timeMin: l.timeMin })), dwellMin: c.dwellMin } });
  const [b, bMs] = timed(() => batteryCalc(c.suitPowerW, t.evaMin, c.batteryWh, c.batteryReservePct));
  steps.push({ kind: 'calculation', title: 'Suit battery', durMs: bMs, code: b.lines, sources: [SRC.suit], tone: itemTone(item(ops.goNoGo, 'battery')) as ExTone, raw: { suitPowerW: c.suitPowerW, evaMin: t.evaMin, batteryWh: c.batteryWh, reservePct: c.batteryReservePct, usedPct: t.batteryUsedPct } });
  const [k, kMs] = timed(() => climbLine(c.crewMassKg, t.ascentM));
  if (k) steps.push({ kind: 'calculation', title: 'Climbing work', durMs: kMs, code: [k.replace('climb work', 'W')], sources: [SRC.factsheet], raw: { crewMassKg: c.crewMassKg, g: G_MARS, ascentM: t.ascentM } });
  const [cm, cmMs] = timed(() => commsCalc(route, ops.comms, base, ops.mastM));
  steps.push({ kind: 'calculation', title: 'Comms line of sight from base', meta: ops.comms ? `${ops.comms.visible.length} rays` : undefined, durMs: opsMs ?? cmMs, code: cm, sources: [SRC.viewshed], tone: itemTone(item(ops.goNoGo, 'comms')) as ExTone, raw: ops.comms ? { stationHeightM: ops.comms.stationHeightM, suitHeightM: ops.comms.suitHeightM, longestShadowM: ops.comms.longestShadowM, shadows: ops.comms.shadows.map((s) => ({ startIdx: s.startIdx, endIdx: s.endIdx, lengthM: s.lengthM })), visibleFraction: ops.comms.visibleFraction } : null });
  const [sun, sunMs] = timed(() => sunCalc(route, ops));
  steps.push({ kind: 'calculation', title: 'Sun along the route', durMs: sunMs, code: sun, sources: [SRC.mars24], tone: itemTone(item(ops.goNoGo, 'daylight')) as ExTone, raw: ops.daylight });
  const [e, eMs] = timed(() => (earth ? earthCalc(earth.rangeAu, earth.minutes) : null));
  if (e) steps.push({ kind: 'calculation', title: 'Earth link delay', durMs: eMs, code: e, sources: [SRC.horizons], raw: earth });
  const nBlock = ops.goNoGo.blockers.length, nCaut = ops.goNoGo.cautions.length;
  const [vl, vMs] = timed(() => verdictLine(ops.goNoGo));
  steps.push({ kind: 'verdict', title: `Verdict ${ops.verdict.word}`, meta: nBlock ? `${nBlock} blocker${nBlock === 1 ? '' : 's'}` : nCaut ? `${nCaut} caution${nCaut === 1 ? '' : 's'}` : 'all clear', durMs: vMs, text: vl, tone: ops.verdict.tone, raw: ops.goNoGo });
  return steps;
}
