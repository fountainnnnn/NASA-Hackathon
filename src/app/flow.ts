/**
 * The orchestrator. Every pointer action, rail tool, card button and typed or spoken question becomes ONE MarsAgent turn
 * in the shared thread (src/state/thread.ts): it streams first-person narration lines while it works, records the steps
 * it took with the real numbers substituted into each formula, and ends with an answer, a compact map card and, when the
 * plan changed, a report card. Verbs and maths follow-ups run fixed code (no LLM); other free text goes to the model.
 * Numbers are never typed here: they come from tool results, the route solver, the ops checks or Mars24 / Horizons.
 */
import type { ChatMessage, LonLat, RouteResult, RoverImage, WorldPoint } from '@/lib/contracts';
import { cameraRank, selectImages } from '@/lib/science/rover';
import { runAgentTurn, describeToolCall, setAgentObserver } from '@/lib/agent/runner';
import {
  batteryCalc, commsCalc, daylightMargin, degSign, earthCalc, explainTool, fmt, hmin, kmStr, llStr, routeRows, routeSteps, sunCalc, walkingCalc, SRC,
} from '@/lib/agent/explain';
import { getScenario, onScenarioEnd, type ScenarioOutcome } from '@/lib/scenario';
import { buildTimeline, PAIR_SEPARATION_M } from '@/components/Scenario/model';
import { computeReach, reachAreaKm2 } from '@/components/Scenario/reach';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { insideBounds } from '@/components/Scene/pick';
import { centroid, pointInPolygon, samplePolygon, slopeAtDem } from '@/components/Ops/demTools';
import { makeCuff } from '@/components/Ops/cuffExport';
import { evaluateRoute, ltstAt, nextLocalNoon, previewTone } from '@/components/Ops/routeOps';
import { daylightLeftMin } from '@/lib/ops/lighting';
import type { RouteOps } from '@/components/Ops/routeOps';
import { startLandingSimulation, stopLandingSimulation } from '@/components/Planet';
import { onAsk, onClickPoint, useCompanion, type AskMeta } from '@/state/companion';
import { onGlobePick, useGlobeStore } from '@/state/globe';
import { LANDING_TOUCHDOWN_LTST_H, MAST_RANGE_M, landingStartUtcMs, useHud } from '@/state/hud';
import type { PreviewLine } from '@/state/hud';
import { formatMissionTime, usePlayback } from '@/state/playback';
import { callTool, toolDeps, useGlobal, useRuntime } from '@/state/services';
import { mockElevation } from '@/lib/globalSci/fill';
import { useSession } from '@/state/session';
import { useShell } from '@/state/shell';
import { narrator, useThread, type Answer, type Ask, type CardAction, type GroundView, type MapCard, type Narrator, type Row, type ScienceNote, type Tone } from '@/state/thread';
import { whenRevealed } from '@/components/Companion/reveal';
import { ellipseText } from '@/lib/report/build';
import { useWorld, world } from '@/state/world';
import { earthRangeAu, lightTimeMin } from '@/lib/ops/earthLink';
import { COMMS_NOGO_SHADOW_M, MIN_SUN_ELEVATION_DEG, SUIT_ANTENNA_HEIGHT_M } from '@/lib/ops/assumptions';
import { pairSightAlongRoute } from '@/lib/ops/viewshed';
import { getOps, setOps } from './opsCache';
import { jezeroDepth, projectJezero } from '@/components/Ops/projector';
import { offsetLonLat } from '@/components/Scenario/reach';
import { matchVerb, V } from './verbs';

export { getOps };

