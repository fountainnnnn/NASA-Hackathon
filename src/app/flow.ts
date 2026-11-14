/**
 * The orchestrator: turns pointer events, Scout's verbs and typed questions into deterministic tool calls (no LLM)
 * or, for free text, one copilot turn. Everything Scout says is built from tool results; numbers are never typed here.
 */
import type { ChatMessage, LonLat, RouteResult, WorldPoint } from '@/lib/contracts';
import type { EdlPhase } from '@/lib/globeContracts';
import { runAgentTurn } from '@/lib/agent/runner';
import { getScenario } from '@/lib/scenario';
import { buildTimeline } from '@/components/Scenario/model';
import { computeReach, reachAreaKm2 } from '@/components/Scenario/reach';
import { landingDurationS, edlEndS } from '@/components/Scenario/landing';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { insideBounds } from '@/components/Scene/pick';
import { centroid, distM, polygonAreaKm2, samplePolygon, slopeAtDem } from '@/components/Ops/demTools';
import { makeCuff } from '@/components/Ops/cuffExport';
import { evaluateRoute, nextLocalNoon, previewTone, sunElevationAt } from '@/components/Ops/routeOps';
import type { RouteOps } from '@/components/Ops/routeOps';
import { emitAsk, emitClickPoint, onAsk, onClickPoint, useCompanion } from '@/state/companion';
import { onGlobePick, useGlobeStore } from '@/state/globe';
import { useHud } from '@/state/hud';
import type { PreviewLine } from '@/state/hud';
import { usePlayback } from '@/state/playback';
import { callTool, toolDeps, UNAVAILABLE, useGlobal, useRuntime } from '@/state/services';
import { useWorld, world } from '@/state/world';
import { fmtMin } from '@/lib/scene/format';
import { lightTimeMin } from '@/lib/ops/earthLink';
import { matchVerb, V } from './verbs';

void emitClickPoint;
const C = () => useCompanion.getState();
const H = () => useHud.getState();
const rt = () => useRuntime.getState().rt;
const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const km = (m: number) => (m / 1000).toFixed(m < 10_000 ? 2 : 1);
const nf = (x: number) => x.toLocaleString('en-US');
const JEZERO_SRC = { title: 'MRO CTX DEM 20 m, JPL Mars Trek', url: 'https://trek.nasa.gov/mars/' };
const GEO_SRC = { title: 'USGS SIM 3464 geologic map', url: 'https://pubs.usgs.gov/publication/sim3464' };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

let lastGlobe: LonLat | null = null;
let history: ChatMessage[] = [];
let askBusy = false;
const opsByRoute = new Map<string, RouteOps>();
export const getOps = (id: string | null) => (id ? opsByRoute.get(id) ?? null : null);

const say = (text: string, o: { sources?: { title: string; url?: string }[]; actions?: string[]; mood?: 'idle' | 'warning' | 'drawing'; point?: LonLat; unverified?: string[] } = {}) =>
  C().say({ text, sources: o.sources, actions: o.actions, point: o.point, unverified: o.unverified }, o.mood ?? 'idle');
const busy = (label: string, mood: 'thinking' | 'drawing' = 'thinking') => { C().setBusy(true, label); C().setMood(mood); };
const fail = (e: unknown) => say(e instanceof Error ? e.message : 'That did not work.', { mood: 'warning' });

/* ------------------------------------------------------------------ globe */

const GLOBE_VERBS = [V.land, V.scenario, V.jezero];

