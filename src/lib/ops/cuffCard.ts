/**
 * Apollo-style wrist/cuff checklist for a planned route. Every number is taken from the route, its timeline,
 * the comms result, the Mars24 sun model or MissionConstraints — nothing is invented. Layout thresholds
 * (what counts as a "significant turn", max rows) are ASSUMPTIONS in assumptions.ts.
 */
import type { MissionConstraints, RouteResult } from '../contracts';
import type { CommsResult, CuffCard, CuffRow, Timeline, TimelineSample } from '../opsContracts';
import { bearingDeg, groundDistanceM } from '../geo/frame';
import { R_MARS } from '../contracts';
import { toblerKmh } from '../terrain/astar';
import { CUFF_MAX_ROWS, CUFF_SIMPLIFY_TOL_M, CUFF_TURN_DEG, MIN_SUN_ELEVATION_DEG } from './assumptions';
import { marsState, sunPositionFromState } from './mars24';
import { buildTimeline } from './timeline';

const DEG = Math.PI / 180;
const MIN_MS = 60_000;

export interface CuffInput {
  route: RouteResult;
  comms?: CommsResult | null;
  /** EVA start (UTC). Enables sun elevation and the daylight limit on the turn-back time. */
  startUtc?: Date | number | null;
  minSunElevationDeg?: number;
  maxRows?: number;
  constraints?: MissionConstraints;
}

/* ------------------------------------------------------------------ formatting */

export const fmtT = (min: number, floor = false): string => {
  const m = Math.max(0, floor ? Math.floor(min + 1e-9) : Math.round(min));
  return `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(4)}${lat >= 0 ? 'N' : 'S'}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(4)}${lon >= 0 ? 'E' : 'W'}`;
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

/* ------------------------------------------------------------------ turn detection */

/** Douglas–Peucker on local metres; returns kept indices (ascending, incl. both ends). */
function simplify(pts: { x: number; y: number }[], tol: number): number[] {
  const keep = new Set<number>([0, pts.length - 1]);
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let dmax = 0, imax = -1;
    const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9 ? Math.hypot(pts[i].x - pts[a].x, pts[i].y - pts[a].y)
        : Math.abs(dy * (pts[i].x - pts[a].x) - dx * (pts[i].y - pts[a].y)) / L;
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (imax >= 0 && dmax > tol) { keep.add(imax); stack.push([a, imax], [imax, b]); }
  }
  return [...keep].sort((p, q) => p - q);
}

/** Interior corners of a leg whose heading change is at least CUFF_TURN_DEG: {vertex, turnDeg}. */
function legTurns(leg: RouteResult['legs'][number]): { vertex: number; turnDeg: number }[] {
  const p = leg.path;
  if (p.length < 3) return [];
  const lat0 = p[0].lat, lon0 = p[0].lon;
  const mLat = R_MARS * DEG, mLon = R_MARS * Math.cos(lat0 * DEG) * DEG;
  const xy = p.map((q) => ({ x: (q.lon - lon0) * mLon, y: (q.lat - lat0) * mLat }));
  const idx = simplify(xy, CUFF_SIMPLIFY_TOL_M);
  const out: { vertex: number; turnDeg: number }[] = [];
  for (let m = 1; m + 1 < idx.length; m++) {
    const hin = bearingDeg(p[idx[m - 1]], p[idx[m]]), hout = bearingDeg(p[idx[m]], p[idx[m + 1]]);
    const turn = Math.abs(((hout - hin + 540) % 360) - 180);
    if (turn >= CUFF_TURN_DEG) out.push({ vertex: idx[m], turnDeg: turn });
  }
  return out;
}

/* ------------------------------------------------------------------ return profile / turn-back */

