/**
 * Mission planning report, built from the live session: the committed route and its ops checks, the mission limits,
 * the landing checks, the MarsAgent thread (for the trace) and the Horizons / Mars24 values. Pure: the app gathers
 * the inputs (src/app/reportInput.ts), this file shapes them into eight sections, and the renderers turn that into
 * the paper view, Markdown, JSON and GeoJSON. A value the session does not have is marked Mock, never invented.
 */
import type { LonLat, MissionConstraints, RouteResult } from '../contracts';
import { DEFAULT_CONSTRAINTS } from '../contracts';
import {
  BATTERY_CAUTION_MARGIN_PCT, COMMS_NOGO_SHADOW_M, EVA_CAUTION_FRACTION, MIN_SUN_ELEVATION_DEG, SLOPE_CAUTION_FRACTION, SUIT_ANTENNA_HEIGHT_M,
} from '../ops/assumptions';
import {
  batteryCalc, climbLine, commsCalc, daylightMargin, degSign, earthCalc, fmt, hmin, kmStr, llStr, ltstStr, sunCalc, walkingCalc,
  type RouteOpsLike,
} from '../agent/explain';

export type Status = 'pass' | 'caution' | 'fail' | 'info';
export interface Cell { text: string; mock?: boolean; status?: Status; kind?: 'observed' | 'computed' | 'assumption' }
export type Val = string | Cell;
export interface Table { head: string[]; rows: Val[][]; num?: number[] }
export interface Calc { n: string; title: string; lines: string[]; note?: string }
export interface Section { n: number; id: string; title: string; lead?: string; tables: Table[]; calcs?: Calc[]; notes?: string[]; list?: string[] }

export interface TraceTurn {
  seq: number; question: string; origin: string; engine: string; startedAt: number; endedAt?: number;
  /** durMs: measured time of the step's own work. */
  steps: { kind: string; title: string; meta?: string; durMs?: number; text?: string; code?: string[]; raw?: unknown }[];
  /** tMs: each line's own measured duration (undefined for lines that report something already known). */
  narration: { text: string; tMs?: number }[];
}
/** Science at the planned target and the nearest Perseverance view, as found when the route was planned. */
export interface TargetScienceFact {
  target: LonLat;
  unit: { symbol: string; name: string } | null;
  site: { name: string; distanceKm: number; url?: string; sourceTitle?: string } | null;
  ground: { sol: number; distanceM: number; photos: { id: string; url: string; pageUrl?: string; camera: string; cameraFull: string; credit: string; earthDate: string }[] } | null;
}
export interface LandingFact {
  site: LonLat; verdict: string; caveat?: string;
  criteria: { label: string; value: number | null; unit: string; limit: string; result: string; sourceTitle: string; sourceUrl?: string }[];
}
export interface ScenarioFact { site: LonLat; samples: number; okPercent: number; maxSlopeDeg: number; slopeP50Deg: number | null; slopeP95Deg: number | null; terrainModel: string; engine: string; ellipse: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number } }

export interface ReportInput {
  generatedAt: number;
  route: RouteResult | null;
  ops: RouteOpsLike | null;
  constraints: MissionConstraints;
  base: (LonLat & { elevationM?: number | null; label?: string }) | null;
  targetName?: string | null;
  earth: { rangeAu: number | null; minutes: number | null } | null;
  landing: LandingFact | null;
  scenario: ScenarioFact | null;
  science?: TargetScienceFact | null;
  turns: TraceTurn[];
  validation: { count: number; medianResidualM: number; meanResidualM: number; p95AbsResidualM: number } | null;
}

export interface Report {
  id: string;
  generatedIso: string;
  title: string;
  subtitle: string;
  verdict: { word: string; tone: 'go' | 'caution' | 'nogo'; reason: string } | null;
  sections: Section[];
  mocks: string[];
  byline: string;
}

