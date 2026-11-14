import { beforeEach, describe, expect, it } from 'vitest';
import { SPEEDS, advance, clampT, formatMissionTime, usePlayback } from '@/state/playback';

describe('playback clock math', () => {
  it.each(SPEEDS)('advances dt * speed at %i x', (speed) => {
    const r = advance(100, 0.5, speed, 1e9);
    expect(r.t).toBeCloseTo(100 + 0.5 * speed, 9);
    expect(r.ended).toBe(false);
  });

  it('stops exactly at the end and reports ended', () => {
    expect(advance(990, 1, 60, 1000)).toEqual({ t: 1000, ended: true });
  });

  it('ignores negative dt and clamps seeks', () => {
    expect(advance(10, -3, 60, 100).t).toBe(10);
    expect(clampT(-5, 100)).toBe(0);
    expect(clampT(500, 100)).toBe(100);
    expect(clampT(NaN, 100)).toBe(0);
  });

  it('formats mission time', () => {
    expect(formatMissionTime(0)).toBe('T+00:00:00');
    expect(formatMissionTime(5025)).toBe('T+01:23:45');
    expect(formatMissionTime(-4)).toBe('T+00:00:00');
  });
});

describe('playback store', () => {
  beforeEach(() => usePlayback.getState().load({ scenarioId: 'x', kind: 'walk', durationS: 1000, speed: 1 }));

  it('load rewinds and does not autoplay by default', () => {
    const s = usePlayback.getState();
    expect(s.t).toBe(0);
    expect(s.playing).toBe(false);
    expect(s.scenarioId).toBe('x');
  });

  it('tick only moves while playing, at the chosen speed', () => {
    const s = usePlayback.getState();
    s.tick(1);
    expect(usePlayback.getState().t).toBe(0);
    s.setSpeed(600); s.play(); s.tick(0.5);
    expect(usePlayback.getState().t).toBe(300);
  });

  it('pauses at the end and play restarts from zero', () => {
    const s = usePlayback.getState();
    s.setSpeed(600); s.play(); s.tick(10);
    expect(usePlayback.getState().t).toBe(1000);
    expect(usePlayback.getState().playing).toBe(false);
    usePlayback.getState().play();
    expect(usePlayback.getState().t).toBe(0);
    expect(usePlayback.getState().playing).toBe(true);
  });

  it('seek clamps and toggle flips playing', () => {
    const s = usePlayback.getState();
    s.seek(5000);
    expect(usePlayback.getState().t).toBe(1000);
    s.seek(-1);
    expect(usePlayback.getState().t).toBe(0);
    s.toggle();
    expect(usePlayback.getState().playing).toBe(true);
    usePlayback.getState().toggle();
    expect(usePlayback.getState().playing).toBe(false);
  });
});