const C = () => useCompanion.getState();
const H = () => useHud.getState();
const rt = () => useRuntime.getState().rt;
const nf = (x: number) => x.toLocaleString('en-US');
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const ll2 = (p: LonLat) => llStr(p, 2);
const ms = (t0: number) => `${Math.max(0, Math.round(performance.now() - t0))} ms`;
const clock = () => new Date().toISOString().slice(11, 19);
/** Walk minutes as "01:05" (hours and minutes since the EVA start), for T+ marks. */
const clockHm = (min: number) => { const m = Math.max(0, Math.round(min)); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

let lastGlobe: LonLat | null = null;
let history: ChatMessage[] = [];
let askBusy = false;
let lassoStop: LonLat | null = null;

/* ------------------------------------------------------------------ turn helpers */

/** Start a turn. The map card opens at `point` for questions asked on the map (panel questions keep the map clear while they work). */
function begin(ask: Ask, o: { point?: LonLat | null; engine?: string; card?: boolean } = {}): Narrator {
  const point = o.point ?? ask.at ?? null;
  const showCard = o.card !== false && ask.origin !== 'panel' && !!point;
  const id = useThread.getState().begin(ask, { engine: o.engine, point, showCard });
  if (showCard && point) { C().anchorToPoint(point); C().openBubble(); }
  C().setBusy(true, null); C().setMood('thinking');
  return narrator(id);
}

/** Finish a turn. A card with a point is shown on the map (synced), unless `card: false`. */
function end(n: Narrator, p: { text: string; why?: Answer['why']; lead?: Answer['lead']; rows?: Row[]; card?: MapCard; report?: boolean; recompute?: { title: string; code: string[] }; unverified?: string[]; science?: ScienceNote | null; mood?: 'idle' | 'warning' | 'drawing'; status?: 'done' | 'error' }) {
  n.finish({ answer: { text: p.text, why: p.why ?? null, lead: p.lead ?? null, rows: p.rows, unverified: p.unverified, science: p.science ?? null }, card: p.card, report: p.report, recompute: p.recompute, status: p.status });
  C().setBusy(false, null);
  C().setMood(p.mood ?? 'idle');
  if (p.card) {
    useThread.getState().openCard(n.id);
    C().anchorToPoint(p.card.point);
    C().openBubble();
  }
}

function failTurn(n: Narrator, e: unknown) {
  const msg = e instanceof Error ? e.message : 'That did not work.';
  n.say(msg).fail();
  end(n, { text: msg, mood: 'warning', status: 'error' });
}

const card = (c: Omit<MapCard, 'actions'> & { actions?: CardAction[] }): MapCard => ({ actions: [], ...c });
const act = (label: string, icon: string, verb = label): CardAction => ({ label, icon, verb });

function earthNow(): { rangeAu: number | null; minutes: number | null } | null {
  const e = useGlobal.getState().earth;
  if (!e) return null;
  try { return { rangeAu: earthRangeAu(Date.now(), e), minutes: lightTimeMin(Date.now(), e) }; } catch { return null; }
}

/* ------------------------------------------------------------------ globe */

/** Card labels and units stay short; the full criterion, its limit and source go in the row tooltip and the panel. */
const shortLabel = (l: string) => { const t = l.replace(/\s*\(.*?\)\s*/g, ' ').replace(/^Landing-site /, '').replace(/ length scale$/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
function shortUnit(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^deg|°/.test(t)) return '°';
  if (/J m-2|thermal inertia/i.test(t)) return ' tiu';
  if (/^%/.test(t)) return ' %';
  return t.length > 8 ? '' : ` ${t}`;
}

/** Small suffix on a filled value: " est." (derived from real data) or " mock" (deterministic placeholder). */
const provTag = (p?: string) => (p === 'estimate' ? ' est.' : p === 'mock' ? ' mock' : '');

async function onGlobeClick(p: LonLat) {
  lastGlobe = p;
  useSession.getState().patch({ site: p, place: ll2(p), region: null });
  const n = begin({ text: 'What is here?', origin: 'map', at: p });
  if (!useGlobal.getState().gs) {
    n.say('Reading the global data at your cursor').fail('The global dataset did not load, so there is no verified data here');
    end(n, { text: 'The global dataset did not load. Reload the page to try again.', mood: 'warning', status: 'error' });
    return;
  }
  try {
    const t0 = performance.now();
    const r = await n.run('Reading MOLA elevation, geology and orbital layers at your cursor', () => callTool<{
      placeName: string | null; elevationM: number | null; slopeDeg: number | null;
      geology: { name: string; symbol: string; source: string; distanceKm?: number } | null;
      layers: { id: string; label: string; value: number | null; unit: string; provenance?: string; method?: string }[];
      provenance?: { elevation?: { kind: string }; slope?: { kind: string } };
      nearestSites: { name: string; distanceKm: number; bearingDeg: number }[];
    }>('get_site_conditions', { lon: p.lon, lat: p.lat }), (r) => `Read the global layers at your cursor: elevation ${nf(r.elevationM ?? 0)} m${r.slopeDeg == null ? '' : `, regional slope ${r.slopeDeg}°`}`);
    const ex = explainTool('get_site_conditions', { lon: p.lon, lat: p.lat }, r);
    n.step({ kind: 'tool', title: 'get_site_conditions', meta: ms(t0), code: [`// global datasets sampled at ${llStr(p)}`, ...ex.kv.map(([k, v]) => `${k} = ${v}`), ...ex.calcs], sources: ex.sources, raw: { args: { lon: p.lon, lat: p.lat }, result: r } });
    if (r.geology) n.note(`Looked up the geologic unit: ${r.geology.name}${r.geology.symbol ? ` (${r.geology.symbol})` : ''}, USGS SIM 3292${r.geology.distanceKm ? `, nearest mapped unit ${r.geology.distanceKm} km away` : ''}`);
    const near = r.nearestSites[0];
    if (near) n.note(`Found the nearest catalogued site: ${near.name}, ${nf(near.distanceKm)} km ${compass(near.bearingDeg)}`);
    const head = r.geology ? `${r.geology.name}${r.geology.distanceKm ? `, ${r.geology.distanceKm} km away` : ''}` : r.placeName ?? `Plains at ${ll2(p)}`;
    const val = (id: string) => r.layers.find((l) => l.id === id && l.value != null);
    const lsrc = (l: { provenance?: string; method?: string }, s: string) => (l.provenance && l.provenance !== 'observed' ? `${l.provenance === 'mock' ? 'Mock' : 'Estimate'}: ${l.method}` : s);
    const eP = r.provenance?.elevation?.kind, sP = r.provenance?.slope?.kind;
    const rows: Row[] = [
      ...(r.elevationM == null ? [] : [{ label: 'Elevation', value: `${nf(r.elevationM)} m${provTag(eP)}`, tone: 'info' as const, src: 'MGS MOLA' }]),
      ...(r.slopeDeg == null ? [] : [{ label: 'Regional slope', value: `${r.slopeDeg}°${provTag(sP === 'computed' ? undefined : sP)}`, tone: 'info' as const, src: 'Horn slope on MOLA' }]),
      ...(val('hydrogen') ? [{ label: 'Hydrogen', value: `${val('hydrogen')!.value} wt% water${provTag(val('hydrogen')!.provenance)}`, tone: 'info' as const, src: lsrc(val('hydrogen')!, 'Odyssey GRS') }] : []),
      ...(val('thermalInertia') ? [{ label: 'Thermal inertia', value: `${val('thermalInertia')!.value} tiu${provTag(val('thermalInertia')!.provenance)}`, tone: 'info' as const, src: lsrc(val('thermalInertia')!, 'MGS TES') }] : []),
      ...(val('dust') ? [{ label: 'Dust cover index', value: `${val('dust')!.value}${provTag(val('dust')!.provenance)}`, tone: 'info' as const, src: lsrc(val('dust')!, 'MGS TES') }] : []),
      ...(near ? [{ label: 'Nearest site', value: `${near.name}, ${nf(near.distanceKm)} km ${compass(near.bearingDeg)}`, tone: 'info' as const }] : []),
    ].slice(0, 6);
    useSession.getState().patch({ region: near && near.distanceKm < 400 ? near.name : r.placeName, place: r.geology?.symbol ? `${r.geology.symbol} unit` : ll2(p) });
    const sentence = [
      `Elevation is ${nf(r.elevationM ?? 0)} m${provTag(eP)}${r.slopeDeg == null ? '' : ` with a regional slope of ${r.slopeDeg}°`}`,
      r.geology ? (r.geology.distanceKm ? `the nearest mapped unit, ${r.geology.distanceKm} km away, is ${r.geology.name}` : `the ground maps as ${r.geology.name}`) : null,
      near ? `${near.name} is ${nf(near.distanceKm)} km ${compass(near.bearingDeg)}` : null,
    ].filter(Boolean).join(', ') + '.';
    end(n, {
      text: sentence, rows: rows.slice(0, 3),
      card: card({ title: head, sub: llStr(p), rows, point: p, actions: [act(V.land, 'plane-landing'), act(V.scenario, 'play'), act(V.jezero, 'navigation')], askHint: 'Ask about this place' }),
    });
  } catch (e) { failTurn(n, e); }
}

async function landHere(meta: AskMeta) {
  const p = useGlobeStore.getState().mode === 'jezero' ? (useWorld.getState().selected ?? lastGlobe) : lastGlobe;
  const n = begin({ text: 'Could we land here?', origin: meta.origin, at: p });
  if (!p) { n.say('I need a point first: click the planet').fail(); end(n, { text: 'Click the planet first, then ask again.', mood: 'warning' }); return; }
  try {
    const t0 = performance.now();
    const r = await n.run(`Checking published landing constraints at ${ll2(p)}`, () => callTool<{
      verdict: string; caveat: string; notes?: string[]; estimated?: boolean;
      criteria: { label: string; value: number | null; unit: string; limit: string; result: string; sourceTitle: string; sourceUrl: string; provenance?: string; method?: string }[];
    }>('check_landing_site', { lon: p.lon, lat: p.lat }), (r) => `Checked ${r.criteria.length} landing criteria at ${ll2(p)}`);
    // the tool tags the site on the globe with its verdict; the tag waits until this turn is complete on screen
    const tag = useGlobeStore.getState().markers.find((m) => m.id === 'landing-marker');
    if (tag) useGlobeStore.getState().removeMarker(tag.id);
    const fails = r.criteria.filter((c) => c.result === 'fail'), est = r.criteria.filter((c) => c.provenance && c.provenance !== 'observed');
    const passN = r.criteria.length - fails.length;
    n.note(`Scored each one against its limit: ${passN} pass, ${fails.length} fail${est.length ? `, ${est.length} from estimates or mock values` : ''}`);
    if (est.length) n.step({ kind: 'calculation', title: 'Filled values', durMs: 0, code: est.map((c) => `${c.label}: ${c.provenance} (${c.method ?? 'method not given'})`), raw: est });
    const ex = explainTool('check_landing_site', { lon: p.lon, lat: p.lat }, r);
    n.step({ kind: 'tool', title: 'check_landing_site', meta: ms(t0), durMs: performance.now() - t0, code: ex.calcs, sources: ex.sources, raw: { args: { lon: p.lon, lat: p.lat }, result: r } });
    const head = `${fails.length ? `Fails ${fails.length} of ${r.criteria.length} criteria` : 'Meets every listed criterion'}${est.length ? ' (includes estimates)' : ''}`;
    const tone: Tone = fails.length ? 'nogo' : 'go';
    // the long caveat and the per-criterion notes belong in the working, not in the answer
    n.step({ kind: 'verdict', title: head, meta: fails.length ? `${fails.length} fail` : 'all pass', durMs: 0, text: r.criteria.map((c) => `${c.label.toLowerCase()} ${c.result}`).join(', '), code: [r.caveat, ...(r.notes ?? [])].filter(Boolean), tone, raw: { verdict: r.verdict, caveat: r.caveat, notes: r.notes } });
    useSession.getState().patch({ landing: { site: p, verdict: r.verdict, caveat: r.caveat, criteria: r.criteria } });
    const rows: Row[] = r.criteria.slice(0, 6).map((c) => ({ label: shortLabel(c.label), value: `${fmt(c.value ?? 0, 1)}${shortUnit(c.unit)}${provTag(c.provenance)}`, tone: c.result === 'fail' ? 'nogo' : 'go', src: degSign(`${c.label}, limit ${c.limit}. ${c.provenance && c.provenance !== 'observed' ? `${c.provenance === 'mock' ? 'Mock' : 'Estimate'}: ${c.method}. ` : ''}${c.sourceTitle}`) }));
    const f0 = fails[0];
    const counts = `${passN} of ${r.criteria.length} criteria pass${f0 ? `, and ${f0.label.toLowerCase().replace(/\s*\(.*?\)/g, '')} fails (${fmt(f0.value ?? 0, 1)}${shortUnit(f0.unit)}${provTag(f0.provenance)} against ${degSign(f0.limit)})${fails.length > 1 ? ` with ${fails.length - 1} more` : ''}` : ''}${est.length ? `${f0 ? ';' : ' and'} ${est.length} of the values are estimates or mock values, marked est. and mock` : ''}.`;
    const why: Answer['why'] = {
      word: fails.length ? 'NO GO' : 'GO', tone,
      lines: [
        f0 ? { text: `${f0.label}: ${fmt(f0.value ?? 0, 1)}${shortUnit(f0.unit)}${provTag(f0.provenance)} against ${degSign(f0.limit)}.`, step: 'check_landing_site' } : { text: `All ${r.criteria.length} criteria are within their limits.`, step: 'check_landing_site' },
        { text: `Passed: ${r.criteria.filter((c) => c.result !== 'fail').map((c) => shortLabel(c.label).toLowerCase()).slice(0, 5).join(', ')}${passN > 5 ? ` and ${passN - 5} more` : ''}.` },
        ...(f0 ? [{ text: 'A site with gentler regional slopes or lower elevation would change it; the simulation shows where touchdowns land.' }] : []),
        ...(est.length ? [{ text: `(includes estimates: ${est.length} values marked est. or mock)`, step: 'Filled values' }] : []),
      ].slice(0, 4),
    };
    end(n, {
      lead: { text: `${head}.`, tone }, why,
      text: `${counts} Limits are the Curiosity landing-site constraints (JPL, 2006), used as a reference, not the Mars 2020 requirements.`,
      rows: rows.slice(0, 4), report: true, mood: tone === 'go' ? 'idle' : 'warning',
      card: card({ title: head, sub: llStr(p), rows, point: p, actions: [act(V.scenario, 'play'), act(V.jezero, 'navigation')], askHint: 'Ask about this site' }),
    });
    if (tag) void whenRevealed(n.id).then(() => { if (lastGlobe === p) useGlobeStore.getState().applyGlobeCommands([{ type: 'globe_marker', id: tag.id, lon: tag.lon, lat: tag.lat, label: tag.label, kind: tag.kind }]); });
  } catch (e) { failTurn(n, e); }
}

async function runScenario(meta: AskMeta) {
  const p = lastGlobe;
  const n = begin({ text: 'Run landing simulation', origin: meta.origin, at: p }, { card: false });
  if (!p) { n.say('I need a landing site first: click the planet').fail(); end(n, { text: 'Click the planet first, then run the simulation.', mood: 'warning' }); return; }
  C().closeBubble();
  useGlobeStore.getState().removeMarker('landing-marker'); // the landing check's tag is out of date once a simulation starts
  try {
    // 1. the EDL timeline the lander will fly, 2. the touchdown Monte Carlo, 3. the descent on the map: in that order
    const tE = performance.now();
    const phases = await n.run('Loading the Mars 2020 entry, descent and landing timeline', () => useGlobal.getState().gs?.edlPhases() ?? [],
      (ph) => `Loaded the Mars 2020 EDL timeline: ${ph.length} phases from entry to touchdown`);
    if (phases.length) n.step({ kind: 'tool', title: 'show_edl_timeline', meta: ms(tE), durMs: performance.now() - tE, code: phases.map((x) => `${x.label}: t = ${x.tStartS} s to ${x.tEndS} s`), sources: phases[0] ? [{ title: phases[0].source.title, url: phases[0].source.url }] : [], raw: phases });
    const def = useGlobal.getState().gs?.defaultEllipse();
    const size = def ? ` ${ellipseText(def).replace(/ \(semi-axes.*$/, '')}` : '';
    const t0 = performance.now();
    const r = await n.run(`Running 10,000 seeded Monte Carlo touchdowns across the${size} ellipse`, () => callTool<{
      scenarioId: string; samples: number; maxSlopeDeg: number; okPercent: number; slopeP50Deg: number | null; slopeP95Deg: number | null; seed?: number;
      terrainModel: string; engine: string; ellipse: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number }; note: string;
      verdict?: { word: 'GO' | 'HOLD' | 'NO GO'; label: string; tone: Tone; reason: string; rule: string; estimated: boolean; calc?: string[] };
    }>('run_landing_scenario', { lon: p.lon, lat: p.lat, samples: 10000, maxSlopeDeg: 15 }), (r) => `Ran ${nf(r.samples)} touchdowns: ${r.okPercent}% land on ground under ${r.maxSlopeDeg}°`);
    const ex = explainTool('run_landing_scenario', {}, r);
    n.step({ kind: 'tool', title: 'run_landing_scenario', meta: ms(t0), durMs: performance.now() - t0, code: ex.calcs, sources: ex.sources, raw: { args: { lon: p.lon, lat: p.lat, samples: 10000, maxSlopeDeg: 15 }, result: r } });
    const rec = getScenario(r.scenarioId);
    useSession.getState().patch({ scenario: { site: p, samples: r.samples, okPercent: r.okPercent, maxSlopeDeg: r.maxSlopeDeg, slopeP50Deg: r.slopeP50Deg, slopeP95Deg: r.slopeP95Deg, terrainModel: r.terrainModel, engine: r.engine, ellipse: r.ellipse } });
    if (rec) {
      useGlobeStore.getState().clearScatter(r.scenarioId); // the simulation reveals the touchdowns itself after landing
      const touchdownS = phases.reduce((m, x) => Math.max(m, x.tEndS), 0) || 420;
      H().patch({ landing: { scenarioId: r.scenarioId, site: p, maxSlopeDeg: r.maxSlopeDeg, ellipse: r.ellipse, startUtcMs: landingStartUtcMs(p.lon, touchdownS) }, edl: true, walkOn: false });
      n.note(`Touchdown planned for ${String(LANDING_TOUCHDOWN_LTST_H).padStart(2, '0')}:00 local solar time at the site (daylight, Mars24)`);
      await n.run('Starting the descent along the EDL arc at 60× on the timeline', () => startLandingSimulation(p, { points: rec.result.points, okFraction: r.okPercent / 100 }, { maxSlopeDeg: r.maxSlopeDeg, ellipse: r.ellipse, speed: 60, caption: true }),
        () => 'Started the descent at 60× on the timeline: parachute, heat shield, powered descent, sky crane');
    }
    // a terrain cell larger than the ellipse cannot say where in the ellipse the lander touches down
    const resKm = /global/i.test(r.terrainModel) ? (useGlobal.getState().gs?.manifest()?.dem.resKm ?? null) : null;
    const minorKm = 2 * r.ellipse.semiMinorKm;
    const coarse = resKm != null && resKm >= minorKm;
    const ell = ellipseText(r.ellipse);
    // the one documented landing rule (lib/scenario/verdict.ts), returned by the tool
    const okTone: Tone = r.verdict?.tone ?? (r.okPercent >= 99 ? 'go' : r.okPercent >= 95 ? 'caution' : 'nogo');
    if (r.verdict) n.step({ kind: 'verdict', title: `Landing verdict: ${r.verdict.label}`, durMs: 0, text: r.verdict.reason, code: [r.verdict.rule, ...(r.verdict.calc ?? [])], tone: okTone, raw: r.verdict });
    const why: Answer['why'] = r.verdict ? { word: r.verdict.word, tone: okTone, lines: [
      { text: r.verdict.reason, step: 'Landing verdict' },
      { text: `Median slope ${r.slopeP50Deg ?? 0}°, 95th percentile ${r.slopeP95Deg ?? 0}°, against a ${r.maxSlopeDeg}° limit.`, step: 'run_landing_scenario' },
      { text: r.verdict.word === 'GO' ? 'A steeper site or a tighter slope limit would change it.' : 'A site with gentler ground, or a site inside Jezero on the 20 m terrain, would change it.' },
      ...(r.verdict.estimated ? [{ text: '(includes estimates: the terrain cell is wider than the ellipse)' }] : []),
    ] } : null;
    const slopes = `Median slope ${r.slopeP50Deg ?? 'n/a'}°, 95th percentile ${r.slopeP95Deg ?? 'n/a'}°.`;
    end(n, coarse ? {
      lead: { text: 'Coarse terrain only.', tone: 'info' }, why,
      text: `${nf(r.samples)} simulated touchdowns across a ${ell} ellipse. The global terrain cell is ${fmt(resKm!, 1)} km, wider than the ellipse, so the ${r.okPercent}% under ${r.maxSlopeDeg}° describes the region, not the touchdown spots. ${slopes}`,
      rows: [
        { label: 'Terrain cell, wider than the ellipse', value: `${fmt(resKm!, 1)} km`, tone: 'caution', src: r.terrainModel },
        { label: `Touchdowns under ${r.maxSlopeDeg}°`, value: `${r.okPercent} %`, tone: 'info' },
        { label: 'Median / 95th pct slope', value: `${r.slopeP50Deg ?? 'n/a'}° / ${r.slopeP95Deg ?? 'n/a'}°`, tone: 'info' },
      ],
      report: true,
    } : {
      lead: { text: `${r.okPercent}% land under ${r.maxSlopeDeg}°.`, tone: okTone }, why,
      text: `${nf(r.samples)} simulated touchdowns across a ${ell} ellipse on the ${r.terrainModel}. ${slopes} The slope limit is an assumption.`,
      rows: [
        { label: 'Touchdowns under the limit', value: `${r.okPercent} %`, tone: okTone },
        { label: 'Median / 95th pct slope', value: `${r.slopeP50Deg ?? 'n/a'}° / ${r.slopeP95Deg ?? 'n/a'}°`, tone: 'info' },
        { label: 'Terrain', value: r.terrainModel, tone: 'info' },
      ],
      report: true,
    });
  } catch (e) { failTurn(n, e); }
}

function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((res) => {
    if (pred()) { res(true); return; }
    const t0 = Date.now();
    const id = setInterval(() => { if (pred()) { clearInterval(id); res(true); } else if (Date.now() - t0 > timeoutMs) { clearInterval(id); res(false); } }, 120);
  });
}

async function goJezero(meta: AskMeta) {
  const n = begin({ text: V.jezero, origin: meta.origin }, { card: false });
  C().closeBubble();
  stopLandingSimulation();
  H().patch({ landing: null, edl: false });
  const l = n.say('Falling from orbit to Jezero Crater with the crosshair locked on the delta');
  useGlobeStore.getState().applyGlobeCommands([{ type: 'enter_jezero' }]);
  let ok = await waitFor(() => useGlobeStore.getState().mode === 'jezero', 14_000);
  if (!ok) { // the planet can drop a flight that starts while it is still settling; ask once more
    useGlobeStore.getState().applyGlobeCommands([{ type: 'enter_jezero' }]);
    ok = await waitFor(() => useGlobeStore.getState().mode === 'jezero', 25_000);
  }
  if (!ok) { l.fail('The fall to Jezero did not finish'); end(n, { text: 'The camera did not reach Jezero. Try again.', mood: 'warning', status: 'error' }); return; }
  l.done('Fell from orbit to Jezero Crater with the crosshair locked on the delta');
  const meta2 = useRuntime.getState().rt?.meta;
  const l2 = n.say('Loading the 20 m MRO CTX terrain and the base at the Octavia E. Butler site');
  await waitFor(() => !!useRuntime.getState().rt && useWorld.getState().ready, 20_000);
  l2.done(`Loaded the ${meta2?.nominalResM ?? 20} m MRO CTX terrain; base at the Octavia E. Butler site`);
  useSession.getState().patch({ region: 'Jezero Crater', place: 'Western delta', site: world.snapshot().base ?? null });
  end(n, { text: 'You are on the 20 m terrain of Jezero Crater. Drag to look around, pick Plan on the left and drag from the base to plan a walk, or click the ground to ask about it.' });
}

