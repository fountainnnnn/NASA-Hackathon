import { describe, expect, it } from 'vitest';
import { buildCuffCard, fmtT } from '@/lib/ops/cuffCard';
import { CUFF_MAX_ROWS } from '@/lib/ops/assumptions';
import { sunriseSunset } from '@/lib/ops/mars24';
import { buildTimeline } from '@/lib/ops/timeline';
import { commsAlongRoute } from '@/lib/ops/viewshed';
import { handRoute, LAT_C, LON_C, line, makeFeatureDem, offset, planSynthetic } from './fixtures';

// synthetic test fixture — every number on the card must come from the route / timeline / constraints
const route = planSynthetic({ evaMaxMin: 1e6 });
const tl = buildTimeline(route);
const card = buildCuffCard({ route });
const MIN = 60_000;

describe('cuff card contents match the route numbers', () => {
  it('first/last rows: START at T+00:00, 0.00 km, 100%; END at the route totals', () => {
    const f = card.rows[0], l = card.rows[card.rows.length - 1];
    expect(f).toMatchObject({ n: 1, kind: 'start', label: 'START', cumDistM: 0, elapsedMin: 0, batteryPct: 100 });
    expect(l.kind).toBe('end');
    expect(l.cumDistM).toBeCloseTo(route.totals.lengthM, 6);
    expect(l.elapsedMin).toBeCloseTo(route.totals.evaMin, 6);
    expect(l.batteryPct).toBeCloseTo(100 - route.totals.batteryUsedPct, 6);
    expect(l.headingToNextDeg).toBeNull();
    expect(card.text).toContain(`${(route.totals.lengthM / 1000).toFixed(2)}km`);
    expect(card.text).toContain(`EVA ${fmtT(route.totals.evaMin)}`);
  });
  it('coordinates are route vertices in short form (4 decimals, N/S E/W)', () => {
    const p0 = route.legs[0].path[0];
    expect(card.rows[0].latStr).toBe(`${p0.lat.toFixed(4)}N`);
    expect(card.rows[0].lonStr).toBe(`${p0.lon.toFixed(4)}E`);
    expect(card.text).toContain(`${card.rows[0].latStr} ${card.rows[0].lonStr}`);
    for (const r of card.rows) {
      expect(route.legs.some((lg) => lg.path.some((v) => v.lat === r.lat && v.lon === r.lon))).toBe(true);
    }
  });
  it('rows are in order, cumulative values never decrease, max ~12 rows, one TARGET with its dwell-start time', () => {
    expect(card.rows.length).toBeLessThanOrEqual(CUFF_MAX_ROWS);
    for (let i = 1; i < card.rows.length; i++) {
      expect(card.rows[i].n).toBe(i + 1);
      expect(card.rows[i].cumDistM).toBeGreaterThanOrEqual(card.rows[i - 1].cumDistM);
      expect(card.rows[i].elapsedMin).toBeGreaterThanOrEqual(card.rows[i - 1].elapsedMin);
      expect(card.rows[i].batteryPct).toBeLessThanOrEqual(card.rows[i - 1].batteryPct + 1e-9);
    }
    const target = card.rows.filter((r) => r.kind === 'target');
    expect(target).toHaveLength(1);
    expect(target[0].cumDistM).toBeCloseTo(route.legs[0].lengthM, 6);
    expect(target[0].elapsedMin).toBeCloseTo(route.legs[0].timeMin, 6);
  });
  it('heading to the next row is the compass bearing between the two rows', () => {
    const a = card.rows[0], b = card.rows[1];
    const east = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180) * (b.lon - a.lon), north = b.lat - a.lat;
    expect(card.rows[0].headingToNextDeg).toBe(Math.round(((Math.atan2(east, north) * 180) / Math.PI + 360) % 360) % 360);
  });
  it('turn-back time = min(EVA limit, battery limit) − return walk time, floored', () => {
    const k = route.constraintsUsed;
    const batLimit = (100 - k.batteryReservePct) / tl.pctPerMin;
    const ret = route.legs[1].timeMin;
    expect(card.turnBack!.returnWalkMin).toBeCloseTo(ret, 6);
    expect(card.turnBack!.tMin).toBeCloseTo(Math.min(k.evaMaxMin, batLimit) - ret, 6);
    expect(card.turnBack!.limitedBy).toBe(k.evaMaxMin <= batLimit ? 'eva-time' : 'battery');
    expect(card.text).toContain(`NO LATER THAN ${fmtT(card.turnBack!.tMin, true).toUpperCase()} TURN BACK`);
    expect(card.turnBack!.label).toBe(`No later than ${fmtT(card.turnBack!.tMin, true)} turn back`);
  });
  it('battery-limited turn-back when the EVA limit is generous and the battery is small', () => {
    const r = planSynthetic({ evaMaxMin: 1e6, batteryWh: 800 });
    const c = buildCuffCard({ route: r });
    const pct = ((r.constraintsUsed.suitPowerW / 60) / 800) * 100;
    expect(c.turnBack!.limitedBy).toBe('battery');
    expect(c.turnBack!.tMin).toBeCloseTo((100 - 20) / pct - r.legs[1].timeMin, 6);
  });
  it('abort rules quote the constraints (slope, reserve, EVA limit) and nothing else numeric', () => {
    const r = planSynthetic({ maxSlopeDeg: 12, batteryReservePct: 25, evaMaxMin: 300 });
    const c = buildCuffCard({ route: r });
    const t = c.abortRules.join('\n');
    expect(t).toContain('12 deg');
    expect(t).toContain('25%');
    expect(t).toContain('T+05:00');
    expect(c.abortRules.some((x) => x.includes(fmtT(c.turnBack!.tMin, true)))).toBe(true);
    expect(t).not.toMatch(/Sun below/); // no start time → no sun rule
  });
});

