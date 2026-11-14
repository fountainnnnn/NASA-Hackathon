import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emitAsk, emitClickPoint, onAsk, onClickPoint, TRAIL_MAX, useCompanion } from '@/state/companion';
import { arcPoint, parkAtEdge, placeBubble, springStep } from '@/components/Companion/motion';
import { firstLine, formatReadout, richTokens, splitAnswer, timeAgo, tokenizeAnswer } from '@/components/Companion/text';

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
    expect(ask).toHaveBeenCalledTimes(1); expect(ask).toHaveBeenCalledWith('hello', { origin: 'panel' });
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
  it('panel prose: units must be whole words; ordinals and years stay text (QA 3.5)', () => {
    const nums = (t: string) => richTokens(t).filter((x) => x.num).map((x) => x.text);
    expect(nums('10,000 simulated touchdowns')).toEqual(['10,000']);
    expect(nums('Median slope 2.1°, 95th percentile 6.4°.')).toEqual(['2.1°', '6.4°']);
    expect(nums('the 90th percentile')).toEqual([]);
    expect(nums('Curiosity landing-site constraints (JPL, 2006), not the Mars 2020 requirements')).toEqual([]);
    expect(nums('1 h 16 min, 84.2 % left, 7.76 km, -2,493 m')).toEqual(['1 h', '16 min', '84.2 %', '7.76 km', '-2,493 m']);
    expect(nums('2,540 m high, 12 m/s wind')).toEqual(['2,540 m', '12 m/s']);
    expect(nums('Turn back at T+03:05, limited by daylight')).toEqual(['03', '05']); // no trailing comma
    expect(richTokens('a 3 b').map((x) => x.text).join('')).toBe('a 3 b');
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
      .toEqual(['4.00S 10.01W', 'slope 3.1°  Isidis Planitia']);
  });
});

/* ------------------------------------------------------------------ MarsAgent thread */
import { fmtElapsed, lineTime, narrator, stepTime, useThread } from '@/state/thread';
import { revealed } from '@/components/Companion/reveal';

describe('MarsAgent thread', () => {
  beforeEach(() => useThread.getState().reset());
  it('a turn streams lines, records real elapsed times and finishes with an answer', async () => {
    const id = useThread.getState().begin({ text: 'Plan', origin: 'drag', at: { lon: 77.4, lat: 18.4 } });
    const n = narrator(id);
    n.say('Reading the ground').done('Read the ground: -2,493 m');
    const r = await n.run('Planning with A*', () => 42, (x) => `Planned: ${x}`);
    expect(r).toBe(42);
    n.step({ kind: 'calculation', title: 'Battery', code: ['used = 1'] });
    n.finish({ answer: { text: 'GO.' }, report: true });
    const t = useThread.getState().turns[0];
    expect(t.narration.map((l) => l.text)).toEqual(['Read the ground: -2,493 m', 'Planned: 42']);
    expect(t.narration.every((l) => l.status === 'done' && typeof l.tMs === 'number')).toBe(true);
    expect(t.status).toBe('done'); expect(t.report).toBe(true); expect(t.steps[0].title).toBe('Battery');
    expect(useThread.getState().cardTurnId).toBe(id);
  });
  it('panel turns can leave the map card alone; a failed line is kept as an error', () => {
    const a = useThread.getState().begin({ text: 'x', origin: 'map', at: { lon: 0, lat: 0 } });
    useThread.getState().begin({ text: 'y', origin: 'panel' }, { showCard: false });
    expect(useThread.getState().cardTurnId).toBe(a);
    const n = narrator(useThread.getState().turns[1].id);
    n.say('Reaching the model').fail('The model is not configured');
    expect(useThread.getState().turns[1].narration[0]).toMatchObject({ status: 'error', text: 'The model is not configured' });
  });
  it('reveal: finished lines show one by one in their true state; the answer only when complete', () => {
    const id = useThread.getState().begin({ text: 'x', origin: 'tool' });
    const n = narrator(id);
    n.say('one').done(); n.note('two'); n.finish({ answer: { text: 'ok' } });
    const t = useThread.getState().turns[0];
    expect(revealed(t, 0)).toMatchObject({ complete: false, current: null });
    expect(revealed(t, 1).lines.map((l) => l.state)).toEqual(['done']); // finished work never shows as running
    expect(revealed(t, 1).complete).toBe(false);
    const all = revealed(t, 2);
    expect(all.lines.map((l) => l.state)).toEqual(['done', 'done']);
    expect(all.complete).toBe(true);
  });
  it('reveal: a running line is on screen at once, with the lines before it, whatever the pace', () => {
    const id = useThread.getState().begin({ text: 'x', origin: 'tool' });
    const n = narrator(id);
    n.note('Read the ground'); n.note('Read the limits');
    const slow = n.say('Planning a round trip with A*');
    let t = useThread.getState().turns[0];
    const r = revealed(t, 0);
    expect(r.lines.map((l) => [l.text, l.state])).toEqual([['Read the ground', 'done'], ['Read the limits', 'done'], ['Planning a round trip with A*', 'now']]);
    slow.done('Planned a round trip with A*: 3.88 km out, 3.88 km back');
    t = useThread.getState().turns[0];
    expect(t.narration[2]).toMatchObject({ status: 'done', text: 'Planned a round trip with A*: 3.88 km out, 3.88 km back' });
  });
  it('each line carries its OWN duration, not the time since the turn started', async () => {
    const id = useThread.getState().begin({ text: 'x', origin: 'tool' });
    const n = narrator(id);
    await new Promise((r) => setTimeout(r, 60)); // time passes before the line's work starts
    await n.run('Waiting 30 ms', () => new Promise((r) => setTimeout(r, 30)), () => 'Waited 30 ms');
    n.note('Read something already known');
    const [a, b] = useThread.getState().turns[0].narration;
    expect(a.tMs!).toBeGreaterThanOrEqual(25);
    expect(a.tMs!).toBeLessThan(55); // not the 90+ ms since the turn began
    expect(b.tMs).toBeUndefined();
    expect(lineTime(b.tMs)).toBe('');
  });
  it('elapsed labels: ms under 100 ms, seconds above', () => {
    expect(fmtElapsed(4.2)).toBe('4 ms');
    expect(fmtElapsed(1240)).toBe('1.24 s');
    expect(fmtElapsed(23_400)).toBe('23 s');
    expect(fmtElapsed(undefined)).toBe('');
    expect(lineTime(4.2)).toBe(''); // under 5 ms a line shows no time
    expect(lineTime(12)).toBe('12 ms');
    expect(stepTime(0.3)).toBe('under 1 ms');
    expect(stepTime(1240)).toBe('1.24 s');
  });
});