async function onGlobeClick(p: LonLat) {
  lastGlobe = p;
  C().anchorToPoint(p);
  busy('Reading the data');
  if (!useGlobal.getState().gs) {
    say('No verified data here. The global dataset did not load.', { mood: 'warning', point: p });
    return;
  }
  try {
    const r = await callTool<{
      placeName: string | null; elevationM: number | null; slopeDeg: number | null;
      geology: { name: string; symbol: string; source: string } | null;
      layers: { id: string; label: string; value: number | null; unit: string }[];
      nearestSites: { name: string; distanceKm: number; bearingDeg: number }[];
      insideJezeroHighRes: boolean;
    }>('get_site_conditions', { lon: p.lon, lat: p.lat });
    const man = useGlobal.getState().gs?.manifest();
    const head = r.geology ? r.geology.name : r.placeName ?? 'No mapped geologic unit here';
    const lines: string[] = [];
    lines.push(`${r.elevationM == null ? 'No elevation data' : `Elevation ${nf(r.elevationM)} m`}${r.slopeDeg == null ? '' : `, regional slope ${r.slopeDeg} deg`}${r.placeName && r.geology ? `, near ${r.placeName}` : ''}.`);
    const h2 = r.layers.find((l) => l.id === 'hydrogen' && l.value != null), ti = r.layers.find((l) => l.id === 'thermalInertia' && l.value != null);
    const lay = [h2 && `Hydrogen ${h2.value} wt% water equivalent`, ti && `thermal inertia ${ti.value} tiu`].filter(Boolean);
    if (lay.length) lines.push(`${lay.join(', ')}.`);
    const n = r.nearestSites[0];
    if (n) lines.push(`Nearest site: ${n.name}, ${nf(n.distanceKm)} km ${compass(n.bearingDeg)}.`);
    const sources: { title: string; url?: string }[] = [{ title: 'MGS MOLA topography', url: man?.dem.sourceUrl }];
    if (r.geology) sources.push({ title: 'USGS SIM 3292', url: man?.geology?.url });
    say([head, ...lines.slice(0, 3)].join('\n'), { sources, actions: GLOBE_VERBS, point: p });
  } catch (e) { fail(e); }
}

async function landHere() {
  const p = lastGlobe; if (!p) { say('Click the planet first.'); return; }
  busy('Checking landing criteria');
  try {
    const r = await callTool<{
      verdict: string; caveat: string;
      criteria: { label: string; value: number | null; unit: string; limit: string; result: string; sourceTitle: string; sourceUrl: string }[];
    }>('check_landing_site', { lon: p.lon, lat: p.lat });
    const fails = r.criteria.filter((c) => c.result === 'fail');
    const none = r.criteria.filter((c) => c.result === 'no data');
    const head = r.verdict === 'meets-all' ? 'Meets every landing criterion' : r.verdict === 'fails-some' ? `Fails ${fails.length === 1 ? 'one criterion' : `${fails.length} criteria`}` : 'Not enough data to judge';
    const show = (fails.length ? fails : r.criteria).slice(0, 3);
    const body = show.map((c) => `${c.label}: ${c.value == null ? 'no data' : `${c.value} ${c.unit}`.trim()}, limit ${c.limit}.`);
    if (!fails.length && none.length) body.splice(2, 1, `${none.length} criteria have no data.`);
    const src = (fails[0] ?? r.criteria[0]);
    say([head, ...body].join('\n'), {
      sources: src ? [{ title: src.sourceTitle, url: src.sourceUrl }] : [], mood: r.verdict === 'meets-all' ? 'idle' : 'warning', point: p,
      actions: [V.scenario, V.edl, V.jezero],
    });
  } catch (e) { fail(e); }
}

function syncScatter() {
  const g = useGlobeStore.getState();
  for (const ref of g.scatterShown) {
    if (g.scatter[ref.scenarioId]) continue;
    const rec = getScenario(ref.scenarioId);
    if (rec) g.setScatter(ref.scenarioId, rec.result.points, rec.request.maxSlopeDeg);
  }
}

function playLanding(scenarioId: string, phases: EdlPhase[]) {
  usePlayback.getState().load({ scenarioId: `landing-${scenarioId}`, kind: 'landing', durationS: landingDurationS(phases), autoplay: true, speed: 60 });
}

