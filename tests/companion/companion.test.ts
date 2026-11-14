import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitAsk, emitClickPoint, onAsk, onClickPoint, TRAIL_MAX, useCompanion } from '@/state/companion';
import { arcPoint, parkAtEdge, placeBubble, springStep } from '@/components/Companion/motion';
import { firstLine, formatReadout, splitAnswer, timeAgo, tokenizeAnswer } from '@/components/Companion/text';
import { monoScout } from '@/components/Companion/scoutArt';

const st = () => useCompanion.getState();
beforeEach(() => st().reset());

describe('companion store', () => {
  it('say opens the bubble, sets current, adds to trail, clears busy', () => {
    st().setBusy(true, 'Checking landing criteria…');
    const u = st().say({ text: 'Slope 4 deg.' });
    expect(st().current).toEqual(u);
    expect(st().bubbleOpen).toBe(true);
    expect(st().busy).toBe(false);
    expect(st().doing).toBeNull();
    expect(st().trail[0].id).toBe(u.id);
    expect(u.sources).toEqual([]);
  });
  it('trail is newest first, capped at 30 and de-duplicated by id', () => {
    for (let i = 0; i < 45; i++) st().say({ text: `a${i}`, id: `id${i}` });
    expect(st().trail).toHaveLength(TRAIL_MAX);
    expect(st().trail[0].text).toBe('a44');
    st().pushTrail({ ...st().trail[5], text: 'again' });
    expect(st().trail).toHaveLength(TRAIL_MAX);
    expect(st().trail[0].text).toBe('again');
  });
  it('anchors, moods, busy, listening', () => {
    st().anchorToPoint({ lon: 77.4, lat: 18.4 });
    expect(st().anchor).toEqual({ kind: 'point', lon: 77.4, lat: 18.4 });
    st().anchorToCursor();
    expect(st().anchor).toEqual({ kind: 'cursor' });
    st().setMood('warning'); expect(st().mood).toBe('warning');
    st().setBusy(true, 'x'); expect(st().doing).toBe('x');
    st().setBusy(false, 'x'); expect(st().doing).toBeNull();
    st().setInterim('hello'); st().setListening(true); st().setListening(false);
    expect(st().interim).toBe('');
  });
  it('closeBubble returns Scout to the cursor; showFromTrail re-shows without duplicating', () => {
    const a = st().say({ text: 'one', id: 'a' }); st().say({ text: 'two', id: 'b' });
    st().anchorToPoint({ lon: 1, lat: 2 });
    st().closeBubble();
    expect(st().bubbleOpen).toBe(false);
    expect(st().anchor.kind).toBe('cursor');
    st().showFromTrail('a');
    expect(st().current).toEqual(a);
    expect(st().bubbleOpen).toBe(true);
    expect(st().trail).toHaveLength(2);
  });
});

describe('event bus', () => {
  it('delivers asks and click points, trims text, unsubscribes', () => {
    const ask = vi.fn(), pt = vi.fn();
    const offA = onAsk(ask), offP = onClickPoint(pt);
    emitAsk('  hello '); emitAsk('   ');
    emitClickPoint({ lon: 1, lat: 2 });
    expect(ask).toHaveBeenCalledTimes(1); expect(ask).toHaveBeenCalledWith('hello');
    expect(pt).toHaveBeenCalledWith({ lon: 1, lat: 2 });
    offA(); offP();
    emitAsk('x'); emitClickPoint({ lon: 0, lat: 0 });
    expect(ask).toHaveBeenCalledTimes(1); expect(pt).toHaveBeenCalledTimes(1);
  });
});