/* ------------------------------------------------------------------ jezero point */

/** Elevation text at a Jezero point: the 20 m DEM, or the global MOLA value marked est. where the DEM has a gap. */
function jezeroElevation(p: LonLat, demM: number | null): string {
  if (demM != null) return `${fmt(demM, 0)} m`;
  const g = useGlobal.getState().gs?.conditionsAt(p.lon, p.lat).elevationM;
  return g == null ? `${fmt(mockElevation(p.lon, p.lat), 0)} m mock` : `${fmt(g, 0)} m est.`;
}

async function onJezeroClick(p: LonLat) {
  const r = rt();
  if (!r) return;
  useSession.getState().patch({ site: p });
  const n = begin({ text: 'What is the ground like here?', origin: 'map', at: p });
  if (!insideBounds(useWorld.getState().bounds, p.lon, p.lat)) {
    // outside the 20 m tile: answer from the global layers (filled where they have gaps) instead of a dead end
    n.note('This point is outside the 20 m terrain, so I read the global layers here instead');
    end(n, { text: 'Outside the 20 m Jezero terrain: routes need the high-resolution area. The global layers for this point follow.' });
    void onGlobeClick(p);
    return;
  }
  try {
    const sel = useWorld.getState().selected;
    const elev = jezeroElevation(p, sel?.elevationM ?? null);
    n.note(`Read the ground at your cursor: CTX 20 m terrain, elevation ${elev}`);
    const t0 = performance.now();
    const overText = (pct: number, lim: number, r: number) => (pct > 0 ? `${pct}% of the ground within ${r} m is steeper than ${lim}°` : `none of the ground within ${r} m is steeper than ${lim}°`);
    const ana = await n.run(`Measuring slope within 250 m against the ${useWorld.getState().constraints.maxSlopeDeg}° limit`, () => callTool<{ slopeMeanDeg: number; slopeP90Deg: number; pctAboveLimit: number; limitDeg: number; radiusM: number }>('analyze_terrain', { target: 'selected', radiusM: 250 }),
      (a) => `Measured slope within ${a.radiusM} m: ${overText(a.pctAboveLimit, a.limitDeg, a.radiusM).replace(/ within \d+ m/, '')}`);
    const exA = explainTool('analyze_terrain', {}, ana);
    n.step({ kind: 'tool', title: 'analyze_terrain', meta: ms(t0), durMs: performance.now() - t0, code: [`slope = atan(√((∂z/∂x)² + (∂z/∂y)²))  (Horn 3×3 on the 20 m DEM)`, `mean ${ana.slopeMeanDeg}°, 90th percentile ${ana.slopeP90Deg}° within ${ana.radiusM} m`, ...exA.calcs], sources: [SRC.dem], raw: { args: { target: 'selected', radiusM: 250 }, result: ana } });
    const t1 = performance.now();
    const ctx = await n.run('Looking up the geologic unit and named features (USGS SIM 3464)', () => callTool<{ geology: { name: string; symbol: string } | null; namedFeaturesNear: { name: string; distanceKm: number }[]; elevationM: number | null }>('get_location_context', { target: 'selected' }),
      (c) => c.geology ? `Looked up the geologic unit: ${c.geology.name} (${c.geology.symbol}), USGS SIM 3464` : 'Looked up the geologic map: no unit is mapped here (USGS SIM 3464)');
    n.step({ kind: 'tool', title: 'get_location_context', meta: ms(t1), durMs: performance.now() - t1, code: [`geology = ${ctx.geology ? `${ctx.geology.name} (${ctx.geology.symbol})` : 'none'}`, ...ctx.namedFeaturesNear.slice(0, 3).map((f) => `near: ${f.name}, ${f.distanceKm} km`)], sources: [{ title: 'USGS SIM 3464 geologic map', url: 'https://pubs.usgs.gov/publication/sim3464' }], raw: { args: { target: 'selected' }, result: ctx } });
    const e = earthNow();
    if (e?.minutes != null) {
      n.note(`Read the Earth link from JPL Horizons: ${fmt(e.minutes, 1)} light-minutes one way`);
      const t2 = performance.now();
      const ln = earthCalc(e.rangeAu, e.minutes);
      if (ln) n.step({ kind: 'calculation', title: 'Earth link delay', durMs: performance.now() - t2, code: ln, sources: [SRC.horizons], raw: e });
    }
    const head = ana.pctAboveLimit >= 50 ? 'Mostly too steep to walk' : ana.pctAboveLimit >= 10 ? 'Partly too steep to walk' : 'Walkable ground';
    const tone: Tone = ana.pctAboveLimit >= 50 ? 'nogo' : ana.pctAboveLimit >= 10 ? 'caution' : 'go';
    const near = ctx.namedFeaturesNear[0];
    useSession.getState().patch({ region: 'Jezero Crater', place: near?.name ?? ctx.geology?.name ?? ll2(p) });
    const rows: Row[] = ([
      { label: 'Elevation', value: elev, tone: 'info', src: sel?.elevationM == null ? 'Estimate: global MOLA elevation at this point (20 m DEM gap)' : 'CTX DEM 20 m' },
      { label: `Over ${ana.limitDeg}° within ${ana.radiusM} m`, value: `${ana.pctAboveLimit} %`, tone, src: 'Horn slope' },
      { label: 'Mean / 90th pct slope', value: `${ana.slopeMeanDeg}° / ${ana.slopeP90Deg}°`, tone: 'info' },
      { label: 'Geologic unit', value: ctx.geology ? ctx.geology.symbol : `${useGlobal.getState().gs?.conditionsAt(p.lon, p.lat).geology?.symbol ?? 'unmapped'} est.`, tone: 'info', src: ctx.geology ? 'USGS SIM 3464' : 'Estimate: global geologic map (USGS SIM 3292), SIM 3464 has no unit here' },
      ...(near ? [{ label: 'Nearest feature', value: `${near.name}, ${near.distanceKm} km`, tone: 'info' as const }] : []),
      ...(e?.minutes != null ? [{ label: 'Earth light delay', value: `${fmt(e.minutes, 1)} min`, tone: 'info' as const, src: 'JPL Horizons' }] : []),
    ] as Row[]).slice(0, 6);
    const over = overText(ana.pctAboveLimit, ana.limitDeg, ana.radiusM);
    end(n, {
      lead: { text: `${head}.`, tone },
      text: `${over.charAt(0).toUpperCase()}${over.slice(1)}; the mean slope is ${ana.slopeMeanDeg}°. ${ctx.geology ? `It maps as ${ctx.geology.name}.` : 'No geologic unit is mapped here.'}`,
      rows: rows.slice(0, 3), mood: tone === 'nogo' ? 'warning' : 'idle',
      card: card({ title: head, sub: llStr(p), rows, point: p, actions: [act(V.walkHere, 'route'), act(V.land, 'plane-landing'), act(V.limits, 'sliders-horizontal')], askHint: 'Ask about this ground' }),
    });
  } catch (e) { failTurn(n, e); }
}

/* ------------------------------------------------------------------ routes */

function pt(p: LonLat, label: string): WorldPoint { return world.makePoint(p.lon, p.lat, 'pick', label); }

/** Working-step title patterns per go / no-go item, so a "Why" line links to the calculation behind it. */
const STEP_OF: Record<string, string> = { slope: 'slope', battery: 'battery', 'eva-time': 'EVA|time', daylight: 'daylight|sun', comms: 'comms|line of sight|radio', data: 'data|terrain' };
const val = (v: number | null, unit: string) => (v == null ? '' : `${fmt(v, Math.abs(v) < 10 ? 1 : 0)}${unit ? ` ${unit}` : ''}`);
/** "Why GO / HOLD / NO GO" for a round trip: the limiting check against its limit, what passed, what would change it. */
function whyRoute(ops: RouteOps): Answer['why'] {
  const items = ops.goNoGo.items;
  const lim = items.find((x) => x.status === 'no-go') ?? items.find((x) => x.status === 'caution');
  const passed = items.filter((x) => x.status === 'go').map((x) => x.label.toLowerCase());
  const lines: NonNullable<Answer['why']>['lines'] = [];
  if (lim) lines.push({ text: `${lim.label}: ${val(lim.value, lim.unit)}${lim.limit != null ? ` against a limit of ${val(lim.limit, lim.unit)}` : ''}${lim.status === 'caution' ? ' (close to the limit)' : ''}.`, step: STEP_OF[lim.id] });
  if (passed.length) lines.push({ text: `Passed: ${passed.join(', ')}.` });
  const mast = H().mastHeightM, next = Math.min(MAST_RANGE_M.max, mast + 10);
  const fix: Record<string, string> = {
    comms: mast < MAST_RANGE_M.max ? `Raise the mast to ${next} m to shorten the radio shadow, then check again.` : 'Pick a target with line of sight to the base.',
    slope: 'Pick a target off the steep ground, or relax the slope limit in Limits.',
    battery: 'Use the rover for part of the way out, or pick a nearer target.',
    'eva-time': 'Pick a nearer target or shorten the time at the target.',
    daylight: 'Start the walk at local noon.',
    data: 'Pick a target inside the 20 m terrain.',
  };
  if (lim && fix[lim.id]) lines.push({ text: fix[lim.id] });
  if (items.some((x) => x.provenance === 'estimate' || x.provenance === 'mock')) lines.push({ text: '(includes estimates)' });
  return { word: ops.verdict.word, tone: ops.verdict.tone as Tone, lines: lines.slice(0, 4) };
}

export function routeActions(ops: RouteOps | null): CardAction[] {
  const blockers = ops?.goNoGo.blockers ?? [];
  const mast = H().mastHeightM;
  const out: CardAction[] = [];
  if (blockers.includes('daylight')) out.push(act(V.noon, 'sun'));
  else out.push(act(V.walk, 'footprints'));
  out.push(act(V.helmet, 'scan-eye'));
  // the mast is offered once, here, and only when comms is what blocks the walk and slope does not
  if (blockers.includes('comms') && !blockers.includes('slope') && mast < MAST_RANGE_M.max) { const m = Math.min(MAST_RANGE_M.max, mast + 10); out.push(act(`Raise mast to ${m} m`, 'radio-tower', `Raise the mast to ${m} m and replan`)); }
  else out.push(act(V.rover, 'truck'));
  out.push(act(V.cuff, 'clipboard-list'));
  return out;
}

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function answerForRoute(route: RouteResult, ops: RouteOps): { lead: { text: string; tone: Tone }; text: string } {
  const g = ops.goNoGo;
  const it = (id: string) => g.items.find((i) => i.id === id);
  const t = route.totals;
  const left = 100 - t.batteryUsedPct;
  const lead = { text: `${ops.verdict.word}.`, tone: ops.verdict.tone };
  if (!route.legs.length) return { lead, text: ops.verdict.reason };
  if (!g.blockers.length && !g.cautions.length) return { lead, text: `Every limit holds. ${kmStr(t.lengthM)} round trip in ${hmin(t.evaMin)}, back with ${fmt(left, 1)} % battery.` };
  const pass = [it('slope')?.status === 'go' ? 'slope' : null, it('eva-time')?.status === 'go' ? 'time' : null, it('battery')?.status === 'go' ? 'battery' : null].filter((x): x is string => !!x);
  return { lead, text: `${pass.length ? `${cap(joinAnd(pass))} pass${pass.length === 1 ? 'es' : ''}. ` : ''}${ops.verdict.reason}` };
}

let planSeq = 0;
const kmOrM = (m: number) => (m < 1000 ? `${Math.round(m)} m` : kmStr(m));


/**
 * On a stage too narrow for the 300 px card and the route side by side (1024 px and below), pan and if needed pull the
 * camera back so the whole route sits in the part of the map the card does not use: the left part on a desktop (the
 * card goes right), the top part on a phone (the card is a bottom sheet). Keeps the view direction; uses the screen
 * Jacobian at the route centre (pixels per metre east and north) to turn the wanted screen shift into a ground shift.
 */
const CARD_W = 300;
/** Recenter in Jezero with no simulation: the active route's framing, else the default view of the base. */
export function recenterJezero() {
  const route = activeRoute();
  if (route) { try { frameRouteBesideCard(route); return; } catch { /* fall back to the base */ } }
  const b = world.snapshot().base;
  if (b) world.applyCommands([{ type: 'focus_camera', lon: b.lon, lat: b.lat, distanceM: 9000 }]);
}