/** Walk-back profile used for the turn-back time: the planned return leg, or (one-way routes) the outbound path reversed. */
function returnProfile(route: RouteResult, tl: Timeline): { tau: number; lat: number; lon: number }[] {
  const k = route.constraintsUsed;
  if (route.roundTrip && route.legs.length > 1) {
    const last = tl.samples.filter((s) => s.leg === route.legs.length - 1);
    return last.map((s) => ({ tau: s.tMin - last[0].tMin, lat: s.lat, lon: s.lon }));
  }
  const pts = route.legs.flatMap((l, i) => (i === 0 ? l.path : l.path.slice(1))).slice().reverse();
  const out = pts.length ? [{ tau: 0, lat: pts[0].lat, lon: pts[0].lon }] : [];
  let t = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const horiz = groundDistanceM(a, b), dh = b.h - a.h;
    t += Math.hypot(horiz, dh) / (toblerKmh(dh / horiz, k.suitSpeedFactor) * 1000 / 60);
    out.push({ tau: t, lat: b.lat, lon: b.lon });
  }
  return out;
}

/* ------------------------------------------------------------------ text helpers */

function wrap(s: string, width: number, indent = '   '): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > width) { lines.push(cur); cur = indent + w; } else cur = (cur ? cur + ' ' : '') + w;
  }
  if (cur) lines.push(cur);
  return lines;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ------------------------------------------------------------------ main */

