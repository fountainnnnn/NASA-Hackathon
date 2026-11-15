import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { events, hangM, vehicleAltM, stageOf, dust, pullBack, chaseRangeM, chaseCamera, shellAltM, phaseCaption, groundFraming, groundCamActive, elevAz, CHUTE_RANGE_M, CRANE_RANGE_M, SKYCRANE_HOVER_M, BRIDLE_STOWED_M, ROVER_DECK_M, TOUCHDOWN_HOLD_S, REVEAL_DELAY_S, GROUND_CAM_BELOW_M, GROUND_CAM_DIST_M, GROUND_CAM_EYE_M, GROUND_CAM_FLOOR_DEG, ARC_HIDE_BELOW_M, STAGE_TOP_M, craneBlend, craneFraming, groundCamEyeM, touchdownFraming } from '../../src/components/Planet/descent';
import { revealProgress, LANDING_REVEAL_S } from '../../src/components/Scenario/landing';
import { drawAltM } from '../../src/components/Planet/descent';
import { PULLBACK_S } from '../../src/lib/scenario/playback';
import { LANDING_CAM_SCALE, LANDING_DRAW_SCALE } from '../../src/lib/scenario/drawScale';
import type { EdlPhase } from '../../src/lib/globeContracts';

const src = { title: 't', url: 'u' };
const phases: EdlPhase[] = [
  { id: 'entry_interface', label: 'Entry', tStartS: 0, tEndS: 75, source: src },
  { id: 'parachute_deploy', label: 'Parachute deploy', tStartS: 240, tEndS: 260, altitudeKmStart: 11, source: src },
  { id: 'heat_shield_separation', label: 'Heat shield separation', tStartS: 260, tEndS: 260, source: src },
  { id: 'backshell_separation', label: 'Back shell', tStartS: 350, tEndS: 350, altitudeKmStart: 2.1, source: src },
  { id: 'touchdown', label: 'Touchdown', tStartS: 420, tEndS: 420, altitudeKmEnd: 0, source: src },
];
const ev = events(phases);

describe('descent profile', () => {
  it('hits the cited altitude triggers', () => {
    expect(vehicleAltM(240, ev)).toBeCloseTo(11000, 0);
    expect(vehicleAltM(350, ev)).toBeCloseTo(2100, 0);
    expect(vehicleAltM(0, ev)).toBe(125000);
  });
  it('descends monotonically until touchdown', () => {
    let prev = Infinity;
    for (let t = 0; t <= ev.touchdown; t += 5) { const a = vehicleAltM(t, ev); expect(a).toBeLessThanOrEqual(prev + 1e-6); prev = a; }
  });
  it('the rover reaches the ground exactly at touchdown', () => {
    expect(vehicleAltM(ev.touchdown, ev) - hangM(ev.touchdown, ev)).toBeCloseTo(0, 5);
    expect(hangM(ev.crane - 1, ev)).toBe(BRIDLE_STOWED_M);
    expect(vehicleAltM(ev.crane, ev)).toBe(SKYCRANE_HOVER_M);
    // NASA: the cords lower the rover 7.6 m below the stage, about 12 s before touchdown
    expect(hangM(ev.touchdown - 1, ev) - ROVER_DECK_M).toBeCloseTo(7.6, 6);
    expect(ev.touchdown - ev.crane).toBe(12);
    expect((vehicleAltM(ev.crane, ev) - vehicleAltM(ev.touchdown, ev)) / 12).toBeLessThan(1.2); // slow final descent, about 1 m/s
  });
  it('phases and events line up', () => {
    expect(stageOf(100, ev)).toBe('entry'); expect(stageOf(300, ev)).toBe('chute'); expect(stageOf(380, ev)).toBe('descent');
    expect(stageOf(410, ev)).toBe('crane'); expect(stageOf(430, ev)).toBe('landed');
  });
  it('shell falls and never goes below ground', () => { expect(shellAltM(500, ev)).toBe(0); expect(shellAltM(351, ev)).toBeLessThan(2100); });
  it('dust blooms near touchdown and fades after', () => {
    expect(dust(100, ev).alpha).toBe(0); expect(dust(ev.touchdown, ev).alpha).toBeGreaterThan(0.5); expect(dust(ev.touchdown + 30, ev).alpha).toBe(0);
  });
  it('camera closes in with altitude and pulls back after touchdown', () => {
    expect(chaseRangeM(125000)).toBe(14000); expect(chaseRangeM(20)).toBeCloseTo(75, 5);
    expect(pullBack(ev.touchdown - 1, ev)).toBe(0); expect(pullBack(ev.touchdown + TOUCHDOWN_HOLD_S + PULLBACK_S, ev)).toBe(1);
  });
  it('chase camera is close (true scale) under the parachute and for the sky crane', () => {
    expect(chaseCamera(ev.chute - 1, ev).rangeM).toBeGreaterThan(2000);
    expect(chaseCamera(ev.chute + 10, ev).rangeM).toBeCloseTo(CHUTE_RANGE_M, 5);
    expect(chaseCamera(ev.touchdown - 1, ev).rangeM).toBeCloseTo(CRANE_RANGE_M, 5);
    expect(chaseCamera(ev.touchdown - 1, ev).pitchDeg).toBeGreaterThan(chaseCamera(ev.chute - 1, ev).pitchDeg);
    let prev = Infinity;
    for (let t = ev.chute; t <= ev.touchdown; t += 2) { const r = chaseCamera(t, ev).rangeM; expect(r).toBeLessThanOrEqual(prev + 1e-6); prev = r; }
  });
});