function frameRouteBesideCard(route: RouteResult) {
  if (useGlobeStore.getState().mode !== 'jezero' || !route.legs.length) return;
  const st = document.querySelector('[data-stage]')?.getBoundingClientRect();
  if (!st) return;
  const phone = window.innerWidth <= 640;
  if (!phone && st.width >= 1000) return; // wide stages: the card finds a clear spot by itself
  const pts = route.legs.flatMap((l) => l.path);
  const step = Math.max(1, Math.floor(pts.length / 64));
  const scr = [] as { x: number; y: number }[];
  for (let i = 0; i < pts.length; i += step) { const q = projectJezero(pts[i]); if (q.visible) scr.push(q); }
  if (scr.length < 2) return;
  const lonC = pts.reduce((a, q) => a + q.lon, 0) / pts.length, latC = pts.reduce((a, q) => a + q.lat, 0) / pts.length;
  const M = { lon: lonC, lat: latC };
  const P0 = projectJezero(M), D0 = jezeroDepth(M);
  if (!P0.visible || D0 == null) return;
  const Pe = projectJezero(offsetLonLat(M, 90, 100)), Pn = projectJezero(offsetLonLat(M, 0, 100));
  const a = (Pe.x - P0.x) / 100, b = (Pn.x - P0.x) / 100, c = (Pe.y - P0.y) / 100, d = (Pn.y - P0.y) / 100;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return;
  const x0 = Math.min(...scr.map((q) => q.x)), x1 = Math.max(...scr.map((q) => q.x));
  const y0 = Math.min(...scr.map((q) => q.y)), y1 = Math.max(...scr.map((q) => q.y));
  // the free region of the stage
  const sheetH = window.innerHeight * 0.52; // the card sheet's largest height
  const free = phone
    ? { l: st.left + 16, r: st.right - 16, t: st.top + 48, b: st.bottom - sheetH - 24 }
    : { l: st.left + 24, r: st.right - CARD_W - 72, t: st.top + 48, b: st.bottom - 40 }; // 72: room for the base label beside its ring
  const fw = free.r - free.l, fh = free.b - free.t;
  if (fw < 80 || fh < 80) return;
  // already clear: nothing to do
  if (x0 >= free.l && x1 <= free.r && y0 >= free.t && y1 <= free.b) return;
  const z = Math.min(4, Math.max(1, (x1 - x0) / (fw * 0.85), (y1 - y0) / (fh * 0.85)));
  // after pulling back by z the route shrinks toward the screen centre; place its box centre on the free region's centre
  const ox = ((x0 + x1) / 2 - P0.x) / z, oy = ((y0 + y1) / 2 - P0.y) / z;
  const want = { x: (free.l + free.r) / 2 - ox, y: (free.t + free.b) / 2 - oy };
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  // with the camera target T at the screen centre, M lands at centre + J/z (M - T); solve for M - T in metres east, north
  const dx = (want.x - cx) * z, dy = (want.y - cy) * z;
  const east = (d * dx - b * dy) / det, north = (-c * dx + a * dy) / det;
  const T = offsetLonLat(offsetLonLat(M, 270, east), 180, north);
  world.applyCommands([{ type: 'focus_camera', lon: T.lon, lat: T.lat, distanceM: D0 * z }]);
}

/* ------------------------------------------------------------------ science at the target and the view from the ground */

const GROUND_NEAR_M = 150;
let cachedSols: Promise<Set<number>> | null = null;
/** Sols with a pre-fetched Perseverance image list in /data/rover_cache (index.json, written by scripts/fetch-rover-cache.mjs). */
function roverCacheSols(): Promise<Set<number>> {
  cachedSols ??= fetch('/data/rover_cache/index.json').then((r) => (r.ok ? r.json() : { sols: [] })).then((j: { sols?: number[] }) => new Set(j.sols ?? [])).catch(() => new Set<number>());
  return cachedSols;
}
async function imagesFor(url: string, ms: number): Promise<RoverImage[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return [];
    const body = (await r.json()) as { images?: RoverImage[] } | RoverImage[];
    return (Array.isArray(body) ? body : body.images ?? []).filter((i) => cameraRank(i.camera) < 99);
  } catch { return []; } finally { clearTimeout(timer); }
}

/**
 * The nearest Perseverance view to a target. A sol whose waypoint is within 150 m is asked for live (NASA raw images
 * API through /api/rover-images, 4 s at most) when it is not cached; otherwise the nearest cached sol (at any distance) is
 * used, and the strip says how far from the target those frames were taken.
 */
async function groundViewAt(to: LonLat): Promise<GroundView | null> {
  const pts = rt()?.traverse?.points ?? [];
  const bySol = new Map<number, number>();
  // nearest waypoint per sol at any distance: past 2 km the strip still shows the nearest frame and says how far it is
  for (const q of pts) { const d = groundDist(to, q); if (d < (bySol.get(q.sol) ?? Infinity)) bySol.set(q.sol, d); }
  if (!bySol.size) return null;
  const order = [...bySol.entries()].sort((x, y) => x[1] - y[1]);
  const cache = await roverCacheSols();
  const pack = (sol: number, distanceM: number, imgs: RoverImage[]): GroundView => ({
    sol, distanceM, photos: selectImages(imgs, 2).map((i) => ({ id: i.id, url: i.url, pageUrl: i.pageUrl, sol: i.sol, earthDate: i.earthDate, camera: i.camera, cameraFull: i.cameraFull, credit: i.credit })),
  });
  const [nearSol, nearD] = order[0];
  if (nearD <= GROUND_NEAR_M && !cache.has(nearSol)) {
    const live = await imagesFor(`/api/rover-images?sol=${nearSol}`, 4000);
    if (live.length) return pack(nearSol, nearD, live);
  }
  for (const [sol, d] of order.slice(0, 40)) {
    if (!cache.has(sol)) continue;
    const imgs = await imagesFor(`/data/rover_cache/${sol}.json`, 4000);
    if (imgs.length) return pack(sol, d, imgs);
  }
  return null;
}

/** Science at a target: the mapped unit, the nearest curated site and the nearest Perseverance view. */
async function scienceAt(to: LonLat): Promise<ScienceNote> {
  const sc = rt()?.science;
  // SIM 3464 covers the crater floor only; elsewhere the global map (SIM 3292) stands in, marked est.
  const g = sc?.geologyAt(to) ?? null, gg = g ? null : useGlobal.getState().gs?.conditionsAt(to.lon, to.lat).geology ?? null;
  const unit = g ?? (gg ? { symbol: `${gg.symbol} est.`, name: `${gg.name}, global map` } : null);
  const site = sc?.sitesNear(to, 50)[0] ?? null;
  let ground: GroundView | null = null;
  try { ground = await groundViewAt(to); } catch { /* no photo: the strip says so */ }
  return {
    unit: unit ? { symbol: unit.symbol, name: unit.name } : null,
    site: site ? { name: site.name, distanceKm: site.distanceKm, url: site.sourceUrl, sourceTitle: site.sourceTitle } : null,
    ground,
  };
}
function groundDist(a: LonLat, b: LonLat): number {
  const R = 3_396_190, d = Math.PI / 180, lat = ((a.lat + b.lat) / 2) * d;
  return Math.hypot(R * Math.cos(lat) * (b.lon - a.lon) * d, R * (b.lat - a.lat) * d);
}

/**
 * Round trip a to b with the current limits: solve, check, draw, and narrate each step as it runs. With `snap`, the
 * target first moves to the nearest point the crew can reach under the slope limit (and the turn says how far).
 */
export async function commitPlan(from: LonLat, to: LonLat, ask?: Ask, opts: { snap?: boolean } = {}) {
  const r = rt(); if (!r?.terrain) return;
  const seq = ++planSeq;
  const c = useWorld.getState().constraints;
  const mast = H().mastHeightM;
  const n = begin(ask ?? { text: `Plan a round trip from base to ${ll2(to)}`, origin: 'drag', at: to }, { point: to });
  let moved: { from: LonLat; m: number } | null = null;
  try {
    if (opts.snap) {
      const t0 = performance.now();
      const near = await n.run(`Finding the nearest point the crew can reach under ${c.maxSlopeDeg}°`, () => r.terrain!.nearestReachable({ from, to, maxSlopeDeg: c.maxSlopeDeg, maxRadiusM: 1000 }),
        (x) => (x.point ? `Moved the target ${kmOrM(x.movedM ?? 0)} to the nearest point reachable under ${c.maxSlopeDeg}°, on ${fmt(x.slopeDeg ?? 0, 1)}° ground` : `Found no point within 1 km that the crew can reach under ${c.maxSlopeDeg}°`));
      n.step({ kind: 'tool', title: 'nearest_reachable_point', meta: ms(t0), durMs: performance.now() - t0, code: [
        `flood fill from the base over 40 m cells: every cell and edge at or under ${c.maxSlopeDeg}°`,
        near.point ? `nearest reachable cell to ${llStr(to)}: ${llStr(near.point)}, moved ${kmOrM(near.movedM ?? 0)}, cell max slope ${fmt(near.slopeDeg ?? 0, 1)}°` : `no reachable cell within 1,000 m of ${llStr(to)}`,
      ], sources: [SRC.dem], raw: { args: { from, to, maxSlopeDeg: c.maxSlopeDeg, maxRadiusM: 1000 }, result: near } });
      if (!near.point) {
        end(n, { lead: { text: 'Nothing reachable nearby.', tone: 'nogo' }, text: `No point within 1 km of the target can be reached from the base under ${c.maxSlopeDeg}°. Raise the slope limit or pick another target.`, mood: 'warning',
          card: card({ word: { text: 'NO GO', tone: 'nogo' }, title: `Nothing within 1 km is reachable under ${c.maxSlopeDeg}°`, sub: `${ll2(to)}, round trip from base`, rows: [], point: to, actions: [act(V.limits, 'sliders-horizontal')], askHint: 'Ask about this route' }) });
        return;
      }
      moved = { from: to, m: near.movedM ?? 0 };
      to = near.point;
      useThread.getState().patch(n.id, { point: to });
    }
    const target = pt(to, 'Target');
    n.step({ kind: 'input', title: moved ? 'Moved to the nearest reachable point' : ask?.origin === 'drag' || !ask ? 'You dragged from base to a point' : 'Round trip requested', meta: clock(), text: `target ${llStr(to)}, elevation ${jezeroElevation(to, target.elevationM)} (CTX DEM, bilinear)` });
    n.note(`Read the ground at the target: CTX 20 m terrain, elevation ${jezeroElevation(to, target.elevationM)}`);
    const res = await n.run(`Planning a round trip from base with A*, slope limit ${c.maxSlopeDeg}°`, () => r.terrain!.planRoute({ from, to, roundTrip: true, constraints: c }),
      (x) => x.legs.length ? `Planned a round trip from base with A*, slope limit ${c.maxSlopeDeg}°: ${kmStr(x.legs[0].lengthM)} out, ${kmStr(x.legs[x.legs.length - 1].lengthM)} back` : `Found no path under ${c.maxSlopeDeg}° between the base and the target, in either direction`);
    if (seq !== planSeq) { end(n, { text: 'A newer plan replaced this one.' }); return; }
    const route = world.addRoute({ ...res, label: `Round trip to ${ll2(to)}`, from: pt(from, 'Start'), to: target });
    useWalkUi.getState().setHelmet(false);
    stopLandingSimulation();
    H().patch({ activeRouteId: route.id, walkOn: false, reachOn: false, landing: null, cuff: null, sheet: H().sheet === 'cuff' ? null : H().sheet });
    usePlayback.getState().load({ scenarioId: route.id, kind: 'walk', durationS: 0 });
    const t = route.totals;
    // the solver's own totals come first (walking time and battery are part of the plan), then the ops checks
    if (route.legs.length) {
      n.note(`Computed walking time with a suited Tobler model: ${hmin(t.evaMin)} including ${c.dwellMin} min at the target`);
      n.note(`Computed the suit battery: ${fmt(100 - t.batteryUsedPct, 1)} % left against a ${c.batteryReservePct} % reserve`);
    }
    const tOps = performance.now();
    const ops = route.legs.length
      ? await n.run(`Checking line of sight to the ${mast} m base mast at every route vertex, and the sun with Mars24`, () => evaluateRoute(route, r.dem, world.snapshot().base, H().startUtcMs, c, mast),
        (o) => o.comms ? `Checked line of sight to the ${mast} m base mast at every vertex: ${o.comms.shadows.length ? `${kmStr(o.comms.longestShadowM)} in shadow` : 'never in shadow'}` : 'Did not check comms: no base station')
      : evaluateRoute(route, r.dem, world.snapshot().base, H().startUtcMs, c, mast);
    const opsMs = useThread.getState().turns.find((x) => x.id === n.id)?.narration.at(-1)?.tMs ?? performance.now() - tOps;
    setOps(route.id, ops);
    H().patch({ verdict: ops.verdict });
    const e = earthNow();

    if (!route.legs.length) {
      /* ---------------- no path: the target slope and the smallest limit that works; nothing is drawn */
      const ts = route.targetSlopeDeg ?? null, min = route.minFeasibleSlopeDeg ?? null;
      if (ts != null) n.note(ts > c.maxSlopeDeg ? `Read the target cell: its steepest 20 m slope is ${fmt(ts, 1)}°, over the ${c.maxSlopeDeg}° limit` : `Read the target cell: ${fmt(ts, 1)}°, under the limit, so steeper ground cuts it off from the base`);
      n.note(min ? `Re-ran A* at 1° steps: ${min}° is the smallest limit with a path both ways` : 'Re-ran A* at 1° steps up to 45°: no limit gives a path both ways');
      for (const s2 of routeSteps(route, ops, c, world.snapshot().base, e)) n.step(s2);
      world.applyCommands([{ type: 'clear_annotations' }]);
      n.note('Drew no route: there is no path to draw');
      useSession.getState().patch({ science: null });
      const title = `No path under ${c.maxSlopeDeg}° reaches this point`;
      const rows: Row[] = [
        ...(ts != null ? [{ label: 'Target slope / limit', value: `${fmt(ts, 1)}° / ${c.maxSlopeDeg}°`, tone: (ts > c.maxSlopeDeg ? 'nogo' : 'go') as Tone, src: 'steepest 20 m cell inside the 40 m planning cell at the target' }] : []),
        { label: 'Smallest limit that works', value: min ? `${min}°` : 'none up to 45°', tone: 'info', src: 'A* re-run at 1° steps, both directions' },
      ];
      const why = ts != null && ts > c.maxSlopeDeg ? `the target cell slopes ${fmt(ts, 1)}°` : 'steeper ground cuts the target off from the base';
      end(n, {
        lead: { text: 'NO GO.', tone: 'nogo' },
        text: `${title}: ${why}. ${min ? `The smallest limit that works is ${min}°.` : 'No limit up to 45° gives a path.'}`,
        rows, report: true, mood: 'warning',
        card: card({
          word: { text: 'NO GO', tone: 'nogo' }, title, sub: `${ll2(to)}, round trip from base`, rows, point: to,
          actions: [...(min ? [act(`Replan at ${min}°`, 'sliders-horizontal', `Set the slope limit to ${min}° and replan`)] : []), act(V.nearest, 'crosshair')],
          askHint: 'Ask about this route',
        }),
      });
      return;
    }

    /* ---------------- a full round trip */
    const day = ops.goNoGo.items.find((i) => i.id === 'daylight');
    n.note(`Read the sun from the same check: ${day?.status === 'go' ? 'daylight lasts the whole EVA' : day?.status === 'caution' ? 'the sun gets low before the end' : 'the sun is below the horizon during the EVA'}, ${daylightMargin(route, ops.startUtcMs).text} margin`);
    for (const s2 of routeSteps(route, ops, c, world.snapshot().base, e, opsMs)) n.step(s2);
    const tS = performance.now();
    const sci = await n.run('Looking up the science at the target and the nearest Perseverance photo', () => scienceAt(to),
      (x) => `Looked up the science at the target: ${x.unit ? `${x.unit.name} (${x.unit.symbol})` : 'no mapped unit'}${x.ground ? `; nearest Perseverance view is sol ${x.ground.sol}, ${kmOrM(x.ground.distanceM)} away` : '; the nearest Perseverance frame is not in the cache'}`);
    if (seq !== planSeq) { end(n, { text: 'A newer plan replaced this one.' }); return; }
    n.step({ kind: 'tool', title: 'science_at_target', meta: ms(tS), durMs: performance.now() - tS, code: [
      `geology = ${sci.unit ? `${sci.unit.name} (${sci.unit.symbol})` : 'none mapped'}  (USGS SIM 3464)`,
      `nearest catalogued site = ${sci.site ? `${sci.site.name}, ${fmt(sci.site.distanceKm, 2)} km` : 'none within 50 km'}`,
      sci.ground ? `nearest Perseverance frames: sol ${sci.ground.sol}, ${kmOrM(sci.ground.distanceM)} from the target, ${sci.ground.photos.map((p) => p.camera).join(', ')}` : 'nearest Perseverance frame: not in the cache',
    ], sources: [{ title: 'USGS SIM 3464 geologic map', url: 'https://pubs.usgs.gov/publication/sim3464' }, { title: 'Perseverance raw images, NASA/JPL-Caltech', url: 'https://mars.nasa.gov/mars2020/multimedia/raw-images/' }], raw: sci });
    useSession.getState().patch({ science: { target: { lon: route.to.lon, lat: route.to.lat }, unit: sci.unit, site: sci.site, ground: sci.ground } });
    // draw: the route, and the longest radio shadow as a highlighted stretch with its label
    const cmds: Parameters<typeof world.applyCommands>[0] = [{ type: 'clear_annotations' }, { type: 'draw_route', routeId: route.id, style: 'primary' }];
    // the map numbers its marks like the card rows (ops.order): the shadow is drawn whenever comms is issue N, and its
    // map label carries that same N (Scene/Routes.tsx reads it from ops.order), so the map never contradicts the card
    const sh = ops.order.includes('comms') ? ops.comms?.shadows.reduce<typeof ops.comms.shadows[number] | null>((m, s2) => (!m || s2.lengthM > m.lengthM ? s2 : m), null) : null;
    if (sh && sh.lengthM >= 50) {
      // a shadow that runs through the target (out on one leg, back on the next) is marked where it starts, to the target
      const endIdx = sh.startLeg === sh.endLeg ? sh.endVertex : route.legs[sh.startLeg].path.length - 1;
      if (endIdx > sh.startVertex) cmds.push({ type: 'highlight_segment', routeId: route.id, leg: sh.startLeg, startIdx: sh.startVertex, endIdx, label: `Radio shadow ${kmStr(sh.lengthM)}` });
    }
    const tD = performance.now();
    const applied = world.applyCommands(cmds);
    try { frameRouteBesideCard(route); } catch { /* framing is a convenience; the plan stands without it */ }
    n.note(`Drew the route${cmds.some((x) => x.type === 'highlight_segment') ? ' and the shadow stretch' : ''} on the map`);
    n.step({ kind: 'tool', title: 'issue_scene_commands', meta: ms(tD), durMs: performance.now() - tD, text: cmds.map((x) => x.type === 'draw_route' ? `draw_route ${x.routeId}` : x.type === 'highlight_segment' ? `highlight_segment ${x.startIdx} to ${x.endIdx}` : x.type).join(', '), raw: { commands: cmds, result: applied } });
    const ans = answerForRoute(route, ops);
    const why = whyRoute(ops);
    const rows: Row[] = routeRows(route, ops, c);
    const first = rows.find((x) => x.label.startsWith('1. ')); // issue 1 in ops.order, the card headline
    end(n, {
      lead: ans.lead, text: ans.text, why, report: true, mood: ops.verdict.tone === 'go' ? 'drawing' : 'warning', science: sci,
      rows: [rows[0], rows[2], first && first !== rows[2] ? first : rows[3]].filter(Boolean) as Row[],
      card: card({
        word: { text: ops.verdict.word, tone: ops.verdict.tone },
        title: ops.verdict.reason.replace(/\.$/, ''), sub: `${ll2(to)}, round trip from base${moved ? `, moved ${kmOrM(moved.m)}` : ''}`, rows, point: to,
        actions: routeActions(ops), askHint: 'Ask about this route', science: sci,
      }),
    });
  } catch (e) { failTurn(n, e); }
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
      const res = await r.terrain.planRoute({ from, to, roundTrip: false, constraints: { ...c, objective: 'shortest' }, findMinSlope: false });
      if (seq !== previewSeq) continue;
      const pts = res.legs[0]?.path ?? [];
      const tone = previewTone(res, c);
      const eva = 2 * res.totals.walkMin + c.dwellMin;
      const line: PreviewLine = {
        points: pts.length > 1 ? pts : [{ ...from, h: 0 }, { ...to, h: 0 }], tone, at,
        label: res.legs.length ? `About ${kmStr(2 * res.totals.lengthM)}, ${hmin(eva)} round trip` : `No path under ${c.maxSlopeDeg}° reaches this point`,
      };
      H().patch({ preview: line });
    } catch { /* a failed preview keeps the last line */ }
  }
  previewBusy = false;
}
export function clearPreview() { pending = null; previewSeq++; H().patch({ preview: null }); }

