/**
 * QA round 2 helpers: default 09:00 start, daylight left for reach, crew pair sight along a walk, the one ordered issue
 * list (card and map numbering), number formatting near zero, and the Perseverance photo choice. Synthetic fixtures only.
 */
import { describe, expect, it } from 'vitest';
import { daylightLeftMin, nextLtstUtcMs, SOL_MS } from '@/lib/ops/lighting';
import { formatHms, ltstHours, marsState, sunPosition } from '@/lib/ops/mars24';
import { pairSightAlongRoute } from '@/lib/ops/viewshed';
import { issueNumber, orderedIssues } from '@/components/Ops/routeOps';
import { daylightMargin, fmt, routeRows } from '@/lib/agent/explain';
import { selectImages, viewScore } from '@/lib/science/rover';
import type { GoNoGo } from '@/lib/opsContracts';
import type { RoverImage } from '@/lib/contracts';
import { handRoute, line, makeFeatureDem } from './fixtures';

const BASE = { lon: 77.45088572, lat: 18.44462715 };

describe('nextLtstUtcMs', () => {
  it.each([0, 6.5, 9, 12, 23.99])('lands on %s h LTST within a second, never before the start, within one sol', (h) => {
    for (const from of [Date.UTC(2026, 10, 15, 0, 0), Date.UTC(2027, 2, 1, 13, 37)]) {
      const t = nextLtstUtcMs(BASE.lon, h, from);
      expect(t).toBeGreaterThanOrEqual(from);
      expect(t - from).toBeLessThanOrEqual(SOL_MS);
      let d = ltstHours(marsState(t), BASE.lon) - h;
      if (d > 12) d -= 24; else if (d < -12) d += 24;
      expect(Math.abs(d) * 3600).toBeLessThan(1);
    }
  });
  it('09:00 at the base prints as 09:00:00 and the sun is up', () => {
    const t = nextLtstUtcMs(BASE.lon, 9, Date.UTC(2026, 10, 15, 6, 0));
    expect(formatHms(ltstHours(marsState(t), BASE.lon))).toBe('09:00:00');
    expect(sunPosition(t, BASE.lat, BASE.lon).elevationDeg).toBeGreaterThan(20);
  });
});

describe('daylightLeftMin', () => {
  it('is 0 at night, the cap at 09:00 for a 6 h window, and ends near sunset in the afternoon', () => {
    const nine = nextLtstUtcMs(BASE.lon, 9, Date.UTC(2026, 10, 15));
    const midnight = nextLtstUtcMs(BASE.lon, 0, nine);
    const four = nextLtstUtcMs(BASE.lon, 16, nine);
    expect(daylightLeftMin(BASE, midnight, 360)).toBe(0);
    expect(daylightLeftMin(BASE, nine, 360)).toBe(360);
    const left = daylightLeftMin(BASE, four, 360);
    expect(left).toBeGreaterThan(60);
    expect(left).toBeLessThan(200);
    expect(sunPosition(four + left * 60_000, BASE.lat, BASE.lon).elevationDeg).toBeGreaterThanOrEqual(0);
    expect(sunPosition(four + (left + 2) * 60_000, BASE.lat, BASE.lon).elevationDeg).toBeLessThan(0);
  });
});

describe('pairSightAlongRoute (synthetic test fixture, NOT NASA data)', () => {
  it('two suits 4 m apart on a flat plain see each other the whole walk', () => {
    const flat = makeFeatureDem(200, () => -2500);
    const r = handRoute([line([0, 0], [800, 0]), line([800, 0], [0, 0])]);
    const p = pairSightAlongRoute(flat, r, 4, 0.5);
    expect(p.checks).toBeGreaterThan(10);
    expect(p.hidden).toBe(0);
    expect(p.worst).toBeNull();
  });
  it('a 30 m wall between the suits hides them while they straddle it and reports that stretch as the worst', () => {
    const wall = makeFeatureDem(200, (x) => (Math.abs(x - 400) < 15 ? -2470 : -2500));
    const r = handRoute([line([0, 0], [800, 0], 10), line([800, 0], [0, 0], 10)]);
    const p = pairSightAlongRoute(wall, r, 60, 0.25);
    expect(p.hidden).toBeGreaterThan(0);
    expect(p.worst).not.toBeNull();
    expect(p.worst!.endMin).toBeGreaterThanOrEqual(p.worst!.startMin);
  });
});