export function buildCuffCard(input: CuffInput): CuffCard {
  const { route, comms } = input;
  const k = input.constraints ?? route.constraintsUsed;
  const maxRows = input.maxRows ?? CUFF_MAX_ROWS;
  const tl = buildTimeline(route);
  const S = tl.samples;
  const startMs = input.startUtc == null ? null : typeof input.startUtc === 'number' ? input.startUtc : input.startUtc.getTime();
  const minSun = input.minSunElevationDeg ?? MIN_SUN_ELEVATION_DEG;
  const sunAt = (tMin: number, lat: number, lon: number): number | null =>
    startMs === null ? null : sunPositionFromState(marsState(startMs + tMin * MIN_MS), lat, lon).elevationDeg;

  // ---- choose rows
  type Cand = { idx: number; kind: CuffRow['kind']; turnDeg: number };
  const mandatory: Cand[] = [];
  let stopN = 0;
  for (const s of S) {
    if (s.kind === 'start') mandatory.push({ idx: s.idx, kind: 'start', turnDeg: 360 });
    else if (s.kind === 'stop') mandatory.push({ idx: s.idx, kind: 'stop', turnDeg: 360 });
    else if (s.kind === 'target') mandatory.push({ idx: s.idx, kind: 'target', turnDeg: 360 });
    else if (s.kind === 'end') mandatory.push({ idx: s.idx, kind: 'end', turnDeg: 360 });
  }
  const turns: Cand[] = [];
  route.legs.forEach((leg, li) => {
    for (const t of legTurns(leg)) {
      const s = S.find((q) => q.leg === li && q.vertex === t.vertex);
      if (s) turns.push({ idx: s.idx, kind: 'turn', turnDeg: t.turnDeg });
    }
  });
  turns.sort((a, b) => b.turnDeg - a.turnDeg);
  const room = Math.max(0, maxRows - mandatory.length);
  const chosen = [...mandatory, ...turns.slice(0, room)].sort((a, b) => a.idx - b.idx);

  const rows: CuffRow[] = chosen.map((c, i) => {
    const s: TimelineSample = S[c.idx];
    if (c.kind === 'stop') stopN++;
    return {
      n: i + 1, kind: c.kind,
      label: c.kind === 'start' ? 'START' : c.kind === 'stop' ? `STOP${stopN}` : c.kind === 'target' ? 'TARGET' : c.kind === 'end' ? 'END' : 'TURN',
      lat: s.lat, lon: s.lon, latStr: fmtLat(s.lat), lonStr: fmtLon(s.lon),
      cumDistM: s.distM, elapsedMin: s.tMin, batteryPct: s.batteryPct, headingToNextDeg: null, shadowAhead: false,
      sunElevationDeg: sunAt(s.tMin, s.lat, s.lon),
    };
  });
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = S[chosen[i].idx], b = S[chosen[i + 1].idx];
    rows[i].headingToNextDeg = a.lat === b.lat && a.lon === b.lon ? null : Math.round(bearingDeg(a, b)) % 360;
    rows[i].shadowAhead = !!comms && comms.shadows.some((sh) => sh.endIdx >= chosen[i].idx && sh.startIdx <= chosen[i + 1].idx);
  }

  // ---- turn-back time
  const limitBatteryMin = (100 - k.batteryReservePct) / tl.pctPerMin;
  const rp = returnProfile(route, tl);
  const returnWalkMin = rp.length ? rp[rp.length - 1].tau : 0;
  let tbMin = Math.min(k.evaMaxMin, limitBatteryMin) - returnWalkMin;
  let limitedBy: 'battery' | 'eva-time' | 'daylight' = limitBatteryMin <= k.evaMaxMin ? 'battery' : 'eva-time';
  const warnings: string[] = [];
  const hasPlan = S.length > 0;
  if (startMs !== null && rp.length) {
    const stride = Math.max(1, Math.floor(rp.length / 80));
    const thin = rp.filter((_, i) => i % stride === 0 || i === rp.length - 1);
    const okAt = (T: number) => thin.every((p) => sunPositionFromState(marsState(startMs + (T + p.tau) * MIN_MS), p.lat, p.lon).elevationDeg >= minSun);
    if (!okAt(tbMin)) {
      let found: number | null = null;
      for (let T = Math.floor(tbMin); T >= 0; T--) if (okAt(T)) { found = T; break; }
      if (found === null) warnings.push(`DAYLIGHT: walk-back is below ${minSun} deg sun for any turn-back time`);
      else { tbMin = found; limitedBy = 'daylight'; }
    }
  }
  const turnBack = hasPlan
    ? { tMin: tbMin, label: `No later than ${fmtT(tbMin, true)} turn back`, limitedBy, returnWalkMin }
    : null;
  if (turnBack) {
    const departMin = (() => {
      const lastOut = S.filter((s) => s.kind === 'target').pop();
      return lastOut ? lastOut.tMin + lastOut.dwellAfterMin : 0;
    })();
    if (departMin > tbMin + 1e-9) warnings.push(`PLAN LEAVES TARGET ${Math.round(departMin - tbMin)} MIN AFTER TURN-BACK TIME`);
  }

  // ---- comms warnings
  if (!comms) warnings.push('COMMS NOT EVALUATED (no station set)');
  else {
    const wpBefore = (idx: number) => rows.filter((r, i) => chosen[i].idx <= idx).pop()?.n ?? 1;
    const wpAfter = (idx: number) => rows.find((r, i) => chosen[i].idx >= idx)?.n ?? rows.length;
    const MAXW = 4;
    comms.shadows.slice(0, MAXW).forEach((sh) => {
      warnings.push(`LOS LOST ${fmtT(sh.startMin)}-${fmtT(sh.endMin)} ${Math.round(sh.lengthM)}-${Math.round(sh.maxLengthM)} m WP${String(wpBefore(sh.startIdx)).padStart(2, '0')}>WP${String(wpAfter(sh.endIdx)).padStart(2, '0')}`);
    });
    if (comms.shadows.length > MAXW) warnings.push(`+${comms.shadows.length - MAXW} MORE SHADOW STRETCHES (see app)`);
  }

  // ---- abort rules (constraints only)
  const hhmm = (m: number) => fmtT(m);
  const abortRules: string[] = [];
  if (turnBack) abortRules.push(`Not at the far point by ${fmtT(tbMin, true)}: TURN BACK (limit: ${limitedBy}).`);
  abortRules.push(`Battery below ${k.batteryReservePct}%: ABORT, walk back now.`);
  abortRules.push(`EVA clock past ${hhmm(k.evaMaxMin)}: ABORT.`);
  abortRules.push(`Slope above ${k.maxSlopeDeg} deg on the path: do not cross, detour or turn back.`);
  if (startMs !== null) abortRules.push(`Sun below ${minSun} deg: ABORT.`);
  abortRules.push('Link lost outside a planned shadow: stop, retrace to last WP with link.');

  // ---- text block
  const W = 60;
  const head: { t: string; c: 'h' | 't' | 'w' | 'd' }[] = [];
  head.push({ t: `MARSWALK CUFF CARD  ${route.id || 'ROUTE'}  ${route.roundTrip ? 'ROUND TRIP' : 'ONE WAY'}`, c: 'h' });
  head.push({ t: `${startMs !== null ? 'START ' + fmtUtc(startMs) : 'START TIME NOT SET'}`, c: 't' });
  head.push({ t: `EVA ${fmtT(tl.totalMin)}  DIST ${(tl.totalDistM / 1000).toFixed(2)}km  MAXSLP ${route.totals.maxSlopeDeg.toFixed(1)}deg`, c: 't' });
  head.push({ t: `LIM SLOPE ${k.maxSlopeDeg}deg BAT RES ${k.batteryReservePct}% EVA ${k.evaMaxMin}min`, c: 'd' });
  head.push({ t: '-'.repeat(W), c: 'd' });
  head.push({ t: 'WP T+hh:mm DIST    BAT  HDG LAT/LON', c: 'd' });
  const body = rows.map((r) => ({
    t: `${String(r.n).padStart(2, '0')} ${fmtT(r.elapsedMin)} ${((r.cumDistM / 1000).toFixed(2) + 'km').padStart(7)} ${(Math.round(r.batteryPct) + '%').padStart(4)} ${r.headingToNextDeg === null ? '---' : String(r.headingToNextDeg).padStart(3, '0')} ${r.latStr} ${r.lonStr} ${r.label}${r.shadowAhead ? ' LOS' : ''}`,
    c: 't' as const,
  }));
  const tail: { t: string; c: 'h' | 't' | 'w' | 'd' }[] = [{ t: '-'.repeat(W), c: 'd' }];
  if (turnBack) tail.push({ t: turnBack.label.toUpperCase(), c: 'h' }, { t: `(return walk ${Math.round(returnWalkMin)} min, limit: ${limitedBy})`, c: 'd' });
  for (const w of warnings) for (const l of wrap(w, W)) tail.push({ t: l, c: 'w' });
  tail.push({ t: 'ABORT RULES', c: 'h' });
  abortRules.forEach((r, i) => wrap(`${i + 1}. ${r}`, W).forEach((l) => tail.push({ t: l, c: 't' })));
  const lines = [...head, ...body, ...tail];
  const text = lines.map((l) => l.t).join('\n');

  // ---- markdown
  const md: string[] = [`### MarsWalk cuff card — ${route.id || 'route'} (${route.roundTrip ? 'round trip' : 'one way'})`, ''];
  md.push(`${startMs !== null ? `Start ${fmtUtc(startMs)}` : 'Start time not set'} · EVA ${fmtT(tl.totalMin)} · ${(tl.totalDistM / 1000).toFixed(2)} km · max slope ${route.totals.maxSlopeDeg.toFixed(1)}°`, '');
  md.push('| WP | T+ | Dist km | Batt % | Hdg | Lat | Lon | Note |', '|---:|---|---:|---:|---:|---|---|---|');
  for (const r of rows) {
    md.push(`| ${r.n} | ${fmtT(r.elapsedMin)} | ${(r.cumDistM / 1000).toFixed(2)} | ${Math.round(r.batteryPct)} | ${r.headingToNextDeg ?? '—'} | ${r.latStr} | ${r.lonStr} | ${r.label}${r.shadowAhead ? ' · LOS shadow ahead' : ''} |`);
  }
  md.push('');
  if (turnBack) md.push(`**${turnBack.label}** (return walk ${Math.round(returnWalkMin)} min; limited by ${limitedBy}).`, '');
  if (warnings.length) md.push(...warnings.map((w) => `- ⚠ ${w}`), '');
  md.push('**Abort rules**', ...abortRules.map((r, i) => `${i + 1}. ${r}`));
  const markdown = md.join('\n');

  // ---- SVG 600x900
  const fs = 14, lh = 19, x0 = 24;
  const col = { h: '#ffb454', t: '#d7e0ea', w: '#ff7b72', d: '#7d8da1' };
  const texts = lines.slice(0, Math.floor((900 - 60) / lh)).map((l, i) =>
    `<text x="${x0}" y="${44 + i * lh}" fill="${col[l.c]}" xml:space="preserve">${esc(l.t)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900" font-family="Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="${fs}"><rect width="600" height="900" fill="#0b0f14"/><rect x="8" y="8" width="584" height="884" rx="6" fill="none" stroke="#2a3441"/>${texts}</svg>`;

  return {
    title: `MarsWalk cuff card ${route.id || ''}`.trim(), routeId: route.id,
    startUtc: startMs === null ? null : new Date(startMs).toISOString(),
    rows, warnings, turnBack, abortRules, text, markdown, svg,
  };
}