async function walkHere(meta: AskMeta) {
  const sel = useWorld.getState().selected, base = world.snapshot().base;
  if (!sel || !base) { const n = begin({ text: V.walkHere, origin: meta.origin }); n.say('I need a target: click the ground first').fail(); end(n, { text: 'Click the ground in Jezero first, then ask again.', mood: 'warning' }); return; }
  await commitPlan({ lon: base.lon, lat: base.lat }, { lon: sel.lon, lat: sel.lat }, { text: V.walkHere, origin: meta.origin, at: { lon: sel.lon, lat: sel.lat } });
}

/** Re-run the current plan (with or without a path) with the current limits, as one turn that says why. */
function replanActive(text: string, origin: AskMeta['origin']) {
  const route = currentPlan();
  if (!route) return false;
  void commitPlan(route.from, route.to, { text, origin, at: origin === 'panel' ? null : { lon: route.to.lon, lat: route.to.lat } });
  return true;
}

/** "Pick nearest reachable point": plan to the closest point the crew can reach under the slope limit. */
function nearestPoint(meta: AskMeta) {
  const route = currentPlan();
  if (!route) { const n = begin({ text: V.nearest, origin: meta.origin }, { card: false }); needRoute(n); return; }
  void commitPlan(route.from, route.to, { text: V.nearest, origin: meta.origin, at: meta.origin === 'panel' ? null : { lon: route.to.lon, lat: route.to.lat } }, { snap: true });
}

/* ------------------------------------------------------------------ lasso */

export async function lassoAnalyze(poly: LonLat[], areaKm2: number) {
  const r = rt(); if (!r) return;
  const c = useWorld.getState().constraints;
  const c0 = centroid(poly);
  useShell.getState().setTool(null);
  const n = begin({ text: `Lasso an area of ${fmt(areaKm2, 2)} km²`, origin: 'lasso', at: c0 });
  const t0 = performance.now();
  const samples = await n.run('Sampling the 20 m terrain every 30 m inside the lasso', () => samplePolygon(poly, 30), (s) => `Sampled the 20 m terrain at ${s.length} points inside the lasso`);
  const slopes = samples.map((s) => slopeAtDem(r.dem, s.lon, s.lat)).filter((x): x is number => x != null);
  if (!slopes.length) { n.say('There is no terrain data inside that area').fail(); end(n, { text: 'No terrain data in that area.', mood: 'warning' }); return; }
  const nOver = slopes.filter((s) => s > c.maxSlopeDeg).length;
  const over = (nOver / slopes.length) * 100;
  const mean = slopes.reduce((a, b) => a + b, 0) / slopes.length;
  const sorted = [...slopes].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)];
  const overPhrase = nOver === 0 ? `none of it over the ${c.maxSlopeDeg}° limit` : `${fmt(over, 0)}% over the ${c.maxSlopeDeg}° limit`;
  n.note(`Measured the slope inside: mean ${fmt(mean, 1)}°, 90th percentile ${fmt(p90, 1)}°, ${overPhrase}`);
  n.step({ kind: 'calculation', title: 'lasso_area', meta: ms(t0), durMs: performance.now() - t0, code: [
    `area = ${fmt(areaKm2, 3)} km² (${poly.length} vertices, spherical polygon)`,
    `share over limit = cells above ${c.maxSlopeDeg}° ÷ cells sampled = ${nOver} ÷ ${slopes.length} = ${fmt(over, 1)} %`,
    `mean slope = Σ slope ÷ n = ${fmt(mean, 2)}°, 90th percentile ${fmt(p90, 1)}°`,
  ], sources: [SRC.dem], raw: { vertices: poly, areaKm2, samples: slopes.length, nOver, meanDeg: mean, p90Deg: p90 } });
  const units = new Map<string, number>();
  for (const s of samples) { const g = r.science.geologyAt(s); if (g) units.set(g.name, (units.get(g.name) ?? 0) + 1); }
  const top = [...units.entries()].sort((a, b) => b[1] - a[1])[0];
  n.note(top ? `Mapped the geologic units: mostly ${top[0]}, ${Math.round((top[1] / samples.length) * 100)}% of the area` : 'Mapped the geologic units: none inside');
  const stops = (['delta-sediments', 'astrobiology-samples', 'crater-floor', 'rim-bedrock', 'aeolian'] as const)
    .flatMap((o) => r.science.suggestStops(o, c0, Math.max(1, Math.sqrt(areaKm2)), 12))
    .filter((s) => poly.length > 2 && pointInPolygon(s, poly));
  const stop = stops[0];
  n.note(stop ? `Searched the catalogued science stops: ${stop.label} is inside` : 'Searched the catalogued science stops: none inside');
  lassoStop = stop ? { lon: stop.lon, lat: stop.lat } : null;
  const tone: Tone = over >= 50 ? 'nogo' : over >= 10 ? 'caution' : 'go';
  const rows: Row[] = [
    { label: 'Area', value: `${fmt(areaKm2, 2)} km²`, tone: 'info' },
    { label: `Over the ${c.maxSlopeDeg}° limit`, value: `${fmt(over, 0)} %`, tone },
    { label: 'Mean / 90th pct slope', value: `${fmt(mean, 1)}° / ${fmt(p90, 1)}°`, tone: 'info' },
    { label: 'Mostly', value: top ? top[0] : 'no mapped unit', tone: 'info', src: 'USGS SIM 3464' },
    { label: 'Best science stop', value: stop ? stop.label : 'none inside', tone: stop ? 'go' : 'none' },
  ];
  const leadText = nOver === 0 ? `None of the area is over the ${c.maxSlopeDeg}° limit` : `${fmt(over, 0)}% of the area is over the ${c.maxSlopeDeg}° limit`;
  end(n, {
    lead: { text: `${leadText}.`, tone },
    text: `Mean slope ${fmt(mean, 1)}°, 90th percentile ${fmt(p90, 1)}° over ${fmt(areaKm2, 2)} km². ${top ? `Mostly ${top[0]}.` : ''} ${stop ? `${stop.label} is the best catalogued stop inside.` : 'No catalogued science stop inside.'}`.replace(/\s+/g, ' ').trim(),
    rows: rows.slice(0, 3), mood: over >= 50 ? 'warning' : 'idle',
    card: card({ title: leadText, sub: `${ll2(c0)}, ${fmt(areaKm2, 2)}\u00a0km²`, rows, point: c0, actions: stop ? [act(V.lassoWalk, 'route')] : [act(V.limits, 'sliders-horizontal')], askHint: 'Ask about this area' }),
  });
}

/* ------------------------------------------------------------------ scenarios on a route */

/** The plan MarsAgent is talking about, with a walkable path (Walk, Helmet, Cuff card need one). */
function activeRoute(): RouteResult | null {
  const r = currentPlan();
  return r && r.legs.length ? r : null;
}
/** The plan MarsAgent is talking about, even when no path was found (replanning and "nearest point" still apply). */
function currentPlan(): RouteResult | null {
  const id = H().activeRouteId;
  return id ? useWorld.getState().routes[id] ?? null : null;
}
export function timelineNow() {
  const route = activeRoute(), r = rt();
  if (!route || !r) return null;
  return buildTimeline(route, { toLocal: (lon, lat) => r.geo.toLocal(r.meta, lon, lat) }, { roverFraction: useWalkUi.getState().roverFraction });
}
function needRoute(n: Narrator): boolean {
  if (activeRoute()) return true;
  n.say(useGlobeStore.getState().mode === 'jezero' ? 'I need a route first: drag from the base to a target' : 'I need a route first: take me to Jezero, then drag from the base').fail();
  end(n, { text: useGlobeStore.getState().mode === 'jezero' ? 'Drag on the ground from the base to plan a walk first.' : 'Routes need the 20 m Jezero terrain. Use Take me to Jezero, then drag from the base.', mood: 'warning' });
  return false;
}
function startWalk() {
  const tl = timelineNow(); if (!tl) return null;
  stopLandingSimulation();
  H().patch({ walkOn: true, landing: null, reachOn: false });
  usePlayback.getState().load({ scenarioId: tl.routeId, kind: useWalkUi.getState().roverFraction > 0 ? 'rover-walk' : 'walk', durationS: tl.durationS, autoplay: true, speed: 60 });
  return tl;
}