const mock = (text = 'not computed'): Cell => ({ text, mock: true });
const st = (s: string): Status => (s === 'go' || s === 'pass' ? 'pass' : s === 'caution' ? 'caution' : s === 'no-go' || s === 'fail' ? 'fail' : 'info');
const iso = (ms: number) => new Date(ms).toISOString();
/** Measured step time for the trace: "under 1 ms", "4 ms", "1.24 s". */
const stepTime = (ms: number) => (ms < 1 ? 'under 1 ms' : ms < 100 ? `${Math.round(ms)} ms` : ms < 10_000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms / 1000)} s`);
/** Ellipse size as people say it (full axes), with the semi-axes the model uses. */
export const ellipseText = (e: { semiMajorKm: number; semiMinorKm: number }) => `${fmt(e.semiMajorKm * 2, 1)} by ${fmt(e.semiMinorKm * 2, 1)} km (semi-axes ${fmt(e.semiMajorKm, 2)} and ${fmt(e.semiMinorKm, 2)} km)`;

export function reportId(input: Pick<ReportInput, 'generatedAt' | 'route'>): string {
  return `HM-${iso(input.generatedAt).slice(0, 10)}-${input.route?.id ?? 'S0'}`;
}

export function buildReport(i: ReportInput): Report {
  const mocks: string[] = [];
  const r = i.route, o = i.ops, c = i.constraints;
  const has = !!(r && o && r.legs.length);
  /** A plan was asked for but no path stays under the slope limit: legs and route maths do not exist (not Mock). */
  const noPath = !!(r && !r.legs.length && r.reasons.includes('no_path_slope'));
  const item = (id: string) => o?.goNoGo.items.find((x) => x.id === id);

  /* 1 summary */
  const summary: Table = { head: ['Item', 'Value', 'Limit', 'Status'], num: [1, 2], rows: [] };
  if (has) {
    const t = r!.totals;
    const comms = item('comms'), day = item('daylight');
    summary.rows.push(
      ['Round trip distance', kmStr(t.lengthM), 'n/a', { text: 'info', status: 'info' }],
      [`EVA duration incl. ${c.dwellMin} min at target`, hmin(t.evaMin), hmin(c.evaMaxMin), { text: st(item('eva-time')?.status ?? ''), status: st(item('eva-time')?.status ?? '') }],
      ['Suit battery at return', `${fmt(100 - t.batteryUsedPct, 1)} %`, `>= ${c.batteryReservePct} %`, { text: st(item('battery')?.status ?? ''), status: st(item('battery')?.status ?? '') }],
      ['Maximum slope on route', `${fmt(t.maxSlopeDeg, 1)}°`, `<= ${c.maxSlopeDeg}°`, { text: st(item('slope')?.status ?? ''), status: st(item('slope')?.status ?? '') }],
      ['Longest comms shadow', comms?.value == null ? mock() : kmStr(comms.value), `<= ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km`, { text: st(comms?.status ?? ''), status: st(comms?.status ?? '') }],
      ['Daylight margin at return', daylightMargin(r!, o!.startUtcMs).text, '>= 0', { text: st(day?.status ?? ''), status: st(day?.status ?? '') }],
    );
  } else if (noPath) {
    const ts = r!.targetSlopeDeg, min = r!.minFeasibleSlopeDeg;
    summary.rows.push(
      ['Path from the base under the slope limit', 'none in either direction', `<= ${c.maxSlopeDeg}°`, { text: 'fail', status: 'fail' }],
      ...(ts != null ? [['Target slope (steepest 20 m cell in its 40 m planning cell)', `${fmt(ts, 1)}°`, `<= ${c.maxSlopeDeg}°`, { text: ts > c.maxSlopeDeg ? 'fail' : 'pass', status: ts > c.maxSlopeDeg ? 'fail' : 'pass' }] as Val[]] : []),
      ['Smallest slope limit with a path', min ? `${min}°` : 'none up to 45°', 'n/a', { text: 'info', status: 'info' }],
    );
  } else {
    mocks.push('No route was planned in this session, so sections 1 to 4 show Mock placeholders for the route values.');
    for (const label of ['Round trip distance', 'EVA duration', 'Suit battery at return', 'Maximum slope on route', 'Longest comms shadow', 'Daylight margin at return']) summary.rows.push([label, mock('no route planned'), mock('n/a'), mock('n/a')]);
  }
  const tables1: Table[] = [summary];
  if (i.landing) {
    tables1.push({
      head: ['Landing criterion', 'Value', 'Limit', 'Status'], num: [1],
      rows: i.landing.criteria.map((k) => [k.label, k.value == null ? 'no data at this scale' : degSign(`${fmt(k.value, 2)} ${k.unit}`.trim()), degSign(k.limit), { text: k.result === 'no data' && k.value != null ? 'not scored at this scale' : k.result, status: k.result === 'pass' ? 'pass' : k.result === 'fail' ? 'fail' : 'info' }]),
    });
  }
  if (i.scenario) {
    const sc = i.scenario;
    tables1.push({
      head: ['Landing simulation', 'Value'], num: [1],
      rows: [
        ['Site', llStr(sc.site, 3)],
        ['Ellipse', ellipseText(sc.ellipse)],
        ['Simulated touchdowns', fmt(sc.samples, 0)],
        [`Touchdowns on ground at or under ${sc.maxSlopeDeg}° (assumption)`, `${fmt(sc.okPercent, 1)} %`],
        ['Median / 95th percentile slope', `${sc.slopeP50Deg ?? 'n/a'}° / ${sc.slopeP95Deg ?? 'n/a'}°`],
        ['Terrain model', sc.terrainModel],
      ],
    });
  }
  if (i.science && r && Math.abs(i.science.target.lon - r.to.lon) < 1e-9 && Math.abs(i.science.target.lat - r.to.lat) < 1e-9) {
    const sc = i.science, g = sc.ground, p0 = g?.photos[0];
    tables1.push({
      head: ['Science at target', 'Value', 'Source'],
      rows: [
        ['Geologic unit', sc.unit ? `${sc.unit.name} (${sc.unit.symbol})` : 'none mapped', { text: 'USGS SIM 3464, observed', kind: 'observed' }],
        ['Nearest catalogued science site', sc.site ? `${sc.site.name}, ${fmt(sc.site.distanceKm, 2)} km` : 'none within 50 km', { text: sc.site?.sourceTitle ?? 'HeyMars science sites (NASA pages)', kind: 'observed' }],
        ['View from the ground', p0 && g ? `Sol ${g.sol}, ${p0.cameraFull}, ${fmt(g.distanceM / 1000, 2)} km from the target, ${p0.earthDate}: ${p0.pageUrl ?? p0.url}` : 'no Perseverance photo within 2 km', { text: p0 ? `${p0.credit}, Perseverance raw image` : 'n/a', kind: 'observed' }],
      ],
    });
  }
  const verdict = (has || noPath) && o ? { word: o.verdict.word, tone: o.verdict.tone, reason: o.verdict.reason } : null;
  const lead1 = has
    ? `${o!.goNoGo.blockers.length ? `${o!.goNoGo.blockers.length} blocker${o!.goNoGo.blockers.length === 1 ? '' : 's'}` : 'No blockers'}. ${o!.verdict.reason}`
    : noPath ? `No path under ${c.maxSlopeDeg}° reaches the target at ${llStr(r!.to, 3)}, so no route was drawn and nothing below is computed for a walk.${r!.minFeasibleSlopeDeg ? ` The smallest slope limit with a path is ${r!.minFeasibleSlopeDeg}°.` : ''}`
    : i.landing ? `Landing check at ${llStr(i.landing.site, 3)}: ${i.landing.verdict === 'meets-all' ? 'meets every listed criterion' : i.landing.verdict === 'fails-some' ? `fails ${i.landing.criteria.filter((x) => x.result === 'fail').length} of ${i.landing.criteria.length} criteria` : 'not enough data to judge'}.`
      : 'No route or landing check yet. Drag from the base in Jezero Crater to plan a walk.';

  /* 2 inputs */
  const inputs: Table = { head: ['Parameter', 'Value', 'Type'], num: [1], rows: [] };
  if (i.base) inputs.rows.push(['Start (base)', `${llStr(i.base)}${i.base.elevationM != null ? `, ${fmt(i.base.elevationM, 0)} m` : ''}`, { text: 'observed, Perseverance waypoint sol 13', kind: 'observed' }]);
  else inputs.rows.push(['Start (base)', mock('no base'), { text: 'n/a' }]);
  if (has || noPath) inputs.rows.push(['Target', `${llStr(r!.to)}${r!.to.elevationM != null ? `, ${fmt(r!.to.elevationM, 0)} m` : ''}`, { text: 'computed, CTX DEM bilinear', kind: 'computed' }]);
  else inputs.rows.push(['Target', mock('no route planned'), { text: 'n/a' }]);
  const d = DEFAULT_CONSTRAINTS;
  const user = (k: keyof MissionConstraints) => (c[k] === d[k] ? 'assumption, default' : 'assumption, user set');
  inputs.rows.push(
    ['Max slope', `${c.maxSlopeDeg}°`, { text: user('maxSlopeDeg'), kind: 'assumption' }],
    ['Battery reserve', `${c.batteryReservePct} %`, { text: user('batteryReservePct'), kind: 'assumption' }],
    ['EVA time limit', hmin(c.evaMaxMin), { text: user('evaMaxMin'), kind: 'assumption' }],
    ['Dwell at the target', `${c.dwellMin} min`, { text: user('dwellMin'), kind: 'assumption' }],
    ['Suit power / battery capacity', `${c.suitPowerW} W / ${fmt(c.batteryWh, 0)} Wh`, { text: 'assumption, not a NASA suit spec', kind: 'assumption' }],
    ['Suit speed factor', `${c.suitSpeedFactor} × Tobler`, { text: 'assumption', kind: 'assumption' }],
    ['Crew, suit and kit mass', `${c.crewMassKg} kg`, { text: 'assumption', kind: 'assumption' }],
    ['Comms mast / suit antenna', `${o ? fmt(o.mastM, 1) : 'n/a'} m / ${fmt(SUIT_ANTENNA_HEIGHT_M, 1)} m`, { text: 'assumption', kind: 'assumption' }],
    ['EVA start', o ? `${iso(o.startUtcMs).slice(0, 16).replace('T', ' ')} UTC${r ? `, ${ltstStr(o.startUtcMs, r.from.lon)} local solar time at the base` : ''}` : mock('no route planned'), { text: o ? 'assumption: default 09:00 local solar time at the base, or user set' : 'n/a', kind: 'assumption' }],
    ['Gravity', '3.721 m/s²', { text: 'observed, NASA Mars Fact Sheet', kind: 'observed' }],
  );

  /* 3 route legs */
  const legs: Table = { head: ['Leg', 'Length', 'Ascent', 'Max slope', 'Walk time'], num: [1, 2, 3, 4], rows: [] };
  if (has) {
    r!.legs.forEach((l, k) => legs.rows.push([r!.roundTrip && k === r!.legs.length - 1 ? 'Return' : r!.legs.length > 2 ? `Leg ${k + 1}` : 'Outbound', kmStr(l.lengthM), `${fmt(l.ascentM, 1)} m`, `${fmt(l.maxSlopeDeg, 1)}°`, hmin(l.timeMin)]));
    legs.rows.push([r!.roundTrip ? 'Round trip (sum of legs)' : 'Total', kmStr(r!.totals.lengthM), `${fmt(r!.totals.ascentM, 1)} m`, `${fmt(r!.totals.maxSlopeDeg, 1)}°`, hmin(r!.totals.walkMin)]);
  } else if (noPath) legs.rows.push([`No leg: no path under ${c.maxSlopeDeg}°`, 'none', 'none', 'none', 'none']);
  else legs.rows.push([mock('Outbound'), mock(), mock(), mock(), mock()], [mock('Return'), mock(), mock(), mock(), mock()]);

  /* 4 calculations */
  const calcs: Calc[] = [];
  if (has) {
    const t = r!.totals;
    calcs.push({ n: '4.1', title: 'Walking speed and EVA duration (Tobler 1993, scaled for a suited crew)', lines: walkingCalc(r!, c) });
    calcs.push({ n: '4.2', title: 'Suit battery', lines: batteryCalc(c.suitPowerW, t.evaMin, c.batteryWh, c.batteryReservePct).lines });
    const k = climbLine(c.crewMassKg, t.ascentM);
    if (k) calcs.push({ n: '4.3', title: 'Mechanical work of climbing (lower bound on effort)', lines: [k.replace('climb work', 'W')] });
    calcs.push({ n: `4.${calcs.length + 1}`, title: 'Comms line of sight with planetary curvature', lines: commsCalc(r!, o!.comms, i.base, o!.mastM) });
    calcs.push({ n: `4.${calcs.length + 1}`, title: 'Sun position (NASA GISS Mars24, Allison and McEwen 2000)', lines: sunCalc(r!, o!) });
  } else if (noPath) {
    calcs.push({ n: '4.1', title: 'Route search', lines: [
      `A* on a ${r!.gridResM} m grid: every cell on a path, both endpoints included, and every edge must be at or under ${c.maxSlopeDeg}°`,
      ...(r!.targetSlopeDeg != null ? [`target cell steepest 20 m slope = ${fmt(r!.targetSlopeDeg, 1)}° vs limit ${c.maxSlopeDeg}°  ${r!.targetSlopeDeg > c.maxSlopeDeg ? 'fail' : 'pass'}`] : []),
      r!.minFeasibleSlopeDeg ? `re-run at 1° steps: smallest limit with a path both ways = ${r!.minFeasibleSlopeDeg}°` : 'no path both ways at any limit up to 45°',
      'walking time, battery, comms and sun are not computed: there is no route to walk',
    ] });
  } else {
    calcs.push({ n: '4.1', title: 'Route calculations', lines: ['Mock: no route was planned, so walking time, battery, comms and sun are not computed.'], note: 'Mock' });
  }
  const e = i.earth ? earthCalc(i.earth.rangeAu, i.earth.minutes) : null;
  calcs.push(e ? { n: `4.${calcs.length + 1}`, title: 'Earth link (NASA JPL Horizons)', lines: e } : { n: `4.${calcs.length + 1}`, title: 'Earth link (NASA JPL Horizons)', lines: ['Mock: Horizons data not loaded in this session.'], note: 'Mock' });
  if (!e) mocks.push('Earth light delay is Mock: the Horizons table did not load.');
  if (i.landing) calcs.push({ n: `4.${calcs.length + 1}`, title: `Landing criteria at ${llStr(i.landing.site, 3)}`, lines: i.landing.criteria.map((k) => degSign(`${k.label}: ${k.value == null ? 'no data' : `${fmt(k.value, 2)} ${k.unit}`.trim()} vs limit ${k.limit}  ${k.result}`)) });
  if (i.scenario) {
    const s = i.scenario, ok = Math.round((s.okPercent / 100) * s.samples);
    calcs.push({ n: `4.${calcs.length + 1}`, title: 'Landing Monte Carlo', lines: [
      `ellipse ${ellipseText(s.ellipse)}; dispersion: truncated 2-D Gaussian, 3σ = semi-axes, azimuth ${s.ellipse.azimuthDeg}°`,
      `ok fraction = N_ok ÷ N = ${fmt(ok, 0)} ÷ ${fmt(s.samples, 0)} = ${fmt(s.okPercent, 1)} %  at or under ${s.maxSlopeDeg}°`,
      `slope p50 ${s.slopeP50Deg ?? 'n/a'}°, p95 ${s.slopeP95Deg ?? 'n/a'}°, terrain ${s.terrainModel}, engine ${s.engine}`,
    ] });
  }

  /* 5 rules */
  const rules: Table = { head: ['Check', 'Rule', 'Source', 'Status'], rows: [] };
  const ruleRow = (id: string, check: string, rule: string, src: string): Val[] => {
    const it = item(id);
    return [check, rule, src, it ? { text: it.status, status: st(it.status) } : mock('n/a')];
  };
  rules.rows.push(
    ruleRow('slope', 'Slope', `every edge and cell <= limit; caution at ${SLOPE_CAUTION_FRACTION * 100} % of it`, 'CTX DEM, Horn slope'),
    ruleRow('battery', 'Battery', `left >= reserve; caution within ${BATTERY_CAUTION_MARGIN_PCT} points`, 'assumed suit model'),
    ruleRow('eva-time', 'EVA time', `t <= limit; caution above ${EVA_CAUTION_FRACTION * 100} %`, 'user limit'),
    ruleRow('daylight', 'Daylight', `sun >= ${MIN_SUN_ELEVATION_DEG}° for the whole EVA`, 'Mars24'),
    ruleRow('comms', 'Comms', `no single shadow > ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km`, 'viewshed, assumed rule'),
    ruleRow('data', 'Data', 'every route vertex has DEM data', 'CTX DEM coverage'),
  );

  /* 6 sources */
  const sources: Table = { head: ['Dataset', 'Mission / instrument', 'Use'], rows: [
    ['JEZ CTX DTM 20 m, controlled (JPL Mars Trek)', 'MRO CTX', 'elevation, slope, routes, comms'],
    ['JEZ CTX ortho mosaic 6 m', 'MRO CTX', 'imagery'],
    ['SIM 3464 geologic map (Sun and Stack 2020)', 'USGS / NASA', 'units at stops'],
    ['Perseverance waypoints and raw images', 'Mars 2020', 'base position, validation, photos'],
    ['Horizons ephemeris', 'NASA JPL', 'Earth light time and visibility'],
    ['Mars24 sunclock algorithm', 'NASA GISS', 'local solar time and sun elevation'],
    ['Mars 2020 EDL timeline', 'NASA JPL', 'landing simulation phases'],
  ] };
  const v = i.validation;
  const valNote = v
    ? `Validation: DEM heights agree with ${v.count} Perseverance waypoints, median offset ${fmt(Math.abs(v.medianResidualM), 1)} m, mean bias ${fmt(v.meanResidualM, 1)} m, 95th percentile |difference| ${fmt(v.p95AbsResidualM, 1)} m.`
    : 'Validation: Mock, the validation table is not bundled in this build.';

  /* 7 assumptions */
  const assumptions = [
    'The 20 m DEM cannot resolve boulders or small scarps; slopes are averaged over the baseline.',
    'Walking speed, suit power and battery are stated assumptions, not a NASA EVA or life-support model.',
    'Comms uses line of sight from a mast on the habitat; mast and antenna heights are assumptions and no relay or orbiter pass is modelled.',
    'Daylight uses geometric sun elevation from Mars24; no refraction, dust opacity or terrain shading.',
    'No live weather, dust or radiation data.',
    'Feasible means feasible under this model, not certified safe.',
  ];

  /* 8 trace */
  const trace: Table = { head: ['#', 'Step', 'Kind', 'Time'], num: [3], rows: [] };
  let n = 0;
  for (const t of i.turns) {
    trace.rows.push([String(++n), `${t.origin === 'panel' ? 'Asked in the panel' : t.origin === 'map' ? 'Asked on the map' : t.origin === 'drag' ? 'Dragged on the map' : t.origin === 'lasso' ? 'Lassoed on the map' : 'Used a tool'}: ${t.question}`, 'input', new Date(t.startedAt).toISOString().slice(11, 19)]);
    for (const s of t.steps) trace.rows.push([String(++n), `${s.title}${s.text ? `: ${s.text}` : ''}`.slice(0, 140), s.kind === 'model' ? 'model' : s.kind === 'tool' ? 'tool' : 'deterministic', s.durMs != null ? stepTime(s.durMs) : s.meta ?? '']);
  }
  if (!trace.rows.length) trace.rows.push([mock('0'), mock('no agent turns yet'), mock('n/a'), mock('n/a')]);

  const title = noPath ? `EVA plan: no path to ${i.targetName ?? llStr(r!.to, 3)}, Jezero Crater` : has ? `EVA plan: base to ${i.targetName ?? llStr(r!.to, 3)}, Jezero Crater` : i.landing ? `Landing site check: ${llStr(i.landing.site, 2)}` : 'Session report, Mars';
  const subtitle = has || noPath ? `Round trip from the ${i.base?.label ?? 'base'}, prepared for surface operations review.` : 'Generated from the current HeyMars session.';
  return {
    id: reportId(i), generatedIso: iso(i.generatedAt), title, subtitle, verdict, mocks,
    byline: 'Prepared with HeyMars by Ng Yu Hang, team Ecliptical, NASA Space Apps Challenge 2026. Not affiliated with or endorsed by NASA.',
    sections: [
      { n: 1, id: 'summary', title: 'Summary and verdict', lead: lead1, tables: tables1 },
      { n: 2, id: 'inputs', title: 'Inputs and constraints', tables: [inputs] },
      { n: 3, id: 'route', title: 'Route legs', tables: [legs], notes: noPath ? ['No path stays under the slope limit in either direction, so no leg exists and nothing was drawn.'] : has ? [`A* on a ${r!.gridResM} m grid derived from the ${r!.demResM} m MRO CTX DEM; path snapped to cell centres. The GeoJSON export carries every leg with per-vertex elevation.`] : ['Mock: no route was planned in this session.'] },
      { n: 4, id: 'calculations', title: 'Calculations', tables: [], calcs },
      { n: 5, id: 'rules', title: 'Go / no-go rules', tables: [rules] },
      { n: 6, id: 'sources', title: 'Data sources and validation', tables: [sources], notes: [valNote] },
      { n: 7, id: 'assumptions', title: 'Assumptions and limits', tables: [], list: assumptions },
      { n: 8, id: 'trace', title: 'Agent trace', tables: [trace], notes: ['Arguments and results of every step are in the JSON export.'] },
    ],
  };
}

export const cellText = (v: Val) => (typeof v === 'string' ? v : v.mock ? `${v.text} (Mock)` : v.text);
