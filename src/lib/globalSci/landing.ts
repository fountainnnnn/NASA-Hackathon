import type { GlobalLayerId, LandingCheck, LandingCriterion, SiteConditions } from '../globeContracts';
import type { LandingCheckResult } from './types';

/** Shape of public/data/global/landing_criteria.json */
export interface CriterionDef {
  id: string; label: string;
  kind: 'latitude' | 'elevation' | 'slope-global' | 'layer' | 'unassessable';
  op: string; limit: number; unit: string; required: boolean; limitText: string;
  layerId?: GlobalLayerId;
  baselineKmRange?: [number, number];
  unassessableReason?: string;
  source: { title: string; url: string; quote?: string };
}
export interface CriteriaFile {
  version: number; caveat: string; verdictRule: string;
  ellipse: LandingCheck['ellipse'] & { quote?: string; azimuthNote?: string };
  criteria: CriterionDef[];
}

const cmp = (op: string, v: number, limit: number): boolean => {
  switch (op) {
    case '<=': case '~<=': return v <= limit;
    case '<': return v < limit;
    case '>=': return v >= limit;
    case '>': return v > limit;
    case 'abs<=': return Math.abs(v) <= limit;
    default: throw new Error(`unknown criterion op ${op}`);
  }
};

const unitMatchesTI = (u: string) => /tiu|J\s*m\s*-?\^?\(?-?2|J\/\(?m/i.test(u);

export interface LandingInputs {
  lon: number; lat: number;
  conditions: SiteConditions;
  /** global DEM posting in km (for the 2-5 km slope criterion) */
  demResKm: number | null;
}

/**
 * Evaluates the criteria against what the global data can say. Missing data -> pass = null (never a guess).
 * Verdict: fails-some if any evaluated criterion fails; meets-all if every required criterion is evaluated and
 * passes; otherwise insufficient-data.
 */
export function evaluateLanding(file: CriteriaFile | null, inp: LandingInputs): LandingCheckResult {
  const site = { lon: inp.lon, lat: inp.lat };
  const notes: string[] = [];
  if (!file) {
    return {
      site, criteria: [], verdict: 'insufficient-data',
      ellipse: { semiMajorKm: NaN, semiMinorKm: NaN, azimuthDeg: 0, source: { title: 'unavailable', url: '' } },
      notes: ['Landing criteria file is not loaded.'], criteriaCaveat: '',
    };
  }
  const c = inp.conditions;
  const criteria: LandingCriterion[] = file.criteria.map((d) => {
    let value: number | null = null;
    let pass: boolean | null = null;
    switch (d.kind) {
      case 'latitude':
        value = inp.lat; pass = cmp(d.op, value, d.limit); break;
      case 'elevation':
        value = c.elevationM;
        pass = value == null ? null : cmp(d.op, value, d.limit);
        break;
      case 'slope-global': {
        value = c.slopeDeg;
        const base = inp.demResKm == null ? null : 2 * inp.demResKm;
        const [lo, hi] = d.baselineKmRange ?? [0, Infinity];
        if (value == null) pass = null;
        else if (base == null || base < lo || base > hi) {
          pass = null;
          notes.push(`Global DEM slope uses a ~${base == null ? '?' : base.toFixed(1)} km baseline, outside the ${lo}-${hi} km scale of this criterion, so it is not scored.`);
        } else pass = cmp(d.op, value, d.limit);
        break;
      }
      case 'layer': {
        const layer = c.layers.find((l) => l.id === d.layerId);
        value = layer?.value ?? null;
        if (value == null) pass = null;
        else if (layer && !unitMatchesTI(layer.unit)) {
          pass = null;
          notes.push(`${d.label}: layer unit "${layer.unit}" does not match ${d.unit}, so it is not scored.`);
        } else pass = cmp(d.op, value, d.limit);
        break;
      }
      case 'unassessable':
        notes.push(`${d.label}: ${d.unassessableReason ?? 'not assessable from global data'}.`);
        break;
    }
    return {
      id: d.id, label: d.label, value: value == null || Number.isNaN(value) ? null : value, unit: d.unit,
      limit: d.limitText, pass, source: { title: d.source.title, url: d.source.url },
    };
  });
  const byId = new Map(file.criteria.map((d) => [d.id, d]));
  const scored = criteria.filter((x) => x.pass !== null);
  const required = criteria.filter((x) => byId.get(x.id)?.required);
  let verdict: LandingCheck['verdict'];
  if (scored.some((x) => x.pass === false)) verdict = 'fails-some';
  else if (required.length > 0 && required.every((x) => x.pass === true)) verdict = 'meets-all';
  else verdict = 'insufficient-data';
  return { site, criteria, verdict, ellipse: { ...file.ellipse }, notes, criteriaCaveat: file.caveat };
}