/** Bring the camera in over a route so the crew (or the rover) reads at a glance. */
function focusRoute(route: RouteResult) {
  const mid = { lon: (route.from.lon + route.to.lon) / 2, lat: (route.from.lat + route.to.lat) / 2 };
  world.applyCommands([{ type: 'focus_camera', lon: mid.lon, lat: mid.lat, distanceM: Math.min(6000, Math.max(1400, route.totals.lengthM * 0.55)) }]);
}

function walkIt(meta: AskMeta, rover = false) {
  const n = begin({ text: rover ? V.rover : V.walk, origin: meta.origin }, { card: false });
  if (!needRoute(n)) return;
  C().closeBubble();
  useWalkUi.getState().setHelmet(false);
  useWalkUi.getState().setRoverFraction(rover ? 0.5 : 0);
  const route = activeRoute()!;
  const c = route.constraintsUsed;
  const tW = performance.now();
  const tl = startWalk()!;
  const tlMs = performance.now() - tW;
  focusRoute(route);
  n.note(`Placed two suited crew at the base on route ${route.id}, walking at ${fmt(c.suitSpeedFactor, 2)} of Tobler speed`);
  if (rover) n.note(`Put the crew on the rover for the first half of the outbound leg at ${useWalkUi.getState().roverKmh} km/h (assumption)`);
  n.note(`Loaded ${hmin(tl.durationS / 60)} of EVA on the timeline, playing at 60×`);
  if (tl.turnBack) n.say(`Turn back at ${hmin(tl.turnBack.tS / 60)}: the battery reserve is reached on the way out`).fail();
  const s = tl.summary;
  // the two suits walk PAIR_SEPARATION_M apart on the same path: line of sight between them along the whole timeline
  const tP = performance.now();
  const dem = rt()?.dem;
  const pair = dem ? pairSightAlongRoute(dem, route, PAIR_SEPARATION_M, 0.5) : null;
  const pairText = !pair ? 'not checked' : !pair.worst ? 'whole walk' : `hidden ${hmin(pair.hidden * pair.stepMin)}, worst T+${clockHm(pair.worst.startMin)} to T+${clockHm(pair.worst.endMin + pair.stepMin)}`;
  if (pair) {
    n.note(pair.worst ? `Checked that the two crew can see each other: out of sight for ${hmin(pair.hidden * pair.stepMin)}, the longest stretch from T+${clockHm(pair.worst.startMin)}` : `Checked that the two crew can see each other, ${PAIR_SEPARATION_M} m apart: in sight the whole walk`);
    n.step({ kind: 'calculation', title: 'Crew in sight of each other', durMs: performance.now() - tP, code: [
      `second suit follows ${PAIR_SEPARATION_M} m behind on the same path (assumption); suit antennas ${fmt(SUIT_ANTENNA_HEIGHT_M, 1)} m`,
      `line of sight on the 20 m DEM every ${fmt(pair.stepMin * 60, 0)} s of the walk: ${pair.checks - pair.hidden} of ${pair.checks} checks in sight`,
      pair.worst ? `worst stretch T+${clockHm(pair.worst.startMin)} to T+${clockHm(pair.worst.endMin + pair.stepMin)}` : 'no hidden stretch; the 20 m terrain cannot show boulders between them',
    ], sources: [SRC.viewshed], raw: pair });
  }
  n.step({ kind: 'calculation', title: rover ? 'Rover assist' : 'Walk playback', durMs: tlMs, code: rover ? [
    `on foot: ${hmin(s.walkOnlyEvaMin)}, battery used ${fmt(s.walkOnlyBatteryPct, 1)} %`,
    `with the rover over ${fmt(useWalkUi.getState().roverFraction * 100, 0)} % of the outbound distance: ${hmin(s.evaMin)}, battery used ${fmt(s.batteryUsedPct, 1)} %`,
    `time saved = ${hmin(Math.max(0, s.walkOnlyEvaMin - s.evaMin))}`,
  ] : [`duration = ${fmt(tl.durationS, 0)} s simulated, played at 60× = ${fmt(tl.durationS / 60, 0)} s of wall clock`, `distance ${kmStr(tl.distM)}, ${tl.markers.length} timeline markers`], sources: [SRC.tobler], raw: { routeId: tl.routeId, durationS: tl.durationS, summary: s, turnBack: tl.turnBack } });
  const pairRow: Row = { label: 'Crew in sight of each other', value: pairText, tone: !pair ? 'none' : pair.worst ? 'caution' : 'go', src: `line of sight between the two suits, ${PAIR_SEPARATION_M} m apart, 20 m DEM` };
  end(n, rover
    ? { lead: { text: `Rover saves ${hmin(Math.max(0, s.walkOnlyEvaMin - s.evaMin))}.`, tone: 'go' }, text: `On foot the EVA takes ${hmin(s.walkOnlyEvaMin)} and ${fmt(s.walkOnlyBatteryPct, 0)} % battery. With the rover it takes ${hmin(s.evaMin)} and ${fmt(s.batteryUsedPct, 0)} %. The rover speed is an assumption.`, rows: [{ label: 'On foot', value: hmin(s.walkOnlyEvaMin), tone: 'info' }, { label: 'With rover', value: hmin(s.evaMin), tone: 'go' }, pairRow] }
    : { text: tl.turnBack ? `The crew turns back at ${hmin(tl.turnBack.tS / 60)} because the reserve is reached on the way out.` : `The crew walks ${kmStr(tl.distM)} and is back after ${hmin(tl.durationS / 60)}. Drag the sun on the timeline to scrub.`, rows: [pairRow], mood: tl.turnBack ? 'warning' : 'idle' });
}

function helmet(meta: AskMeta) {
  const n = begin({ text: V.helmet, origin: meta.origin }, { card: false });
  if (!needRoute(n)) return;
  C().closeBubble();
  const tl = startWalk()!;
  useWalkUi.getState().setHelmet(true);
  n.note('Switched to the lead astronaut\'s helmet view: eye height 1.7 m, looking 25 m ahead on the route');
  n.note('Drew the heads-up marks: heading tape, distance to the next stop, slope ahead and battery reserve');
  end(n, { text: `Helmet view on route ${tl.routeId}. Press Exit helmet view or Escape to return to the map.` });
}

/**
 * The farthest any round trip could reach under the limits: top Tobler speed (on a gentle downhill) for half of the
 * usable time (EVA or battery, whichever ends first, minus the dwell). No frontier can lie beyond it, so a reach search
 * out to this radius ends where the reserve or the EVA clock binds, not at an arbitrary cap.
 */
export function reachBoundM(c: { suitSpeedFactor: number; evaMaxMin: number; batteryReservePct: number; suitPowerW: number; batteryWh: number; dwellMin: number }): number {
  const vMaxMpm = (6 * c.suitSpeedFactor * 1000) / 60;
  const pctPerMin = (c.suitPowerW / 60) / c.batteryWh * 100;
  const usable = Math.max(0, Math.min(c.evaMaxMin, (100 - c.batteryReservePct) / pctPerMin) - c.dwellMin);
  return (vMaxMpm * usable) / 2;
}
const REACH_CAP_M = 14_000; // the 20 m terrain is about 30 km across; beyond this the map edge ends most bearings anyway

async function reach(meta: AskMeta) {
  const n = begin({ text: V.reach, origin: meta.origin }, { card: false });
  const r = rt(), base = world.snapshot().base;
  if (!r?.terrain || !base) { n.say('Reach needs the Jezero terrain: take me to Jezero first').fail(); end(n, { text: 'Open Jezero Crater first.', mood: 'warning' }); return; }
  C().closeBubble();
  const centre = { lon: base.lon, lat: base.lat };
  const c0 = useWorld.getState().constraints;
  // daylight applies to reach as a clock: the EVA must be back before the sun drops below the minimum elevation at the
  // base (Mars24 from the planned start). It caps the EVA limit; comms is per route and is not applied here.
  const start = H().startUtcMs;
  const dayMin = daylightLeftMin(centre, start, c0.evaMaxMin);
  const dayBinds = dayMin < c0.evaMaxMin;
  const c = dayBinds ? { ...c0, evaMaxMin: dayMin } : c0;
  const startLtst = ltstAt(start, centre.lon).slice(0, 5);
  n.note(dayBinds
    ? `Applied daylight with Mars24: from the ${startLtst} start the sun stays above ${MIN_SUN_ELEVATION_DEG}° for ${hmin(dayMin)}, less than the ${hmin(c0.evaMaxMin)} EVA limit, so that is the EVA clock`
    : `Applied daylight with Mars24: from the ${startLtst} start the sun stays above ${MIN_SUN_ELEVATION_DEG}° for the whole ${hmin(c0.evaMaxMin)} EVA limit`);
  if (dayMin <= c0.dwellMin) {
    H().patch({ reachOn: false, reachProgress: null });
    end(n, { lead: { text: 'No daylight for a walk.', tone: 'nogo' }, text: `At the ${startLtst} start the sun is ${dayMin === 0 ? 'below' : 'about to drop below'} ${MIN_SUN_ELEVATION_DEG}° at the base, so no round trip fits in daylight. Set the start to 09:00 or Local noon under Limits.`, mood: 'warning',
      rows: [{ label: 'Start, local solar time', value: startLtst, tone: 'info' }, { label: 'Daylight left at the start', value: hmin(dayMin), tone: 'nogo', src: 'Mars24' }] });
    return;
  }
  const bound = reachBoundM(c);
  const maxR = Math.min(REACH_CAP_M, Math.ceil(bound / 500) * 500);
  const capped = bound > REACH_CAP_M;
  H().patch({ reachOn: true, reach: null, reachProgress: '0 of 24 plans', walkOn: false });
  world.applyCommands([{ type: 'focus_camera', lon: centre.lon, lat: centre.lat, distanceM: 9000 }]);
  n.note(`Worked out the search radius: ${kmStr(maxR)}, ${capped ? `capped by the size of the 20 m terrain (a round trip could reach ${kmStr(bound)})` : 'the farthest any round trip could reach at top walking speed'}`);
  const l = n.say(`Planning 24 round trips from base, one every 15° of bearing, out to ${kmStr(maxR)}`);
  const plan = async (from: LonLat, to: LonLat): Promise<RouteResult> => {
    const res = await r.terrain!.planRoute({ from, to, roundTrip: true, constraints: { ...c, objective: 'shortest' }, findMinSlope: false });
    return { ...res, id: 'reach', label: 'reach', from: pt(from, 'Base'), to: pt(to, 'Frontier') };
  };
  const t0 = performance.now();
  const res = await computeReach({
    center: centre, planRoundTrip: plan, maxRadiusM: maxR, bearings: 24,
    onProgress: (d, t, partial) => { l.text(`Planning 24 round trips from base, out to ${kmStr(maxR)}: ${d} of ${t} done`); H().patch({ reachProgress: `${d} of ${t} plans`, reach: { center: centre, maxRadiusM: maxR, samples: partial, plans: d, cancelled: false, ms: 0 } }); },
  });
  const took = performance.now() - t0;
  l.done(`Planned ${res.plans} round trips from base out to ${kmStr(maxR)}`);
  H().patch({ reach: res, reachProgress: null });
  const area = reachAreaKm2(res.samples);
  const far = res.samples.length ? Math.max(...res.samples.map((s) => s.radiusM)) : 0;
  // where the reserve (or the EVA clock) sets the edge, and where the search ended first (steep ground, map edge, cap)
  const BIND_MIN = 10;
  const binding = res.samples.filter((s) => s.status === 'limited' && s.reserveMinAtFrontier != null && s.reserveMinAtFrontier < BIND_MIN);
  const short = res.samples.filter((s) => !binding.includes(s));
  const spare = short.reduce((m, s) => Math.max(m, s.reserveMinAtFrontier ?? 0), 0);
  const atCap = res.samples.filter((s) => s.status === 'full').length;
  world.applyCommands([{ type: 'focus_camera', lon: centre.lon, lat: centre.lat, distanceM: Math.min(24_000, Math.max(9000, far * 2.3)) }]);
  n.note(`Drew the habitat and the reserve contours: home within ${fmt(area, 1)} km²`);
  n.step({ kind: 'calculation', title: 'Base camp reach', meta: `${res.plans} plans`, durMs: took, code: [
    `usable time = min(EVA ${c.evaMaxMin} min, battery to reserve ${fmt((100 - c.batteryReservePct) / ((c.suitPowerW / 60) / c.batteryWh * 100), 0)} min) - dwell ${c.dwellMin} min`,
    `search radius = top speed × usable time ÷ 2 = ${fmt(6 * c.suitSpeedFactor, 2)} km/h × usable ÷ 2 = ${kmStr(bound)}${capped ? `, capped at ${kmStr(maxR)}` : `, searched to ${kmStr(maxR)}`}`,
    `EVA clock = min(EVA limit ${c0.evaMaxMin} min, daylight left ${fmt(dayMin, 0)} min from ${startLtst} LTST, Mars24, sun >= ${MIN_SUN_ELEVATION_DEG}°) = ${c.evaMaxMin} min`,
    `for each bearing b in 0°, 15°, ..., 345°: farthest point with a round trip home (battery >= ${c.batteryReservePct} %, EVA <= ${c.evaMaxMin} min, slope <= ${c.maxSlopeDeg}°)`,
    `reserve or EVA time sets the edge on ${binding.length} of ${res.samples.length} bearings; ${short.length ? `on ${short.length} the search ended first (steep ground, the terrain edge${atCap ? ' or the search cap' : ''}) with up to ${fmt(spare, 0)} min of reserve left` : 'no bearing ended early'}`,
    `area = polygon over the ${res.samples.length} frontier points = ${fmt(area, 2)} km², farthest ${kmStr(far)}`,
    'contours are minutes of reserve left at turn-back',
  ], sources: [SRC.dem, SRC.suit], raw: { plans: res.plans, searchRadiusM: maxR, boundM: bound, samples: res.samples.map((s) => ({ bearingDeg: s.bearingDeg, radiusM: s.radiusM, status: s.status, reasons: s.reasons, reserveMinAtFrontier: s.reserveMinAtFrontier })) } });
  const edge = short.length
    ? ` On ${short.length} of ${res.samples.length} bearings the search ended before the reserve did (steep ground or the edge of the 20 m terrain${atCap ? `, or the ${kmStr(maxR)} search cap` : ''}), with up to ${fmt(spare, 0)} min of reserve left there.`
    : ' On every bearing the reserve or the EVA clock sets the edge.';
  const day = dayBinds ? ` Daylight sets the EVA clock: the sun drops below ${MIN_SUN_ELEVATION_DEG}° ${hmin(dayMin)} after the ${startLtst} start.` : ` Daylight is applied and lasts the whole ${hmin(c0.evaMaxMin)} EVA from the ${startLtst} start.`;
  end(n, {
    // battery, EVA time, slope and daylight are applied; comms is not, so the area is not a GO by itself
    lead: { text: `Home within ${fmt(area, 1)} km².`, tone: 'info' },
    text: `The crew can get back from anywhere inside the outer contour, up to ${kmStr(far)} out.${edge}${day} Comms is not applied: radio line of sight to the base is checked when you plan a route. Contours show minutes of reserve at turn-back.`,
    rows: [
      { label: 'Area', value: `${fmt(area, 1)} km²`, tone: 'info' }, { label: 'Farthest', value: kmStr(far), tone: 'info' },
      { label: 'EVA clock', value: `${hmin(c.evaMaxMin)}, ${dayBinds ? 'daylight' : 'EVA limit'}`, tone: 'info', src: 'Mars24 daylight from the planned start' },
      { label: 'Comms', value: 'checked per route', tone: 'info' },
    ],
    report: true,
  });
}