async function runScenario() {
  const p = lastGlobe; if (!p) { say('Click the planet first.'); return; }
  busy('Running 10,000 simulated touchdowns', 'drawing');
  try {
    const r = await callTool<{
      scenarioId: string; samples: number; maxSlopeDeg: number; okPercent: number; slopeP50Deg: number | null; slopeP95Deg: number | null;
      terrainModel: string; engine: string; ellipse: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number }; note: string;
    }>('run_landing_scenario', { lon: p.lon, lat: p.lat, samples: 10000, maxSlopeDeg: 15 });
    const rec = getScenario(r.scenarioId);
    const phases = useGlobal.getState().gs?.edlPhases() ?? [];
    if (rec && phases.length) {
      useGlobeStore.getState().clearScatter(r.scenarioId); // the playback reveals the touchdowns itself
      H().patch({ landing: { scenarioId: r.scenarioId, site: p, maxSlopeDeg: r.maxSlopeDeg, ellipse: r.ellipse }, edl: true });
      playLanding(r.scenarioId, phases);
    } else syncScatter();
    const coarse = /global/i.test(r.terrainModel);
    say([
      `${r.okPercent}% land under ${r.maxSlopeDeg} deg`,
      `${nf(r.samples)} simulated touchdowns. Median slope ${r.slopeP50Deg ?? 'n/a'} deg, 95th percentile ${r.slopeP95Deg ?? 'n/a'} deg.`,
      coarse ? 'Coarse global terrain, so this is optimistic.' : `Terrain: ${r.terrainModel}.`,
      'The slope limit is an assumption.',
    ].join('\n'), { sources: [{ title: r.terrainModel }, { title: `engine: ${r.engine}` }], mood: r.okPercent >= 80 ? 'drawing' : 'warning', actions: [V.edl, V.jezero], point: p });
  } catch (e) { fail(e); }
}

async function showEdl() {
  const p = lastGlobe; if (!p) { say('Click the planet first.'); return; }
  busy('Reading the EDL timeline');
  try {
    const r = await callTool<{ phases: { label: string; tStartS: number; tEndS: number; sourceTitle: string; sourceUrl: string }[] }>('show_edl_timeline', { lon: p.lon, lat: p.lat });
    const phases = useGlobal.getState().gs?.edlPhases() ?? [];
    const h = H();
    if (h.landing && phases.length) playLanding(h.landing.scenarioId, phases);
    const end = r.phases.reduce((m, x) => Math.max(m, x.tEndS), 0);
    const pick = [r.phases[0], r.phases[Math.floor(r.phases.length / 2)], r.phases[r.phases.length - 1]].filter(Boolean);
    say([`${r1(end / 60)} min from entry to touchdown`, ...pick.map((x) => `${x.label} at ${x.tStartS} s.`)].join('\n'), {
      sources: r.phases[0] ? [{ title: r.phases[0].sourceTitle, url: r.phases[0].sourceUrl }] : [], actions: h.landing ? [V.jezero] : [V.scenario, V.jezero], point: p,
    });
  } catch (e) { fail(e); }
}

function goJezero() {
  busy('Falling to Jezero');
  useGlobeStore.getState().applyGlobeCommands([{ type: 'enter_jezero' }]);
}

/* ------------------------------------------------------------------ jezero */

const JEZERO_VERBS = [V.walkHere, V.limits];

async function onJezeroClick(p: LonLat) {
  C().anchorToPoint(p);
  const r = rt();
  if (!r) return;
  if (!insideBounds(useWorld.getState().bounds, p.lon, p.lat)) {
    say('Outside the 20 m terrain\nRoutes need the high-resolution Jezero area. Pick a point inside it.', { mood: 'warning', point: p, actions: [V.back] });
    return;
  }
  busy('Reading the ground');
  try {
    const [ctx, ana] = await Promise.all([
      callTool<{ geology: { name: string; symbol: string } | null; namedFeaturesNear: { name: string; distanceKm: number }[]; elevationM: number | null }>('get_location_context', { target: 'selected' }),
      callTool<{ slopeMeanDeg: number; slopeP90Deg: number; pctAboveLimit: number; limitDeg: number; radiusM: number }>('analyze_terrain', { target: 'selected', radiusM: 250 }),
    ]);
    const head = ana.pctAboveLimit >= 50 ? 'Mostly too steep to walk' : ana.pctAboveLimit >= 10 ? 'Partly too steep to walk' : 'Walkable ground';
    const n = ctx.namedFeaturesNear[0];
    const earth = useGlobal.getState().earth ? lightTimeMin(Date.now(), useGlobal.getState().earth!) : null;
    const lines = [
      `${ana.pctAboveLimit}% is over the ${ana.limitDeg} deg limit. Mean slope ${ana.slopeMeanDeg} deg, 90th percentile ${ana.slopeP90Deg} deg within ${ana.radiusM} m.`,
      `${ctx.geology ? `${ctx.geology.name} (${ctx.geology.symbol})` : 'No mapped geologic unit here'}${n ? `, ${n.name} is ${n.distanceKm} km away` : ''}.`,
    ];
    if (earth != null) lines.push(`Earth is ${r1(earth)} light-minutes away.`);
    say([head, ...lines].join('\n'), { sources: [JEZERO_SRC, GEO_SRC, ...(earth != null ? [{ title: 'JPL Horizons', url: 'https://ssd.jpl.nasa.gov/horizons/' }] : [])].slice(0, ctx.geology ? 3 : 2), actions: JEZERO_VERBS, point: p });
  } catch (e) { fail(e); }
}