describe('one ordered issue list for the card rows and the map label', () => {
  const g = (blockers: GoNoGo['blockers'], cautions: GoNoGo['cautions'] = []): GoNoGo => ({ items: [], overall: blockers.length ? 'no-go' : 'caution', blockers, cautions });
  it('blockers before cautions; the radio shadow (drawn on the map) first within each group', () => {
    expect(orderedIssues(g(['daylight', 'comms']))).toEqual(['comms', 'daylight']);
    expect(orderedIssues(g(['daylight'], ['comms']))).toEqual(['daylight', 'comms']);
    expect(orderedIssues(g([], ['eva-time', 'comms']))).toEqual(['comms', 'eva-time']);
  });
  it('the radio shadow map label carries the same number as its card row', () => {
    expect(issueNumber(orderedIssues(g(['daylight'], ['comms'])), 'comms')).toBe(2);
    expect(issueNumber(orderedIssues(g(['daylight', 'comms'])), 'comms')).toBe(1);
    expect(issueNumber(orderedIssues(g(['daylight'])), 'comms')).toBeNull();
  });
  it('routeRows numbers the failing rows in that order', () => {
    const r = handRoute([line([0, 0], [400, 0]), line([400, 0], [0, 0])]);
    const goNoGo: GoNoGo = {
      overall: 'no-go', blockers: ['daylight', 'comms'], cautions: [],
      items: [
        { id: 'comms', label: '', status: 'no-go', value: 900, limit: 500, unit: 'm', source: '', provenance: 'computed', rule: '' },
        { id: 'daylight', label: '', status: 'no-go', value: -3, limit: 0, unit: 'deg', source: '', provenance: 'computed', rule: '' },
      ],
    };
    const rows = routeRows(r, { goNoGo, comms: null, daylight: null, startUtcMs: 0, mastM: 10, verdict: { word: 'NO GO', tone: 'nogo', reason: '' }, order: orderedIssues(goNoGo) }, r.constraintsUsed);
    expect(rows.find((x) => /comms/.test(x.label))!.label).toBe('1. Longest comms shadow / limit');
    expect(rows.find((x) => /Daylight/.test(x.label))!.label).toBe('2. Daylight margin at return');
    expect(rows.find((x) => /Battery/.test(x.label))!.label).toBe('Battery at return / reserve');
  });
});

describe('numbers near zero', () => {
  it('fmt never prints -0', () => {
    expect(fmt(-0.3, 0)).toBe('0');
    expect(fmt(-0.04, 1)).toBe('0');
    expect(fmt(-0.06, 1)).toBe('-0.1');
  });
  it('daylightMargin says "under 1 min" either side of sunset', () => {
    const r = handRoute([line([0, 0], [200, 0]), line([200, 0], [0, 0])]);
    const nine = nextLtstUtcMs(BASE.lon, 9, Date.UTC(2026, 10, 15));
    const m = daylightMargin(r, nine);
    expect(m.min).toBeGreaterThan(1);
    // start so the EVA ends 20 s before, then 20 s after, sunset
    const end = nine + r.totals.evaMin * 60_000;
    for (const shift of [m.min! * 60_000 - 20_000, m.min! * 60_000 + 20_000]) {
      const t = daylightMargin(r, nine + shift).text;
      expect(t).toMatch(/^under 1 min( after sunset)?$/);
    }
    expect(end).toBeGreaterThan(nine);
  });
});

describe('view from the ground: Perseverance frame choice', () => {
  const im = (id: string, camera: string, sclk: number, el?: number, az?: number): RoverImage => ({
    id, sol: 1, earthDate: '2022-01-01', camera, cameraFull: camera, url: `https://mars.nasa.gov/${id}.jpg`, credit: 'NASA/JPL-Caltech', sclk, mastElDeg: el, mastAzDeg: az,
  });
  it('prefers a Navcam landscape, drops frames within 60 s of a kept one and steep looks down', () => {
    const imgs = [
      im('down', 'NAVCAM_RIGHT', 1000, -45, 10),     // the deck and the rover's shadow
      im('mcz', 'MCZ_LEFT', 2000, -3, 200),
      im('nav', 'NAVCAM_LEFT', 3000, -6, 90),
      im('pair', 'NAVCAM_RIGHT', 3001, -6, 90),      // stereo partner, same look
      im('haz', 'FRONT_HAZCAM_LEFT_A', 4000),
    ];
    const p = selectImages(imgs, 2);
    expect(p[0].id).toBe('nav');
    expect(p.map((x) => x.id)).not.toContain('pair');
    expect(p.map((x) => x.id)).not.toContain('down');
    expect(p.map((x) => x.id)).not.toContain('haz');
    expect(viewScore(imgs[0])).toBeGreaterThan(viewScore(imgs[4]));
  });
  it('shows one frame when the second is the same direction or only a Hazcam', () => {
    expect(selectImages([im('a', 'NAVCAM_LEFT', 0, -5, 30), im('b', 'NAVCAM_LEFT', 500, -8, 50)], 2)).toHaveLength(1);
    expect(selectImages([im('a', 'NAVCAM_LEFT', 0, -5, 30), im('h', 'FRONT_HAZCAM_LEFT_A', 900)], 2).map((x) => x.id)).toEqual(['a']);
  });
  it('reads the spacecraft clock from the image id when the record has none', () => {
    const a = { ...im('NLF_0538_0714708569_288ECM_N0262548NCAM13538_01_195J', 'NAVCAM_LEFT', 0, -3, 85) }; delete a.sclk;
    const b = { ...im('NRF_0538_0714708600_573ECM_N0262142NCAM13537_01_195J', 'NAVCAM_RIGHT', 0, -4, 200) }; delete b.sclk;
    expect(selectImages([a, b], 2)).toHaveLength(1); // 31 s apart: one look
  });
});