function cuff(meta: AskMeta) {
  const n = begin({ text: V.cuff, origin: meta.origin }, { card: false });
  if (!needRoute(n)) return;
  const route = activeRoute()!, ops = getOps(route.id);
  if (!ops) { n.say('The checks for this route are missing; plan it again').fail(); end(n, { text: 'Plan the route again first.', mood: 'warning' }); return; }
  const view = makeCuff(route, ops.comms, ops.startUtcMs, ops.verdict.word);
  H().patch({ cuff: view, sheet: 'cuff' });
  n.note(`Wrote the wrist checklist for ${route.id}: one line per turn with time and battery${ops.verdict.word === 'NO GO' ? ', marked NO GO, planning only' : ''}`);
  if (view.turnBack) n.note(view.turnBack);
  end(n, { text: `Cuff card ready for ${route.id}. ${view.turnBack ?? 'It lists every turn with a time and battery level.'} Download it as SVG and text from the card.` });
}

function localNoon(meta: AskMeta) {
  const route = activeRoute();
  if (!route) { const n = begin({ text: V.noon, origin: meta.origin }); needRoute(n); return; }
  const noon = nextLocalNoon(route.from, Date.now());
  H().patch({ startUtcMs: noon - (route.totals.evaMin / 2) * 60_000 });
  replanActive(V.noon, meta.origin);
}

function back(meta: AskMeta) {
  const n = begin({ text: V.back, origin: meta.origin }, { card: false });
  C().closeBubble();
  useGlobeStore.getState().applyGlobeCommands([{ type: 'exit_jezero' }]);
  n.note('Started the climb back to orbit over Jezero');
  useSession.getState().patch({ region: null, place: null });
  end(n, { text: 'Back on the whole planet. Click anywhere to read the data there.' });
}

function simpleTurn(text: string, meta: AskMeta, line: string, answer: string) {
  const n = begin({ text, origin: meta.origin }, { card: false });
  n.note(line);
  end(n, { text: answer });
}

/* ------------------------------------------------------------------ maths follow-ups (deterministic) */

/** Recognised maths questions about the active plan. Returns true when handled without the model. */
function mathsFollowUp(text: string, meta: AskMeta): boolean {
  const q = text.toLowerCase();
  const route = activeRoute();
  const ops = route ? getOps(route.id) : null;
  const c = route?.constraintsUsed ?? useWorld.getState().constraints;
  const num = (re: RegExp) => { const m = q.match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };

  // changes that act on the map: set the limit or assumption, then replan
  const mastM = num(/mast (?:height )?(?:to |at |of )?(\d+(?:\.\d+)?) ?m\b/);
  const slopeLim = num(/slope (?:limit )?(?:to |of |at )?(\d+(?:\.\d+)?) ?(?:°|deg|degrees)?/);
  const reserve = num(/reserve (?:to |of |at )?(\d+(?:\.\d+)?) ?%?/);
  const dwell = num(/dwell (?:to |of |for )?(\d+(?:\.\d+)?) ?min/);
  const wantsChange = /\b(raise|lower|set|change|make|use|replan|increase|decrease)\b/.test(q);
  if (currentPlan() && wantsChange && (mastM != null || slopeLim != null || reserve != null || dwell != null)) {
    suppressUntil = Date.now() + 300; // this turn replans itself; the limit watchers must not add a second one
    if (mastM != null) H().patch({ mastHeightM: Math.min(MAST_RANGE_M.max, Math.max(MAST_RANGE_M.min, Math.round(mastM))) });
    const patch: Record<string, number> = {};
    if (slopeLim != null) patch.maxSlopeDeg = slopeLim;
    if (reserve != null) patch.batteryReservePct = reserve;
    if (dwell != null) patch.dwellMin = dwell;
    if (Object.keys(patch).length) world.setConstraints(patch);
    replanActive(text, meta.origin);
    return true;
  }

  const n0 = () => begin({ text, origin: meta.origin, at: meta.at ?? null }, { card: false });
  const watts = num(/(\d+(?:[.,]\d+)?) ?(?:w|watts?)\b(?!h)/);
  const wh = num(/(\d+(?:[.,]\d+)?) ?wh\b/);
  const parts: { lines: string[]; code: { title: string; code: string[]; ms?: number }[]; sentences: string[] } = { lines: [], code: [], sentences: [] };
  let tb = performance.now();
  let handled = false;

  if ((watts != null || wh != null) && route && ops) {
    handled = true; tb = performance.now();
    const P = watts ?? c.suitPowerW, Cwh = wh ?? c.batteryWh;
    const b = batteryCalc(P, route.totals.evaMin, Cwh, c.batteryReservePct);
    const base = batteryCalc(c.suitPowerW, route.totals.evaMin, c.batteryWh, c.batteryReservePct);
    parts.lines.push(`Recomputed the suit battery at ${fmt(P, 0)} W and ${fmt(Cwh, 0)} Wh over the same ${hmin(route.totals.evaMin)}`, `Checked it against the ${c.batteryReservePct} % reserve: ${b.pass ? 'pass' : 'fail'}`);
    parts.code.push({ title: `Recomputed battery at ${fmt(P, 0)} W${wh != null ? `, ${fmt(Cwh, 0)} Wh` : ''}`, code: [...b.lines.slice(0, 1), `${b.lines[1].replace(/\s+(pass|fail)$/, '')}  ${b.pass ? (base.pass ? 'still pass' : 'now pass') : 'fail'}`, `was ${fmt(base.leftPct, 1)} % at ${fmt(c.suitPowerW, 0)} W and ${fmt(c.batteryWh, 0)} Wh`], ms: performance.now() - tb });
    const other = ops.goNoGo.blockers.filter((x) => x !== 'battery');
    parts.sentences.push(`At ${fmt(P, 0)} W${wh != null ? ` with ${fmt(Cwh, 0)} Wh` : ''} the battery ${b.pass ? 'still passes' : 'fails'} with ${fmt(b.leftPct, 1)} % left.${other.length ? ` The verdict stays ${ops.verdict.word} because of ${other.join(' and ')}.` : b.pass ? '' : ' That would make the walk NO GO.'}`);
  }
  if (/comms|shadow|0\.5 ?km/.test(q) && /why|limit|rule|what/.test(q)) {
    handled = true; tb = performance.now();
    parts.lines.push('Looked up where the comms rule comes from');
    parts.code.push({ title: 'Comms rule', code: [`no-go if any single radio shadow > ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km  (HeyMars planning assumption, not a NASA rule)`, `caution for any shorter shadow; mast ${H().mastHeightM} m and suit antenna 1.8 m are assumptions`, ...(route && ops ? commsCalc(route, ops.comms, world.snapshot().base, ops.mastM).slice(1) : [])], ms: performance.now() - tb });
    parts.sentences.push(`The ${fmt(COMMS_NOGO_SHADOW_M / 1000, 1)} km shadow limit is a planning assumption in HeyMars, not a NASA rule. The lever you can change is the mast height under Limits.`);
  }
  if (/slope/.test(q) && /explain|how|why|check/.test(q)) {
    handled = true; tb = performance.now();
    parts.lines.push('Wrote out the slope check on the 20 m terrain');
    parts.code.push({ title: 'Slope check', code: [
      'slope = atan(√((∂z/∂x)² + (∂z/∂y)²))  (Horn 3×3 on the 20 m DEM)',
      `edge grade = |Δh| ÷ horizontal length; edge allowed if grade <= tan ${c.maxSlopeDeg}° = ${fmt(Math.tan((c.maxSlopeDeg * Math.PI) / 180), 3)}`,
      ...(route ? [`max on ${route.id} = ${fmt(route.totals.maxSlopeDeg, 1)}° vs limit ${c.maxSlopeDeg}°  ${route.totals.maxSlopeDeg <= c.maxSlopeDeg ? 'pass' : 'fail'}`] : []),
    ], ms: performance.now() - tb });
    parts.sentences.push(`A* only crosses an edge when its grade and the steepest 20 m cell under it are at or under ${c.maxSlopeDeg}°, and both ends of the path must be too.${route ? ` The steepest stretch on ${route.id} is ${fmt(route.totals.maxSlopeDeg, 1)}°.` : ''}`);
  }
  if (/a\*|a-star|astar|search|solver/.test(q)) {
    handled = true; tb = performance.now();
    parts.lines.push('Read the route solver settings');
    const g = route?.gridResM ?? 40;
    parts.code.push({ title: 'A* settings', code: [
      `grid ${g} m cells from the ${route?.demResM ?? 20} m CTX DEM, 8-connected`,
      `objective ${c.objective}: cost = ${c.objective === 'fastest' ? '3D edge length ÷ Tobler speed (minutes)' : '3D edge length (m)'}`,
      `hard limit: edge grade and cell max slope <= ${c.maxSlopeDeg}°`,
      'heuristic: straight-line distance at peak speed (admissible)',
      ...(route ? [`last solve ${fmt(route.computeMs, 0)} ms, ${route.legs.reduce((k, l) => k + l.path.length, 0)} path vertices`] : []),
    ], ms: performance.now() - tb });
    parts.sentences.push(`Routes come from A* on a ${g} m grid with a hard ${c.maxSlopeDeg}° slope limit, minimising ${c.objective === 'fastest' ? 'walking time' : 'distance'}.`);
  }
  if (route && ops && /walk|tobler|speed|time/.test(q) && /explain|how|why|show/.test(q)) {
    handled = true; tb = performance.now();
    parts.lines.push('Wrote out the walking time calculation');
    parts.code.push({ title: 'Walking time', code: walkingCalc(route, c), ms: performance.now() - tb });
    parts.sentences.push(`Walking time is ${hmin(route.totals.evaMin)} including ${c.dwellMin} min at the target, from Tobler's hiking function scaled by ${c.suitSpeedFactor}.`);
  }
  if (route && ops && /sun|daylight|sunset|dark/.test(q)) {
    handled = true; tb = performance.now();
    parts.lines.push('Recomputed the sun along the route with Mars24');
    parts.code.push({ title: 'Sun along the route', code: sunCalc(route, ops), ms: performance.now() - tb });
    parts.sentences.push(`Daylight margin at return is ${daylightMargin(route, ops.startUtcMs).text}.`);
  }
  if (/earth|light delay|light time|delay/.test(q)) {
    const e = earthNow();
    const ln = e ? earthCalc(e.rangeAu, e.minutes) : null;
    if (ln && e?.minutes != null) {
      handled = true; tb = performance.now();
      parts.lines.push('Read the Earth to Mars range from JPL Horizons');
      parts.code.push({ title: 'Earth link delay', code: ln, ms: performance.now() - tb });
      parts.sentences.push(`A message takes ${fmt(e.minutes, 1)} minutes each way right now.`);
    }
  }
  if (!handled) return false;
  const n = n0();
  for (const l of parts.lines) n.note(l);
  for (const p of parts.code) n.step({ kind: 'calculation', title: p.title, durMs: p.ms, code: p.code, raw: { question: text, constraints: c } });
  end(n, { text: parts.sentences.join(' '), recompute: parts.code[0] ? { title: parts.code[0].title, code: parts.code.flatMap((p, i) => (i ? ['', `// ${p.title}`, ...p.code] : p.code)) } : undefined });
  return true;
}

/* ------------------------------------------------------------------ model turn */