/* ------------------------------------------------------------------ routes */

function pt(p: LonLat, label: string): WorldPoint { return world.makePoint(p.lon, p.lat, 'pick', label); }
const hm = (min: number) => fmtMin(min);

function routeVerbs(ops: RouteOps | null, page = 0): string[] {
  const daylight = ops?.goNoGo.items.find((i) => i.id === 'daylight' && i.status === 'no-go');
  if (page === 1) return [V.rover, V.reach, V.back, V.less];
  return [daylight ? V.noon : V.walk, V.helmet, V.cuff, V.more];
}

let planSeq = 0;
/** Round trip a to b with the current limits; commits it, draws it and has Scout say the verdict. */
export async function commitPlan(from: LonLat, to: LonLat) {
  const r = rt(); if (!r?.terrain) return;
  const seq = ++planSeq;
  C().anchorToPoint(to);
  busy('Solving the round trip', 'drawing');
  try {
    const c = useWorld.getState().constraints;
    const res = await r.terrain.planRoute({ from, to, roundTrip: true, constraints: c });
    if (seq !== planSeq) return;
    const route = world.addRoute({ ...res, label: `Round trip to ${to.lat.toFixed(3)}, ${to.lon.toFixed(3)}`, from: pt(from, 'Start'), to: pt(to, 'Target') });
    world.applyCommands([{ type: 'clear_annotations' }, { type: 'draw_route', routeId: route.id, style: 'primary' }]);
    useWalkUi.getState().setHelmet(false);
    H().patch({ activeRouteId: route.id, walkOn: false, reachOn: false, verbPage: 0, cuff: null, sheet: H().sheet === 'cuff' ? null : H().sheet });
    usePlayback.getState().load({ scenarioId: route.id, kind: 'walk', durationS: 0 });
    const ops = evaluateRoute(route, r.dem, world.snapshot().base, H().startUtcMs, c);
    opsByRoute.set(route.id, ops);
    H().patch({ verdict: ops.verdict });
    const t = route.totals;
    const left = r1(100 - t.batteryUsedPct);
    const sun = sunElevationAt(from, ops.startUtcMs, 0);
    void sun;
    const lines = route.legs.length
      ? [
        `${km(t.lengthM)} km round trip, ${hm(t.evaMin)} including ${c.dwellMin} min at the target.`,
        `Battery ends at ${left}% against a ${c.batteryReservePct}% reserve. Max slope ${r1(t.maxSlopeDeg)} deg.`,
      ] : [`Limit: ${c.maxSlopeDeg} deg. Raise it or pick another target.`];
    const sources = [JEZERO_SRC];
    say([ops.headline, ops.verdict.reason, ...lines].join('\n'), {
      sources, point: to, mood: ops.verdict.tone === 'go' ? 'drawing' : 'warning',
      actions: route.legs.length ? routeVerbs(ops) : [V.limits, V.back],
    });
  } catch (e) { fail(e); }
}