describe('formats', () => {
  it('text: every line fits a 62-column wrist card; markdown has a table row per waypoint; svg is 600×900, dark, monospace', () => {
    for (const l of card.text.split('\n')) expect(l.length).toBeLessThanOrEqual(62);
    expect(card.markdown.split('\n').filter((l) => /^\| \d+ \|/.test(l))).toHaveLength(card.rows.length);
    expect(card.svg).toMatch(/^<svg [^>]*width="600" height="900"/);
    expect(card.svg).toContain('#0b0f14');
    expect(card.svg).toContain('monospace');
    expect(card.svg).toContain('START');
    expect((card.svg.match(/<text /g) ?? []).length).toBe((card.svg.match(/<\/text>/g) ?? []).length);
    expect((card.svg.match(/<text /g) ?? []).length).toBeLessThanOrEqual(Math.floor(840 / 19));
    expect(card.svg).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
  it('fmtT rounds to the minute and floors for turn-back', () => {
    expect(fmtT(59.6)).toBe('T+01:00');
    expect(fmtT(59.6, true)).toBe('T+00:59');
    expect(fmtT(125)).toBe('T+02:05');
  });
});

describe('turns, stops and the row cap', () => {
  it('an L-shaped path gets a TURN row at the corner (heading change 90°); straight legs get none', () => {
    const l = handRoute([[...line([0, 0], [600, 0]), ...line([600, 20], [600, 600])]]);
    const c = buildCuffCard({ route: l });
    expect(c.rows.map((r) => r.kind)).toEqual(['start', 'turn', 'target']);
    expect(c.rows[1].cumDistM).toBeGreaterThan(550);
    expect(c.rows[1].cumDistM).toBeLessThan(680);
    expect(c.rows[0].headingToNextDeg!).toBeGreaterThan(40); // start→corner is NE-ish chord, then due north
    const straight = buildCuffCard({ route: handRoute([line([0, 0], [800, 0])]) });
    expect(straight.rows.map((r) => r.kind)).toEqual(['start', 'target']);
  });
  it('stops are always kept and numbered; zig-zag with many turns is capped to ~12 rows keeping the sharpest', () => {
    const zig = Array.from({ length: 40 }, (_, i) => offset(i * 120, (i % 2) * 150));
    const out = handRoute([zig, [...zig].reverse()]);
    const c = buildCuffCard({ route: out });
    expect(c.rows.length).toBe(CUFF_MAX_ROWS);
    expect(c.rows[0].kind).toBe('start');
    expect(c.rows.filter((r) => r.kind === 'target')).toHaveLength(1);
    expect(c.rows[c.rows.length - 1].kind).toBe('end');
    const c3 = buildCuffCard({ route: out, maxRows: 5 });
    expect(c3.rows.length).toBe(5);
    // multi-stop: outbound legs [A→S1], [S1→T], return [T→A]
    const A = line([0, 0], [300, 0]), S = line([300, 0], [300, 300]), T = line([300, 300], [0, 300]);
    const ms = buildCuffCard({ route: handRoute([A, S, T, line([0, 300], [0, 0])]) });
    const kinds = ms.rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'stop')).toHaveLength(2); // ends of legs 1 and 2; leg 3 ends at the target
    expect(kinds.filter((k) => k === 'target')).toHaveLength(1);
    expect(ms.rows.filter((r) => r.kind === 'stop').map((r) => r.label)).toEqual(['STOP1', 'STOP2']);
  });
});