async function askAgent(text: string, meta: AskMeta) {
  if (askBusy) return;
  askBusy = true;
  const n = begin({ text, origin: meta.origin, at: meta.at ?? null }, { engine: 'model' });
  let modelName: string | null = null;
  const cur: { l: ReturnType<Narrator['say']> | null } = { l: null }; // the one line for work in progress (model round or tool call)
  setAgentObserver((e) => {
    if (e.type === 'model-start') {
      cur.l = n.say(`Asking ${modelName ?? 'the model'} what to do next, round ${e.round + 1}`);
    } else if (e.type === 'model') {
      modelName = e.model ?? modelName;
      useThread.getState().patch(n.id, { engine: modelName ?? 'model' });
      cur.l?.done(`Asked ${modelName ?? 'the model'} what to do next, round ${e.round + 1}`); cur.l = null;
      n.step({ kind: 'model', title: `Model round ${e.round + 1}`, meta: e.usage?.total_tokens != null ? `${nf(e.usage.total_tokens)} tokens` : undefined, durMs: e.ms, text: e.model ? `model ${e.model}` : undefined, raw: { model: e.model, usage: e.usage } });
    } else if (e.type === 'tool-start') {
      cur.l = n.say(describeToolCall(e.name, e.args, toolDeps()));
    } else {
      let args: unknown = e.args; try { args = JSON.parse(e.args || '{}'); } catch { /* keep the raw text */ }
      const label = describeToolCall(e.name, e.args, toolDeps(), true);
      const err = (e.result as { error?: unknown })?.error;
      const l = cur.l ?? n.say(label); cur.l = null;
      if (err) l.fail(`${label}: ${String((e.result as { message?: unknown }).message ?? err)}`); else l.done(label);
      const ex = explainTool(e.name, args, e.result);
      n.step({ kind: 'tool', title: e.name, meta: `${e.ms} ms`, durMs: e.ms, code: [...ex.kv.map(([k, v]) => `${k} = ${v}`), ...ex.calcs], sources: ex.sources, raw: { args, result: e.result } });
    }
  });
  try {
    const res = await runAgentTurn({ userText: text, history, deps: toolDeps(), onTrace: () => {} });
    history = res.history;
    syncScatter();
    if (res.offline || !res.text) {
      const why = res.offline ? 'The language model is not configured on this server' : res.error ?? 'The language model did not answer';
      if (cur.l) cur.l.fail(why); else n.say(why).fail();
      end(n, { text: 'I could not reach the language model. Map clicks, checks, routes and maths follow-ups still work without it.', mood: 'warning', status: 'error' });
    } else {
      end(n, { text: res.text, unverified: res.unverifiedNumbers, report: res.trace.some((t) => /plan_/.test(t.tool)) });
    }
  } catch {
    if (cur.l) cur.l.fail('The language model did not answer'); else n.say('The language model did not answer').fail();
    end(n, { text: 'I could not reach the language model. Map clicks, checks, routes and maths follow-ups still work without it.', mood: 'warning', status: 'error' });
  } finally { askBusy = false; setAgentObserver(null); }
}

function syncScatter() {
  const g = useGlobeStore.getState();
  for (const ref of g.scatterShown) {
    if (g.scatter[ref.scenarioId]) continue;
    const rec = getScenario(ref.scenarioId);
    if (rec) g.setScatter(ref.scenarioId, rec.result.points, rec.request.maxSlopeDeg);
  }
}

/* ------------------------------------------------------------------ dispatch */

function dispatch(text: string, meta: AskMeta) {
  const v = matchVerb(text);
  if (!v) {
    if (lassoStop && /walk to the stop/i.test(text)) { void commitPlan(world.snapshot().base ?? lassoStop, lassoStop, { text, origin: meta.origin, at: lassoStop }); return; }
    if (mathsFollowUp(text, meta)) return;
    void askAgent(text, meta); return;
  }
  switch (v) {
    case V.land: return void landHere(meta);
    case V.scenario: return void runScenario(meta);
    case V.edl: return void runScenario(meta);
    case V.jezero: return void goJezero(meta);
    case V.limits: useHud.getState().setPopover('limits'); return;
    case V.layers: useHud.getState().togglePopover('layers'); return;
    case V.sources: useHud.getState().setSheet('sources'); return;
    case V.walkHere: return void walkHere(meta);
    case V.walk: return walkIt(meta);
    case V.helmet: return helmet(meta);
    case V.rover: return walkIt(meta, true);
    case V.reach: return void reach(meta);
    case V.cuff: return cuff(meta);
    case V.noon: return localNoon(meta);
    case V.back: return back(meta);
    case V.nearest: return nearestPoint(meta);
    case V.lassoWalk: if (lassoStop) void commitPlan(world.snapshot().base ?? lassoStop, lassoStop, { text, origin: meta.origin, at: lassoStop }); return;
    case V.replay: { const p = usePlayback.getState(); if (p.durationS > 0) { C().closeBubble(); p.seek(0); p.play(); } return; }
    case V.phases: return stepPhase();
    case V.planHere:
      if (useGlobeStore.getState().mode !== 'jezero') { void goJezero(meta).then(() => useShell.getState().setTool('plan')); return; }
      useShell.getState().setTool('plan'); return;
    case V.plan:
      if (useGlobeStore.getState().mode !== 'jezero') { void goJezero(meta).then(() => useShell.getState().setTool('plan')); return; }
      useShell.getState().setTool('plan');
      return simpleTurn(V.plan, meta, 'Ready to plan: press on the base and drag to a target', 'Drag from the base ring to any point on the 20 m terrain. I draw a live preview while you drag and check the round trip when you let go.');
    case V.lasso:
      if (useGlobeStore.getState().mode !== 'jezero') { void goJezero(meta).then(() => useShell.getState().setTool('lasso')); return; }
      useShell.getState().setTool('lasso');
      return simpleTurn(V.lasso, meta, 'Ready to lasso: draw a loop on the ground', 'Draw a closed loop on the terrain. I read the slope, geology and science stops inside it.');
  }
}

/* ------------------------------------------------------------------ wiring */

let suppressUntil = 0;

/** Subscribe everything. Returns one cleanup function. */
/* ------------------------------------------------------------------ scenario end state (QA round 3) */

function showScenarioEnd(o: ScenarioOutcome) {
  const pb = usePlayback.getState();
  if (useWalkUi.getState().helmet) return;
  const endT = formatMissionTime(pb.durationS);
  const tone = o.tone as Tone;
  const word = o.verdict;
  const estimated = o.label !== o.verdict;
  const landing = H().landing;
  if (o.kind === 'landing' && landing) {
    const st = o.stats, sc = useSession.getState().scenario;
    const inJez = insideBounds(useWorld.getState().bounds, landing.site.lon, landing.site.lat);
    const n = begin({ text: 'Landing simulation finished', origin: 'tool', at: landing.site });
    n.note(`Simulation finished at ${endT}`);
    if (o.rule) n.step({ kind: 'verdict', title: `Landing verdict: ${o.label}`, durMs: 0, text: o.reason, code: [o.rule], tone, raw: o });
    const rows: Row[] = [
      { label: 'Touchdowns simulated', value: nf(st?.samples ?? sc?.samples ?? 0), tone: 'info' },
      { label: `Within ${st?.maxSlopeDeg ?? landing.maxSlopeDeg}° slope`, value: `${fmt(st?.okPercent ?? sc?.okPercent ?? 0, 1)} %`, tone },
      { label: 'Median / 95th pct slope', value: `${sc?.slopeP50Deg ?? 0}° / ${st?.slopeP95Deg ?? sc?.slopeP95Deg ?? 0}°`, tone: 'info' },
      { label: 'Rover at touchdown point', value: ll2(landing.site), tone: 'info' },
    ];
    end(n, {
      lead: { text: 'Landing complete.', tone },
      why: { word, tone, lines: [{ text: o.reason, step: 'Landing verdict' }, ...(o.rule ? [{ text: o.rule }] : []), ...(estimated ? [{ text: '(includes estimates)' }] : [])].slice(0, 4) },
      text: `The descent ended at ${endT} with the rover on the ground at ${ll2(landing.site)}. Replay it, step through the EDL phases, or go plan a walk.`,
      rows, mood: tone === 'go' ? 'idle' : 'warning',
      card: card({ word: { text: word, tone }, title: `Landing complete. ${o.reason.replace(/\.$/, '')}${estimated ? ' (includes estimates)' : ''}`, sub: `Finished at ${endT}`, rows, point: landing.site, actions: [act(V.replay, 'rotate-ccw'), act(V.phases, 'list-ordered'), inJez ? act(V.planHere, 'route') : act(V.jezero, 'navigation')], askHint: 'Ask about this landing' }),
    });
    return;
  }
  if (o.kind === 'walk' || o.kind === 'rover-walk') {
    const tl = timelineNow(), route = activeRoute();
    if (!tl || !route) return;
    const ops = getOps(route.id);
    const s = tl.summary;
    const label = o.kind === 'rover-walk' ? 'Rover-assisted walk complete' : 'Walk complete';
    const n = begin({ text: `${o.kind === 'rover-walk' ? 'Rover assist' : 'Walk'} finished`, origin: 'tool', at: route.to });
    n.note(`Simulation finished at ${endT}`);
    const rows: Row[] = [
      { label: 'Distance walked', value: kmStr(tl.distM), tone: 'info' },
      { label: 'EVA time', value: hmin(tl.durationS / 60), tone: 'info' },
      { label: 'Battery at return', value: `${fmt(100 - s.batteryUsedPct, 1)} %`, tone: 100 - s.batteryUsedPct >= 20 ? 'go' : 'nogo' },
      { label: 'Verdict', value: o.label, tone },
    ];
    end(n, {
      lead: { text: `${label}.`, tone }, why: ops ? { ...whyRoute(ops)!, word, tone } : { word, tone, lines: [{ text: o.reason }] },
      text: `The crew is back at base at ${endT}. ${o.reason} Replay it, step through the stops, or check the walk from the helmet.`,
      rows, mood: tone === 'go' ? 'idle' : 'warning',
      card: card({ word: { text: word, tone }, title: `${label}. ${o.reason.replace(/\.$/, '')}`, sub: `${kmStr(tl.distM)} round trip, back at ${endT}`, rows, point: route.to, actions: [act(V.replay, 'rotate-ccw'), act(V.phases, 'list-ordered'), act(V.helmet, 'scan-eye'), act(V.cuff, 'clipboard-list')], askHint: 'Ask about this walk' }),
    });
    return;
  }
  if (o.kind === 'base-camp') {
    const b = world.snapshot().base;
    if (!b) return;
    const n = begin({ text: 'Base camp reach finished', origin: 'tool', at: b });
    n.note('Base camp reach finished');
    end(n, {
      lead: { text: 'Base camp reach complete.', tone }, why: { word, tone, lines: [{ text: o.reason }, ...(estimated ? [{ text: '(includes estimates)' }] : [])] },
      text: o.reason,
      card: card({ word: { text: word, tone }, title: `Base camp reach complete. ${o.reason.replace(/\.$/, '')}`, sub: ll2(b), rows: [], point: b, actions: [act(V.plan, 'route'), act(V.walkHere, 'footprints')], askHint: 'Ask about the reach' }),
    });
  }
}

/** "Step through phases": jump to the next EDL phase (landing) or the next stop (walk) after the playhead, pausing there. */
function stepPhase() {
  const pb = usePlayback.getState();
  const times = pb.kind === 'landing'
    ? (useGlobal.getState().gs?.edlPhases() ?? []).map((p) => p.tStartS)
    : (timelineNow()?.markers ?? []).map((m) => m.tS);
  const ts = [...new Set(times.filter((x) => x >= 0 && x <= pb.durationS))].sort((a, b) => a - b);
  if (!ts.length) return;
  const next = ts.find((x) => x > pb.t + 0.5) ?? ts[0];
  C().closeBubble();
  pb.pause(); pb.seek(next);
}

export function startFlow(): () => void {
  const offs: (() => void)[] = [];
  offs.push(onGlobePick((p) => { if (p.kind === 'click' && useGlobeStore.getState().mode === 'globe') void onGlobeClick(p); }));
  offs.push(onClickPoint((p) => { if (useGlobeStore.getState().mode === 'jezero') void onJezeroClick(p); }));
  offs.push(onAsk(dispatch));
  offs.push(useGlobeStore.subscribe((s, prev) => {
    if (s.mode === prev.mode) return;
    C().closeBubble();
    C().setMode(s.mode);
    if (s.mode === 'globe') {
      useWalkUi.getState().setHelmet(false);
      useShell.getState().setTool(null);
      H().patch({ walkOn: false, reachOn: false, preview: null, verdict: null, cuff: null, popover: null, activeRouteId: null });
      usePlayback.getState().load({ scenarioId: 'idle', kind: 'walk', durationS: 0 });
    } else {
      world.setSelected(null);
      stopLandingSimulation();
      H().patch({ landing: null, edl: false, popover: null });
      useSession.getState().patch({ region: 'Jezero Crater' });
      // settle the camera on the base once the scene has mounted
      window.setTimeout(() => { const b = world.snapshot().base; if (b) world.applyCommands([{ type: 'focus_camera', lon: b.lon, lat: b.lat, distanceM: 9000 }]); }, 900);
      usePlayback.getState().load({ scenarioId: 'idle', kind: 'walk', durationS: 0 });
    }
  }));
  offs.push(useGlobeStore.subscribe((s, prev) => { if (s.scatterShown !== prev.scatterShown) syncScatter(); }));
  // a clear end state: the simulations emit one end event per run (landing after its testing phase, walk and rover at
  // the end of the playback, base camp reach when its plans are done); each gets a completion turn and card
  offs.push(onScenarioEnd(showScenarioEnd));
  // changing a limit or the mast height replans the route MarsAgent is talking about, as one turn that names the change
  let timer = 0;
  const describe = (prevC: Record<string, unknown>, nextC: Record<string, unknown>) => Object.keys(nextC).filter((k) => nextC[k] !== prevC[k]).map((k) => `${k} ${String(prevC[k])} to ${String(nextC[k])}`).join(', ');
  offs.push(useWorld.subscribe((s, prev) => {
    if (s.constraints === prev.constraints || !currentPlan()) return;
    if (Date.now() < suppressUntil) return;
    const what = describe(prev.constraints as unknown as Record<string, unknown>, s.constraints as unknown as Record<string, unknown>);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => replanActive(`Limits changed: ${what}`, 'tool'), 450);
  }));
  offs.push(useHud.subscribe((s, prev) => {
    if (s.mastHeightM === prev.mastHeightM || !currentPlan()) return;
    if (Date.now() < suppressUntil) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => replanActive(`Comms mast ${prev.mastHeightM} m to ${s.mastHeightM} m`, 'tool'), 450);
  }));
  return () => { offs.forEach((f) => f()); window.clearTimeout(timer); };
}
