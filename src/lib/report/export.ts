/**
 * Report renderers: Markdown, JSON (every input, tool call, result and formula) and GeoJSON (route legs with per-vertex
 * elevation). Pure functions, plus one browser helper that saves a string as a file.
 */
import type { RouteResult } from '../contracts';
import type { RouteOpsLike } from '../agent/explain';
import { cellText, type Report, type ReportInput, type Table } from './build';

const mdEsc = (s: string) => s.replace(/\|/g, '\\|');

function mdTable(t: Table): string {
  const head = `| ${t.head.map(mdEsc).join(' | ')} |`;
  const sep = `| ${t.head.map((_, i) => (t.num?.includes(i) ? '---:' : '---')).join(' | ')} |`;
  return [head, sep, ...t.rows.map((r) => `| ${r.map((c) => mdEsc(cellText(c))).join(' | ')} |`)].join('\n');
}

export function toMarkdown(r: Report): string {
  const out: string[] = [
    `# ${r.title}`, '', r.subtitle, '',
    `Report ${r.id}, generated ${r.generatedIso.slice(0, 16).replace('T', ' ')} UTC.`, '',
  ];
  if (r.verdict) out.push(`**Verdict: ${r.verdict.word}.** ${r.verdict.reason}`, '');
  if (r.mocks.length) out.push(...r.mocks.map((m) => `> ${m}`), '');
  for (const s of r.sections) {
    out.push(`## ${s.n}. ${s.title}`, '');
    if (s.lead) out.push(s.lead, '');
    for (const t of s.tables) out.push(mdTable(t), '');
    for (const c of s.calcs ?? []) out.push(`**${c.n} ${c.title}**${c.note ? ` (${c.note})` : ''}`, '', '```', ...c.lines, '```', '');
    for (const l of s.list ?? []) out.push(`- ${l}`);
    if (s.list?.length) out.push('');
    for (const n of s.notes ?? []) out.push(n, '');
  }
  out.push('---', '', r.byline, '');
  return out.join('\n');
}

/** Typed arrays and very long arrays are summarised so the JSON stays readable. */
function replacer(_k: string, v: unknown) {
  if (ArrayBuffer.isView(v)) return `${(v as { constructor: { name: string } }).constructor.name}(${(v as unknown as { length: number }).length})`;
  return v;
}

export function toJson(r: Report, input: ReportInput): string {
  const doc = {
    schema: 'heymars.report.v1',
    id: r.id, generated: r.generatedIso, title: r.title, verdict: r.verdict, mocks: r.mocks,
    inputs: {
      constraints: input.constraints, base: input.base, mastHeightM: input.ops?.mastM ?? null,
      startUtc: input.ops ? new Date(input.ops.startUtcMs).toISOString() : null,
      target: input.route ? input.route.to : null,
    },
    route: input.route ? {
      id: input.route.id, feasible: input.route.feasible, reasons: input.route.reasons, minFeasibleSlopeDeg: input.route.minFeasibleSlopeDeg ?? null, targetSlopeDeg: input.route.targetSlopeDeg ?? null, totals: input.route.totals, gridResM: input.route.gridResM, demResM: input.route.demResM,
      legs: input.route.legs.map((l) => ({ lengthM: l.lengthM, horizM: l.horizM, ascentM: l.ascentM, descentM: l.descentM, maxSlopeDeg: l.maxSlopeDeg, timeMin: l.timeMin, vertices: l.path.length })),
    } : null,
    goNoGo: input.ops?.goNoGo ?? null,
    earthLink: input.earth,
    landingCheck: input.landing,
    landingScenario: input.scenario,
    scienceAtTarget: input.science ?? null,
    validation: input.validation,
    formulas: r.sections.flatMap((s) => (s.calcs ?? []).map((c) => ({ n: c.n, title: c.title, lines: c.lines, mock: c.note === 'Mock' }))),
    sections: r.sections.map((s) => ({ n: s.n, title: s.title, lead: s.lead, tables: s.tables.map((t) => ({ head: t.head, rows: t.rows.map((row) => row.map(cellText)) })), notes: s.notes, list: s.list })),
    toolCalls: input.turns.flatMap((t) => t.steps.filter((s) => s.kind === 'tool' || s.kind === 'model').map((s) => ({ turn: t.seq, kind: s.kind, name: s.title, meta: s.meta ?? null, raw: s.raw ?? null }))),
    trace: input.turns.map((t) => ({
      turn: t.seq, question: t.question, origin: t.origin, engine: t.engine, started: new Date(t.startedAt).toISOString(), ended: t.endedAt ? new Date(t.endedAt).toISOString() : null,
      narration: t.narration.map((n) => ({ text: n.text, durationMs: n.tMs == null ? null : Math.round(n.tMs * 10) / 10 })),
      steps: t.steps.map((s) => ({ kind: s.kind, title: s.title, meta: s.meta ?? null, durationMs: s.durMs == null ? null : Math.round(s.durMs * 100) / 100, text: s.text ?? null, formula: s.code ?? null, raw: s.raw ?? null })),
    })),
  };
  return JSON.stringify(doc, replacer, 2);
}

export function routeGeoJson(route: RouteResult | null, ops: RouteOpsLike | null): string {
  const features: unknown[] = [];
  if (route) {
    route.legs.forEach((l, i) => {
      const name = route.roundTrip && i === route.legs.length - 1 ? 'return' : route.legs.length > 2 ? `leg ${i + 1}` : 'outbound';
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: l.path.map((p) => [round(p.lon, 7), round(p.lat, 7), round(p.h, 1)]) },
        properties: { routeId: route.id, leg: name, lengthM: round(l.lengthM, 1), ascentM: round(l.ascentM, 1), descentM: round(l.descentM, 1), maxSlopeDeg: round(l.maxSlopeDeg, 2), walkMin: round(l.timeMin, 1), segSlopeDeg: l.segSlopeDeg.map((s) => round(s, 2)), elevationNote: 'third coordinate is DEM elevation in metres (MRO CTX DEM 20 m, Mars 2000 sphere datum)' },
      });
    });
    const pt = (p: { lon: number; lat: number; elevationM: number | null }, role: string) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [round(p.lon, 7), round(p.lat, 7), p.elevationM == null ? null : round(p.elevationM, 1)] }, properties: { role } });
    features.push(pt(route.from, 'start'), pt(route.to, 'target'));
    for (const s of ops?.comms?.shadows ?? []) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[s.start.lon, s.start.lat], [s.end.lon, s.end.lat]] }, properties: { role: 'comms-shadow', lengthM: round(s.lengthM, 1) } });
  }
  return JSON.stringify({
    type: 'FeatureCollection',
    name: route ? `heymars-${route.id}` : 'heymars-empty',
    crs_note: 'Mars 2000 planetocentric longitude east, latitude; not WGS84',
    properties: {
      verdict: ops?.verdict.word ?? null, mock: route ? false : 'no route planned in this session',
      ...(route ? { feasible: route.feasible, reasons: route.reasons, roundTripLengthM: round(route.totals.lengthM, 1), legCount: route.legs.length } : {}),
      ...(route && !route.legs.length ? { note: 'no path under the slope limit: the target is shown, no leg exists' } : {}),
    },
    features,
  }, null, 2);
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Save text as a download (browser only). */
export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