describe('comms and daylight on the card', () => {
  const bump = makeFeatureDem(300, (x, y) => -2500 + 25 * Math.exp(-(((x - 400) ** 2 + y * y) / (2 * 40 * 40))));
  const arc = Array.from({ length: 60 }, (_, i) => {
    const az = ((-40 + (80 * i) / 59) * Math.PI) / 180;
    return offset(800 * Math.cos(az), 800 * Math.sin(az));
  });
  const r = handRoute([arc, [...arc].reverse()]);
  const comms = commsAlongRoute(bump, r, { lon: LON_C, lat: LAT_C });
  const c = buildCuffCard({ route: r, comms, maxRows: 12 });

  it('shadow stretches become warnings with times and lengths; rows flag "shadow ahead"', () => {
    expect(comms.shadows.length).toBe(2); // out and back
    const w = c.warnings.filter((x) => x.startsWith('LOS LOST'));
    expect(w).toHaveLength(2);
    const sh = comms.shadows[0];
    expect(w[0]).toContain(`${fmtT(sh.startMin)}-${fmtT(sh.endMin)}`);
    expect(w[0]).toContain(`${Math.round(sh.lengthM)}-${Math.round(sh.maxLengthM)} m`);
    expect(c.rows.some((x) => x.shadowAhead)).toBe(true);
    expect(c.text).toContain('LOS LOST');
    expect(c.text).toMatch(/ LOS\n|LOS$/m);
  });
  it('no comms supplied → explicit "not evaluated" warning (never silently clear)', () => {
    expect(card.warnings.some((x) => x.startsWith('COMMS NOT EVALUATED'))).toBe(true);
  });

  it('with a start time: sun rows, sun abort rule, and the turn-back is capped by sunset when that comes first', () => {
    const sun = sunriseSunset(LAT_C, LON_C, Date.UTC(2026, 10, 14, 12));
    const start = sun.noonMs - (tl.totalMin / 2) * MIN;
    const k = { ...route.constraintsUsed, evaMaxMin: 200 };
    const day = buildCuffCard({ route, startUtc: start, constraints: k });
    expect(day.startUtc).toBe(new Date(start).toISOString());
    expect(day.rows.every((x) => x.sunElevationDeg !== null && x.sunElevationDeg > 0)).toBe(true);
    expect(day.abortRules.some((x) => x.startsWith('Sun below 0 deg'))).toBe(true);
    expect(day.turnBack!.limitedBy).toBe('eva-time');
    // start so late that sunset arrives before the EVA limit: daylight becomes the binding limit
    const lateStart = sun.sunsetMs! - 150 * MIN;
    const late = buildCuffCard({ route, startUtc: lateStart, constraints: k });
    expect(late.turnBack!.limitedBy).toBe('daylight');
    expect(late.turnBack!.tMin).toBeLessThan(day.turnBack!.tMin);
    // leaving at the daylight turn-back time gets the crew home with the sun at/above the minimum (end of walk-back ≤ sunset)
    const endMs = lateStart + (late.turnBack!.tMin + route.legs[1].timeMin) * MIN;
    expect(endMs).toBeLessThanOrEqual(sun.sunsetMs! + 2 * MIN);
    expect(endMs).toBeGreaterThan(sun.sunsetMs! - 8 * MIN);
  });
});
