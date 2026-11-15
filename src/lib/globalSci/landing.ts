import type { FillProvenance, GlobalLayerId, LandingCheck, LandingCriterion, SiteConditions } from '../globeContracts';
import { HURST, mockElevation, mockRockAbundance, mockSlope, mockThermalInertia, scaleSlope, siteHash } from './fill';
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

/** Baseline (km) at which each rover-scale slope criterion is defined; used to scale the MOLA slope as an estimate. */
const BASELINE_KM: Record<string, number> = { 'slope-2-5km': 3.5, 'slope-200-500m': 0.35, 'slope-20-40m': 0.03, 'slope-5m': 0.005 };

/**
 * Evaluates the criteria. Every criterion gets a value and a pass/fail (QA round 3: no "not enough data" verdict):
 *  - observed: read from the global data at the point;
 *  - estimate: derived from real data (a slope at another baseline scaled from the MOLA slope with a Hurst exponent of
 *    0.75; thermal inertia or elevation from the nearest valid cell within 200 km);
 *  - mock: a plausible, deterministic value seeded by lon/lat when nothing can be derived (rock abundance).
 * Verdict: fails-some if any criterion fails, else meets-all; `estimated` is true when any value is an estimate or a mock.
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
  const base = inp.demResKm == null ? null : 2 * inp.demResKm;
  const slopeProv = c.fills?.slope;
  const slopeFrom = (toKm: number, label: string): { value: number; provenance: FillProvenance; method: string } => {
    const s0 = c.slopeDeg ?? mockSlope(inp.lon, inp.lat);
    const prov: FillProvenance = c.slopeDeg == null || slopeProv?.provenance === 'mock' ? 'mock' : 'estimate';
    const b = base ?? 14.8;
    return {
      value: scaleSlope(s0, b, toKm), provenance: prov,
      method: `${label}: MOLA slope ${s0.toFixed(2)} deg at a ~${b.toFixed(1)} km baseline scaled to ${toKm >= 1 ? `${toKm} km` : `${Math.round(toKm * 1000)} m`} as s(L) = s(L0) * (L0 / L)^(1 - H), H = ${HURST} (assumption)`,
    };
  };
  const criteria: LandingCriterion[] = file.criteria.map((d) => {
    let value: number, provenance: FillProvenance = 'observed', method = d.source.title;
    switch (d.kind) {
      case 'latitude':
        value = inp.lat; break;
      case 'elevation':
        if (c.elevationM == null) { value = mockElevation(inp.lon, inp.lat); provenance = 'mock'; method = 'mock elevation, seeded by lon/lat'; }
        else { value = c.elevationM; if (c.fills?.elevation) ({ provenance, method } = c.fills.elevation); }
        break;
      case 'slope-global': {
        const [lo, hi] = d.baselineKmRange ?? [0, Infinity];
        if (c.slopeDeg != null && base != null && base >= lo && base <= hi) { value = c.slopeDeg; if (slopeProv) ({ provenance, method } = slopeProv); }
        else {
          ({ value, provenance, method } = slopeFrom(BASELINE_KM[d.id] ?? (lo + hi) / 2, d.label));
          notes.push(`${d.label}: the global DEM slope uses a ~${base == null ? '?' : base.toFixed(1)} km baseline, so the ${lo}-${hi} km slope is an estimate (${method}).`);
        }
        break;
      }
      case 'layer': {
        const layer = c.layers.find((l) => l.id === d.layerId);
        if (layer?.value != null && unitMatchesTI(layer.unit)) {
          value = layer.value;
          if (layer.provenance && layer.provenance !== 'observed') { provenance = layer.provenance; method = layer.method ?? method; }
        } else { value = mockThermalInertia(inp.lon, inp.lat); provenance = 'mock'; method = 'mock thermal inertia, seeded by lon/lat'; }
        break;
      }
      default: {
        // rover-scale criteria the global data cannot resolve: slopes are scaled from MOLA, the rest are labelled mocks
        if (BASELINE_KM[d.id]) ({ value, provenance, method } = slopeFrom(BASELINE_KM[d.id], d.label));
        else if (d.id === 'rock-abundance') { value = mockRockAbundance(inp.lon, inp.lat); provenance = 'mock'; method = 'mock rock abundance, seeded by lon/lat, 3 to 12 % around the Mars median of about 6 % (Nowicki & Christensen 2007)'; }
        else { value = Math.round(d.limit * (0.4 + 0.8 * siteHash(inp.lon, inp.lat, d.id)) * 100) / 100; provenance = 'mock'; method = 'mock value, seeded by lon/lat'; }
        notes.push(`${d.label}: ${d.unassessableReason ?? 'not resolved by the global data'}; ${provenance === 'mock' ? 'mock value' : 'estimate'} used (${method}).`);
        break;
      }
    }
    return {
      id: d.id, label: d.label, value, unit: d.unit, limit: d.limitText, pass: cmp(d.op, value, d.limit),
      source: { title: d.source.title, url: d.source.url }, provenance, method,
    };
  });
  const verdict: LandingCheck['verdict'] = criteria.some((x) => x.pass === false) ? 'fails-some' : 'meets-all';
  const estimated = criteria.some((x) => x.provenance !== 'observed');
  return { site, criteria, verdict, estimated, ellipse: { ...file.ellipse }, notes, criteriaCaveat: file.caveat };
}