describe('motion', () => {
  it('critically damped spring converges without overshoot, at any frame rate', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 20]) {
      let p = 0, v = 0, max = 0;
      for (let i = 0; i < Math.ceil(2 / dt); i++) { ({ pos: p, vel: v } = springStep(p, v, 100, 11, dt)); max = Math.max(max, p); }
      expect(Math.abs(p - 100)).toBeLessThan(0.01);
      expect(Math.abs(v)).toBeLessThan(0.1);
      expect(max).toBeLessThanOrEqual(100.0001);
    }
  });
  it('spring is frame-rate independent', () => {
    const run = (dt: number) => { let p = 0, v = 0; for (let i = 0; i < 0.3 / dt; i++) ({ pos: p, vel: v } = springStep(p, v, 50, 12, dt)); return p; };
    expect(Math.abs(run(1 / 60) - run(1 / 120))).toBeLessThan(0.05);
  });
  it('arc starts at from, ends at to, bulges upward in between', () => {
    const a = { x: 100, y: 400 }, b = { x: 500, y: 400 };
    expect(arcPoint(a, b, 0)).toEqual(a);
    const end = arcPoint(a, b, 1); expect(end.x).toBeCloseTo(500); expect(end.y).toBeCloseTo(400);
    expect(arcPoint(a, b, 0.5).y).toBeLessThan(400);
    expect(arcPoint(b, a, 0.5).y).toBeLessThan(400);
  });
  it('parks at the nearest edge with an arrow toward the point', () => {
    const off = parkAtEdge({ x: 1600, y: 300 }, 1000, 800, 32);
    expect(off.x).toBe(968); expect(off.y).toBe(300); expect(Math.abs(off.angle)).toBeLessThan(0.01);
    const hidden = parkAtEdge({ x: 500, y: 60 }, 1000, 800, 32);
    expect(hidden.y).toBe(32);
    expect(hidden.angle).toBeCloseTo(Math.PI / 2, 5);
  });
  it('places the bubble on screen and clear of the point to avoid', () => {
    const r = placeBubble({ x: 200, y: 200 }, 40, 280, 200, 1440, 810, { x: 228, y: 228 });
    expect(r.left).toBeGreaterThanOrEqual(12); expect(r.top).toBeGreaterThanOrEqual(12);
    const covers = (l: number, t: number) => 228 > l - 20 && 228 < l + 280 + 20 && 228 > t - 20 && 228 < t + 200 + 20;
    expect(covers(r.left, r.top)).toBe(false);
    const e = placeBubble({ x: 1400, y: 780 }, 40, 280, 200, 1440, 810, { x: 1428, y: 808 });
    expect(e.left + 280).toBeLessThanOrEqual(1440 - 12); expect(e.top + 200).toBeLessThanOrEqual(810 - 12);
  });
});

describe('answer text', () => {
  it('marks numbers with units and underlines unverified ones', () => {
    const t = tokenizeAnswer('Slope is 4.2° and the rim is 2,540 m high, about 12 km away.', ['12 km']);
    expect(t.filter((x) => x.kind === 'num').map((x) => x.text)).toEqual(['4.2°', '2,540 m']);
    expect(t.filter((x) => x.kind === 'unverified').map((x) => x.text)).toEqual(['12 km']);
    expect(t.map((x) => x.text).join('')).toBe('Slope is 4.2° and the rim is 2,540 m high, about 12 km away.');
  });
  it('does not treat digits inside words or unit-like words as numbers', () => {
    expect(tokenizeAnswer('H2O and 5 meters', []).filter((x) => x.kind === 'num').map((x) => x.text)).toEqual(['5']);
    expect(tokenizeAnswer('no numbers', [])).toEqual([{ text: 'no numbers', kind: 'text' }]);
  });
  it('firstLine and timeAgo', () => {
    expect(firstLine('\n  Hello there\nsecond')).toBe('Hello there');
    expect(firstLine('x'.repeat(100), 10)).toHaveLength(10);
    expect(timeAgo(1000, 4000)).toBe('now');
    expect(timeAgo(0, 125_000)).toBe('2m ago');
  });
});

describe('bubble anatomy and readout', () => {
  it('splits headline and at most three body lines', () => {
    expect(splitAnswer('Too steep to land\na\nb\nc\nd')).toEqual({ headline: 'Too steep to land', body: ['a', 'b', 'c'] });
    expect(splitAnswer('')).toEqual({ headline: '', body: [] });
  });
  it('formats the pointer readout', () => {
    expect(formatReadout({ lat: 18.4402, lon: 77.4501, elevM: -2540.4 })).toEqual(['18.44N 77.45E  -2540 m']);
    expect(formatReadout({ lat: -4, lon: -10.005, elevM: null, slopeDeg: 3.14, unit: 'Isidis Planitia' }, true))
      .toEqual(['4.00S 10.01W  no elevation', 'slope 3.1°  Isidis Planitia']);
  });
});

describe('scout art', () => {
  const idle = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><g stroke="#10141B"><ellipse cx="80" cy="143" rx="45" ry="8" fill="#5CC8FF" opacity=".28" stroke="none"/><path d="M50 43" fill="none" stroke="#F2A66E" stroke-width="7"/><path d="M80 25" fill="#E0884A"/><circle cx="80" cy="73" r="27" fill="#5CC8FF"/><circle cx="80" cy="73" r="17" fill="#10141B" stroke="none"/><circle cx="80" cy="11" r="5" fill="#5CC8FF"/></g></svg>';
  it('goes monochrome with the accent only on the lens', () => {
    const m = monoScout(idle);
    expect(m).not.toMatch(/E0884A|F2A66E|ellipse|10141B/i);
    expect(m.match(/#5cc8ff/gi)).toHaveLength(1);
    expect(m).toContain('currentColor');
  });
  it('lens turns caution yellow in the warning state', () => {
    expect(monoScout(idle.replace('r="27" fill="#5CC8FF"', 'r="27" fill="#FFB020"'))).toContain('#f3d250');
  });
});