let previewSeq = 0, previewBusy = false, pending: [LonLat, LonLat, { x: number; y: number }] | null = null;
export function requestPreview(from: LonLat, to: LonLat, at: { x: number; y: number }) {
  pending = [from, to, at];
  if (!previewBusy) void drainPreview();
}
async function drainPreview() {
  const r = rt(); if (!r?.terrain) return;
  previewBusy = true;
  while (pending) {
    const [from, to, at] = pending; pending = null;
    const seq = ++previewSeq;
    try {
      const c = useWorld.getState().constraints;
      const res = await r.terrain.planRoute({ from, to, roundTrip: false, constraints: { ...c, objective: 'shortest' } });
      if (seq !== previewSeq) continue;
      const pts = res.legs[0]?.path ?? [];
      const tone = previewTone(res, c);
      const eva = 2 * res.totals.walkMin + c.dwellMin;
      const line: PreviewLine = {
        points: pts.length > 1 ? pts : [{ ...from, h: 0 }, { ...to, h: 0 }], tone, at,
        label: res.feasible ? `${km(res.totals.lengthM)} km  ${hm(eva)} round trip` : 'no path under the limit',
      };
      H().patch({ preview: line });
    } catch { /* a failed preview just keeps the last line */ }
  }
  previewBusy = false;
}
export function clearPreview() { pending = null; previewSeq++; H().patch({ preview: null }); }

async function walkHere() {
  const sel = useWorld.getState().selected, base = world.snapshot().base;
  if (!sel || !base) { say('Click the ground first.'); return; }
  await commitPlan({ lon: base.lon, lat: base.lat }, { lon: sel.lon, lat: sel.lat });
}

/* ------------------------------------------------------------------ lasso */