describe('phase captions follow the cited NASA timeline', () => {
  const real = JSON.parse(readFileSync('public/data/global/edl_mars2020.json', 'utf8')) as { phases: EdlPhase[] };
  const evR = events(real.phases);
  const cap = (t: number) => phaseCaption(t, real.phases, vehicleAltM(t, evR)).label;
  it('radar acquires the ground from heat shield separation, before Terrain-Relative Navigation', () => {
    expect(cap(265)).toBe('Radar acquires the ground');
    expect(vehicleAltM(280, evR)).toBeGreaterThan(4200);
    expect(cap(280)).toBe('Radar acquires the ground');
  });
  it('Terrain-Relative Navigation only between 4.2 and 2.2 km altitude', () => {
    for (let t = 255; t <= 360; t += 0.5) {
      const alt = vehicleAltM(t, evR);
      if (cap(t) === 'Terrain-Relative Navigation') { expect(alt).toBeLessThanOrEqual(4200); expect(alt).toBeGreaterThanOrEqual(2200); }
      else if (t > 262 && t < 349) expect(alt > 4200 || alt < 2200).toBe(true);
    }
    expect(real.phases.filter((p) => /Terrain-Relative/.test(p.label)).every((p) => p.altitudeKmStart === 4.2 && p.altitudeKmEnd === 2.2)).toBe(true);
  });
  it('every phase keeps a NASA citation', () => {
    for (const p of real.phases) expect(p.source.url).toMatch(/^https:\/\/www\.jpl\.nasa\.gov\//);
  });
  it('the camera holds on the rover after touchdown before pulling back', () => {
    expect(TOUCHDOWN_HOLD_S).toBeGreaterThanOrEqual(30);
    expect(pullBack(evR.touchdown + TOUCHDOWN_HOLD_S, evR)).toBe(0);
    expect(pullBack(evR.touchdown + TOUCHDOWN_HOLD_S + PULLBACK_S, evR)).toBe(1);
  });
});

describe('sky crane caption by altitude (QA round 2, P2-13)', () => {
  const real = JSON.parse(readFileSync('public/data/global/edl_mars2020.json', 'utf8')) as { phases: EdlPhase[] };
  const evR = events(real.phases);
  const cap = (t: number) => phaseCaption(t, real.phases, t >= evR.touchdown ? 0 : vehicleAltM(t, evR)).label;
  it('reads "Sky crane" whenever the stage is 20 m or lower before touchdown', () => {
    for (let t = evR.backshellSep + 1; t < evR.touchdown; t += 0.5) {
      const alt = vehicleAltM(t, evR);
      expect(cap(t)).toBe(alt <= 20.5 ? 'Sky crane' : 'Powered descent');
    }
    expect(cap(evR.crane + 1)).toBe('Sky crane');
  });
  it('touchdown owns the caption at touchdown; the sky crane phase keeps its NASA citation', () => {
    expect(cap(evR.touchdown)).toBe('Touchdown');
    const sc = real.phases.find((p) => p.id === 'sky_crane') as EdlPhase & { trigger?: string };
    expect(sc.trigger).toBe('altitude');
    expect(sc.source.url).toMatch(/^https:\/\/www\.jpl\.nasa\.gov\//);
  });
});

describe('landing close-ups (QA round 2, P0-1)', () => {
  const STAGE_PX = 725; // stage height at 1440 x 810
  // eye 2 m above the ground, 40 m south of the touchdown point; points east/north/up from the eye
  const pt = (upM: number): [number, number, number] => [0, GROUND_CAM_DIST_M, upM - GROUND_CAM_EYE_M];
  it('frames the sky crane (stage, bridles, rover) at 250 px or more for the whole lowering', () => {
    for (let t = ev.crane; t <= ev.touchdown; t += 1) {
      const top = vehicleAltM(t, ev) + 1.6, bottom = vehicleAltM(t, ev) - hangM(t, ev);
      const f = groundFraming(pt(top), pt(bottom));
      const span = elevAz(...pt(top)).elev - elevAz(...pt(bottom)).elev;
      expect((span / f.vfovDeg) * STAGE_PX).toBeGreaterThanOrEqual(250);
      // everything framed is inside the frame
      expect(elevAz(...pt(top)).elev).toBeLessThanOrEqual(f.pitchDeg + f.vfovDeg / 2);
      expect(elevAz(...pt(bottom)).elev).toBeGreaterThanOrEqual(f.pitchDeg - f.vfovDeg / 2);
    }
  });
  it('keeps the near ground out of frame: bottom edge no lower than 1 degree below level unless the wheels need it', () => {
    const high = groundFraming(pt(300), pt(290));
    expect(high.pitchDeg - high.vfovDeg / 2).toBeGreaterThanOrEqual(GROUND_CAM_FLOOR_DEG - 1e-9);
    const landed = groundFraming(pt(2.2), pt(0), 28);
    const wheels = elevAz(...pt(0)).elev;
    expect(landed.pitchDeg - landed.vfovDeg / 2).toBeCloseTo(wheels - 1.5, 6);
    expect(landed.vfovDeg).toBe(28); // held wide: no zoom onto coarse imagery after touchdown
  });
  it('the ground camera takes over below 1.3 km, so the chase never flies lower than the 4 px texel limit', () => {
    expect(groundCamActive(ev.backshellSep - 1, ev)).toBe(false);
    for (let t = ev.backshellSep; t <= ev.touchdown; t += 1) expect(groundCamActive(t, ev)).toBe(vehicleAltM(t, ev) <= GROUND_CAM_BELOW_M);
    // 5 m CTX texel at the take-over height is at most 4 px on a 1048 px wide, 60 degree lens
    expect((5 / GROUND_CAM_BELOW_M) / ((60 * Math.PI) / 180 / 1048)).toBeLessThanOrEqual(4);
  });
  it('touchdown scatter appears only once the camera has pulled back, and the approach arc ends 2 km up', () => {
    expect(revealProgress(ev.touchdown + TOUCHDOWN_HOLD_S, ev.touchdown + REVEAL_DELAY_S, LANDING_REVEAL_S - REVEAL_DELAY_S)).toBe(0);
    expect(pullBack(ev.touchdown + REVEAL_DELAY_S, ev)).toBeGreaterThan(0.8);
    expect(revealProgress(ev.touchdown + LANDING_REVEAL_S, ev.touchdown + REVEAL_DELAY_S, LANDING_REVEAL_S - REVEAL_DELAY_S)).toBe(1);
    expect(ARC_HIDE_BELOW_M).toBe(2000);
  });
});

describe('sky crane over ground and the touchdown hold (QA round 3, P0-2 and P0-3)', () => {
  const STAGE_PX = 725;
  it('sky crane: horizon near 35 % of the height, vehicle at 250 px or more and inside the frame, eye near the stage top', () => {
    for (let t = ev.crane; t < ev.touchdown; t += 1) {
      const alt = vehicleAltM(t, ev), eye = groundCamEyeM(alt, hangM(t, ev));
      expect(craneBlend(alt)).toBe(1);
      expect(eye).toBeLessThan(alt + STAGE_TOP_M);
      expect(eye).toBeGreaterThan(alt);
      const p = (upM: number): [number, number, number] => [0, GROUND_CAM_DIST_M, upM - eye];
      const top = p(alt + STAGE_TOP_M), bottom = p(alt - hangM(t, ev));
      const f = craneFraming(top, bottom, 1);
      const hi = elevAz(...top).elev, lo = elevAz(...bottom).elev;
      expect(((hi - lo) / f.vfovDeg) * STAGE_PX).toBeGreaterThanOrEqual(250);
      expect(hi).toBeLessThanOrEqual(f.pitchDeg + f.vfovDeg / 2);
      expect(lo).toBeGreaterThanOrEqual(f.pitchDeg - f.vfovDeg / 2);
      const horizonFromTop = (f.pitchDeg + f.vfovDeg / 2) / f.vfovDeg;
      expect(horizonFromTop).toBeGreaterThan(0.3);
      expect(horizonFromTop).toBeLessThan(0.4);
    }
  });
  it('the eye stays at 2 m while the vehicle is above 120 m, and every blend keeps the vehicle in frame', () => {
    expect(groundCamEyeM(500, 2.6)).toBe(GROUND_CAM_EYE_M);
    for (let alt = 20; alt <= 140; alt += 5) {
      const eye = groundCamEyeM(alt, 2.6), d = 40 + 0.5 * Math.max(0, alt - 20);
      const p = (upM: number): [number, number, number] => [0, d, upM - eye];
      const f = craneFraming(p(alt + STAGE_TOP_M), p(alt - 2.6), craneBlend(alt));
      expect(elevAz(...p(alt + STAGE_TOP_M)).elev).toBeLessThanOrEqual(f.pitchDeg + f.vfovDeg / 2 + 1e-9);
      expect(elevAz(...p(alt - 2.6)).elev).toBeGreaterThanOrEqual(f.pitchDeg - f.vfovDeg / 2 - 1e-9);
    }
  });
  it('touchdown hold: the rover sits at about 60 % of the height with the horizon above it', () => {
    const p = (upM: number): [number, number, number] => [0, GROUND_CAM_DIST_M, upM - GROUND_CAM_EYE_M];
    const f = touchdownFraming(p(2.2), p(0));
    expect(f.vfovDeg).toBe(28);
    const at = (elev: number) => (f.pitchDeg + f.vfovDeg / 2 - elev) / f.vfovDeg;
    expect(at((elevAz(...p(2.2)).elev + elevAz(...p(0)).elev) / 2)).toBeCloseTo(0.6, 6);
    expect(at(elevAz(...p(0)).elev)).toBeLessThan(0.8); // wheels clear of the attribution strip
    expect(at(0)).toBeLessThan(0.6); // horizon above the rover, ground below it
  });
});

describe('vehicle drawn 4x true size (objects bigger for visibility)', () => {
  const K = LANDING_DRAW_SCALE, CK = LANDING_CAM_SCALE, STAGE_PX = 725;
  it('below the hover height the scene is an exact K-times replica, so the rover still touches down when the cords are out', () => {
    expect(drawAltM(vehicleAltM(ev.touchdown, ev), K) - K * hangM(ev.touchdown, ev)).toBeCloseTo(0, 6);
    expect(drawAltM(10, K)).toBeCloseTo(40, 9);
    expect(drawAltM(2100, K) - 2100).toBeCloseTo((K - 1) * SKYCRANE_HOVER_M, 9);
    expect(drawAltM(500, 1)).toBe(500);
    // monotone: the drawn rover never climbs while the stage descends and the cords pay out
    let prev = Infinity;
    for (let t = ev.backshellSep; t <= ev.touchdown; t += 0.25) { const w = drawAltM(vehicleAltM(t, ev), K) - K * hangM(t, ev); expect(w).toBeLessThanOrEqual(prev + 1e-6); prev = w; }
  });
  it('sky crane at 4x from a camera 2x farther out: in frame, horizon near 35 %, vehicle at 250 px or more', () => {
    for (let t = ev.crane; t < ev.touchdown; t += 1) {
      const alt = vehicleAltM(t, ev), eye = groundCamEyeM(alt, hangM(t, ev), K), dist = CK * GROUND_CAM_DIST_M;
      const p = (upM: number): [number, number, number] => [0, dist, upM - eye];
      const top = p(drawAltM(alt, K) + K * STAGE_TOP_M), bottom = p(drawAltM(alt, K) - K * hangM(t, ev));
      const f = craneFraming(top, bottom, 1);
      const hi = elevAz(...top).elev, lo = elevAz(...bottom).elev;
      expect(((hi - lo) / f.vfovDeg) * STAGE_PX).toBeGreaterThanOrEqual(250);
      expect(hi).toBeLessThanOrEqual(f.pitchDeg + f.vfovDeg / 2);
      expect(lo).toBeGreaterThanOrEqual(f.pitchDeg - f.vfovDeg / 2);
    }
  });
  it('touchdown hold: the 4x rover reads 2x larger than at true scale and stays inside the frame', () => {
    const at = (rH: number, d: number) => { const p = (u: number): [number, number, number] => [0, d, u - GROUND_CAM_EYE_M]; const f = touchdownFraming(p(rH), p(0)); return { f, span: elevAz(...p(rH)).elev - elevAz(...p(0)).elev, top: elevAz(...p(rH)).elev }; };
    const big = at(2.2 * K, GROUND_CAM_DIST_M * CK), base = at(2.2, GROUND_CAM_DIST_M);
    expect(big.span / big.f.vfovDeg).toBeGreaterThan(1.8 * (base.span / base.f.vfovDeg));
    expect(big.top).toBeLessThan(big.f.pitchDeg + big.f.vfovDeg / 2);
  });
});
