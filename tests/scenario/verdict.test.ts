import { describe, expect, it } from 'vitest';
import { LANDING_VERDICT_RULE, landingVerdict, landingVerdictCalc, reachVerdict, terrainCoarserThanEllipse, walkVerdict } from '../../src/lib/scenario/verdict';

describe('landing verdict (GO >= 99 % and no data < 1 %, HOLD >= 95 %, else NO GO)', () => {
  it('applies the thresholds at their edges', () => {
    expect(landingVerdict({ okFraction: 0.99, nodataFraction: 0 }).verdict).toBe('GO');
    expect(landingVerdict({ okFraction: 0.9899, nodataFraction: 0 }).verdict).toBe('HOLD');
    expect(landingVerdict({ okFraction: 0.95, nodataFraction: 0 }).verdict).toBe('HOLD');
    expect(landingVerdict({ okFraction: 0.9499, nodataFraction: 0 }).verdict).toBe('NO GO');
    expect(landingVerdict({ okFraction: 0.995, nodataFraction: 0.01 }).verdict).toBe('HOLD'); // no data at 1 % blocks GO
    expect(landingVerdict({ okFraction: 0.995, nodataFraction: 0.0099 }).verdict).toBe('GO');
  });
  it('returns the rule, a tone and a reason with the numbers', () => {
    const v = landingVerdict({ okFraction: 0.972, nodataFraction: 0.002 }, null, 15);
    expect(v).toMatchObject({ verdict: 'HOLD', tone: 'caution', rule: LANDING_VERDICT_RULE, estimated: false, label: 'HOLD' });
    expect(v.reason).toContain('97.2 %');
    expect(v.reason).toContain('15°');
  });
  it('marks "(includes estimates)" when the terrain cell is wider than the ellipse', () => {
    const ell = { semiMinorKm: 3.3 };
    expect(terrainCoarserThanEllipse(20, ell)).toBe(false);
    expect(terrainCoarserThanEllipse(7400, ell)).toBe(true);
    const v = landingVerdict({ okFraction: 1, nodataFraction: 0, demResM: 7400 }, ell);
    expect(v.label).toBe('GO (includes estimates)');
    expect(v.estimated).toBe(true);
    expect(landingVerdict({ okFraction: 1, nodataFraction: 0, demResM: 20 }, ell).label).toBe('GO');
  });
  it('formula lines show the substituted numbers and the outcome', () => {
    const r = { okFraction: 0.992, nodataFraction: 0 };
    const lines = landingVerdictCalc(r);
    expect(lines[0]).toContain('99 %');
    expect(lines[1]).toBe('ok 99.2 % ≥ 99 %, no data 0.0 % < 1 % → GO');
    expect(landingVerdictCalc({ okFraction: 0.9, nodataFraction: 0 })[1]).toContain('→ NO GO');
  });
});

describe('walk and base camp verdicts', () => {
  it('walk takes the route board, else the timeline feasibility', () => {
    expect(walkVerdict({ word: 'HOLD', reason: 'Battery close to reserve.' }, { feasible: true, turnBack: null })).toEqual({ verdict: 'HOLD', tone: 'caution', reason: 'Battery close to reserve.' });
    expect(walkVerdict(null, { feasible: false, turnBack: { tS: 100 } }).verdict).toBe('NO GO');
    expect(walkVerdict(undefined, { feasible: true, turnBack: null }).verdict).toBe('GO');
  });
  it('reach is NO GO with nothing reachable, GO otherwise and says comms is per route', () => {
    expect(reachVerdict(0, 0).verdict).toBe('NO GO');
    const v = reachVerdict(12.34, 3100);
    expect(v.verdict).toBe('GO');
    expect(v.reason).toContain('12.3 km²');
    expect(v.reason).toContain('3.1 km');
    expect(v.reason).toMatch(/Comms/);
  });
});