export async function lassoAnalyze(poly: LonLat[], areaKm2: number) {
  const r = rt(); if (!r) return;
  const c = useWorld.getState().constraints;
  const c0 = centroid(poly);
  C().anchorToPoint(c0);
  busy('Reading the area');
  await new Promise((res) => setTimeout(res, 0));
  const samples = samplePolygon(poly, 30);
  const slopes = samples.map((s) => slopeAtDem(r.dem, s.lon, s.lat)).filter((x): x is number => x != null);
  if (!slopes.length) { say('No terrain data in that area.', { mood: 'warning', point: c0 }); return; }
  const over = slopes.filter((s) => s > c.maxSlopeDeg).length / slopes.length * 100;
  const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
  const sorted = [...slopes].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)];
  const units = new Map<string, number>();
  for (const s of samples) { const g = r.science.geologyAt(s); if (g) units.set(g.name, (units.get(g.name) ?? 0) + 1); }
  const top = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
  const stops = (['delta-sediments', 'astrobiology-samples', 'crater-floor', 'rim-bedrock', 'aeolian'] as const)
    .flatMap((o) => r.science.suggestStops(o, c0, Math.max(1, Math.sqrt(areaKm2)), 12))
    .filter((s) => poly.length > 2 && pointIn(s, poly));
  const stop = stops[0];
  const lines = [
    `Mean slope ${r1(mean)} deg, 90th percentile ${r1(p90)} deg over ${areaKm2.toFixed(2)} km2.`,
    top ? `Mostly ${top[0]} (${r0((top[1] / samples.length) * 100)}% of the area).` : 'No mapped geologic unit inside.',
    stop ? `Best science stop inside: ${stop.label}.` : 'No catalogued science stop inside.',
  ];
  say([`${r0(over)}% is over the ${c.maxSlopeDeg} deg limit`, ...lines].join('\n'), {
    sources: [JEZERO_SRC, GEO_SRC], point: c0, mood: over >= 50 ? 'warning' : 'idle', actions: stop ? [LASSO_WALK] : [],
  });
  lassoStop = stop ? { lon: stop.lon, lat: stop.lat } : null;
}
const LASSO_WALK = 'Walk to the stop';
let lassoStop: { lon: number; lat: number } | null = null;
function pointIn(p: LonLat, poly: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
void distM; void polygonAreaKm2;

/* ------------------------------------------------------------------ scenario verbs */

function activeRoute(): RouteResult | null {
  const id = H().activeRouteId;
  return id ? useWorld.getState().routes[id] ?? null : null;
}
function timelineNow() {
  const route = activeRoute(), r = rt();
  if (!route || !r || !route.legs.length) return null;
  return buildTimeline(route, { toLocal: (lon, lat) => r.geo.toLocal(r.meta, lon, lat) }, { roverFraction: useWalkUi.getState().roverFraction });
}
function startWalk() {
  const tl = timelineNow();
  if (!tl) { say('Drag on the ground to plan a walk first.'); return null; }
  H().patch({ walkOn: true });
  usePlayback.getState().load({ scenarioId: tl.routeId, kind: useWalkUi.getState().roverFraction > 0 ? 'rover-walk' : 'walk', durationS: tl.durationS, autoplay: true, speed: 60 });
  return tl;
}

function walkIt() {
  const tl = startWalk(); if (!tl) return;
  C().closeBubble();
  if (tl.turnBack) {
    C().anchorToPoint(tl.turnBack.v);
    say(`Turn back at ${hm(tl.turnBack.tS / 60)}\nThe reserve is reached on the way out.`, { mood: 'warning', point: tl.turnBack.v, actions: [V.helmet, V.rover] });
  }
}
function helmet() {
  if (!startWalk()) return;
  useWalkUi.getState().setHelmet(true);
  C().closeBubble();
}
function rover() {
  useWalkUi.getState().setRoverFraction(0.5);
  const tl = startWalk(); if (!tl) return;
  const s = tl.summary;
  say([
    `Rover saves ${hm(Math.max(0, s.walkOnlyEvaMin - s.evaMin))}`,
    `On foot: ${hm(s.walkOnlyEvaMin)}, ${r0(s.walkOnlyBatteryPct)}% battery. With the rover: ${hm(s.evaMin)}, ${r0(s.batteryUsedPct)}%.`,
    'The rover speed is an assumption, 10 km/h.',
  ].join('\n'), { sources: [{ title: 'Route model with assumed rover speed' }], actions: routeVerbs(getOps(H().activeRouteId), 1), point: tl.roverDropoff ?? undefined });
}

async function reach() {
  const r = rt(), base = world.snapshot().base; if (!r?.terrain || !base) return;
  const centre = { lon: base.lon, lat: base.lat };
  H().patch({ reachOn: true, reach: null, reachProgress: '0 of 24 plans' });
  world.applyCommands([{ type: 'focus_camera', lon: centre.lon, lat: centre.lat, distanceM: 7000 }]);
  C().closeBubble();
  const c = useWorld.getState().constraints;
  const plan = async (from: LonLat, to: LonLat): Promise<RouteResult> => {
    const res = await r.terrain!.planRoute({ from, to, roundTrip: true, constraints: { ...c, objective: 'shortest' } });
    return { ...res, id: 'reach', label: 'reach', from: pt(from, 'Base'), to: pt(to, 'Frontier') };
  };
  const res = await computeReach({
    center: centre, planRoundTrip: plan, maxRadiusM: 4000, bearings: 24,
    onProgress: (d, t, partial) => H().patch({ reachProgress: `${d} of ${t} plans`, reach: { center: centre, maxRadiusM: 4000, samples: partial, plans: d, cancelled: false, ms: 0 } }),
  });
  H().patch({ reach: res, reachProgress: null });
  const area = reachAreaKm2(res.samples);
  const far = res.samples.length ? Math.max(...res.samples.map((s) => s.radiusM)) : 0;
  say(`Home within ${area.toFixed(1)} km2\nUp to ${km(far)} km out. Contours are minutes of reserve at turn-back.`, {
    sources: [{ title: 'Route model with assumed suit power and battery' }], actions: routeVerbs(getOps(H().activeRouteId), 1), point: centre,
  });
}

function cuff() {
  const route = activeRoute(), ops = getOps(H().activeRouteId);
  if (!route || !ops) { say('Drag on the ground to plan a walk first.'); return; }
  const view = makeCuff(route, ops.comms, ops.startUtcMs);
  H().patch({ cuff: view, sheet: 'cuff' });
  say(`Cuff card ready\n${view.turnBack ?? 'It lists every turn with a time and battery level.'}`, { actions: routeVerbs(ops), mood: 'idle', point: route.to });
}

function localNoon() {
  const route = activeRoute(), r = rt(); if (!route || !r) return;
  const noon = nextLocalNoon(route.from, Date.now());
  H().patch({ startUtcMs: noon - (route.totals.evaMin / 2) * 60_000 });
  const ops = evaluateRoute(route, r.dem, world.snapshot().base, H().startUtcMs, route.constraintsUsed);
  opsByRoute.set(route.id, ops);
  H().patch({ verdict: ops.verdict });
  say(`${ops.headline}\n${ops.verdict.reason}\nThe walk is centred on local noon, local solar time ${ops.ltst} at the start.`, {
    mood: ops.verdict.tone === 'go' ? 'drawing' : 'warning', actions: routeVerbs(ops), point: route.to,
  });
}

function back() {
  useGlobeStore.getState().applyGlobeCommands([{ type: 'exit_jezero' }]);
}

function setPage(p: 0 | 1) {
  H().patch({ verbPage: p });
  C().setActions(routeVerbs(getOps(H().activeRouteId), p));
}

/* ------------------------------------------------------------------ ask */

async function askCopilot(text: string) {
  if (askBusy) return;
  askBusy = true;
  busy('Thinking');
  try {
    const res = await runAgentTurn({
      userText: text, history, deps: toolDeps(),
      onTrace: (steps) => { const last = steps[steps.length - 1]; if (last) C().setBusy(true, last.label); },
    });
    history = res.history;
    syncScatter();
    say(res.text || UNAVAILABLE, { unverified: res.unverifiedNumbers, mood: res.text ? 'idle' : 'warning' });
  } catch {
    say(UNAVAILABLE, { mood: 'warning' });
  } finally { askBusy = false; }
}

function dispatch(text: string) {
  const v = matchVerb(text);
  if (!v) {
    if (lassoStop && text === LASSO_WALK) { void commitPlan(world.snapshot().base ?? lassoStop, lassoStop); return; }
    void askCopilot(text); return;
  }
  const mode = useGlobeStore.getState().mode;
  switch (v) {
    case V.land: return void landHere();
    case V.scenario: return void runScenario();
    case V.edl: return void showEdl();
    case V.jezero: return goJezero();
    case V.limits: H().setPopover('limits'); return;
    case V.walkHere: return void walkHere();
    case V.walk: return walkIt();
    case V.helmet: return helmet();
    case V.rover: return rover();
    case V.reach: return void reach();
    case V.cuff: return cuff();
    case V.noon: return localNoon();
    case V.back: return back();
    case V.more: return setPage(1);
    case V.less: return setPage(0);
  }
  void mode;
}

/* ------------------------------------------------------------------ wiring */

/** Subscribe everything. Returns one cleanup function. */
export function startFlow(): () => void {
  const offs: (() => void)[] = [];
  offs.push(onGlobePick((p) => { if (p.kind === 'click' && useGlobeStore.getState().mode === 'globe') void onGlobeClick(p); }));
  offs.push(onClickPoint((p) => { if (useGlobeStore.getState().mode === 'jezero') void onJezeroClick(p); }));
  offs.push(onAsk(dispatch));
  offs.push(useGlobeStore.subscribe((s, prev) => {
    if (s.mode === prev.mode) return;
    C().closeBubble(); C().setMode(s.mode);
    if (s.mode === 'globe') {
      useWalkUi.getState().setHelmet(false);
      H().patch({ walkOn: false, reachOn: false, preview: null, verdict: null, cuff: null, popover: null, activeRouteId: null });
      usePlayback.getState().load({ scenarioId: 'idle', kind: 'walk', durationS: 0 });
    } else {
      world.setSelected(null);
      H().patch({ landing: null, edl: false, popover: null });
      // settle the camera on the base once the scene has mounted
      window.setTimeout(() => {
        const b = world.snapshot().base;
        if (b) world.applyCommands([{ type: 'focus_camera', lon: b.lon, lat: b.lat, distanceM: 9000 }]);
      }, 900);
      usePlayback.getState().load({ scenarioId: 'idle', kind: 'walk', durationS: 0 });
    }
  }));
  offs.push(useGlobeStore.subscribe((s, prev) => { if (s.scatterShown !== prev.scatterShown) syncScatter(); }));
  // changing a limit replans the route Scout is talking about
  let timer = 0;
  offs.push(useWorld.subscribe((s, prev) => {
    if (s.constraints === prev.constraints) return;
    const route = activeRoute();
    if (!route || !route.legs.length) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void commitPlan(route.from, route.to), 450);
  }));
  void edlEndS;
  return () => { offs.forEach((f) => f()); window.clearTimeout(timer); };
}

export { emitAsk };
