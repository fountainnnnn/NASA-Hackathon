import { describe, expect, it } from 'vitest';
import {
  CHASE_BACK_M, CHASE_FOV_DEG, chaseFovDeg, CHASE_MIN_CLEAR_M, CHASE_UP_M, HIP_Y, chasePose, legAngles, legReach, pelvisDrop, screenHeightPx, visibleScale,
} from '../../src/components/Scenario/chase';
import { CREW_DRAW_SCALE } from '../../src/lib/scenario/drawScale';

const flat = () => 0;
const STAGE_PX = 724; // 810 px window minus the 40 px top bar and the 46 px timeline
const ASTRONAUT_M = 1.99;

describe('chase camera', () => {
  it('sits 40 to 60 m from the pair and shows each 3x astronaut at least 140 px tall at 1440 x 810', () => {
    const p = chasePose({ x: 0, y: 0, z: 0 }, 0, flat);
    const d = Math.hypot(p.cam.x, p.cam.y - 1, p.cam.z);
    expect(d).toBeGreaterThanOrEqual(40); expect(d).toBeLessThanOrEqual(60);
    expect(Math.hypot(p.cam.x, p.cam.z)).toBeCloseTo(CHASE_BACK_M, 6);
    expect(p.cam.y).toBeCloseTo(CHASE_UP_M, 6);
    // the nearer of the pair is closer still, so the farther one is the binding case (4 m pair spacing)
    expect(screenHeightPx(ASTRONAUT_M * CREW_DRAW_SCALE, d + 4 * CREW_DRAW_SCALE, CHASE_FOV_DEG, STAGE_PX)).toBeGreaterThanOrEqual(140);
    // and the whole figure stays well inside the stage (no clipping): under 40 % of its height
    expect(screenHeightPx(ASTRONAUT_M * CREW_DRAW_SCALE, d - 4 * CREW_DRAW_SCALE, CHASE_FOV_DEG, STAGE_PX)).toBeLessThan(0.4 * STAGE_PX);
  });
  it('stays behind the walkers: heading north puts the camera to the south', () => {
    const p = chasePose({ x: 0, y: 0, z: 0 }, 0, flat);
    expect(p.cam.z).toBeGreaterThan(20); // +z is south
    expect(p.look.z).toBeLessThan(0);    // looks ahead (north)
    expect(Math.atan2(p.cam.y - p.look.y, Math.hypot(p.cam.x - p.look.x, p.cam.z - p.look.z)) * 180 / Math.PI).toBeLessThan(6); // nearly level: horizon in frame
    const e = chasePose({ x: 0, y: 0, z: 0 }, Math.PI / 2, flat); // heading east
    expect(e.cam.x).toBeLessThan(-20);
  });
  it('never goes below the ground behind the pair', () => {
    const hill = (x: number, z: number) => (z > 10 ? 40 : 0) + x * 0;
    const p = chasePose({ x: 0, y: 0, z: 0 }, 0, hill, 1.5);
    expect(p.cam.y).toBeGreaterThanOrEqual(40 + CHASE_MIN_CLEAR_M * 1.5 - 1e-9);
  });
  it('crew are drawn 3x under the chase camera, true size in the helmet, and larger still from far orbit', () => {
    expect(visibleScale(48, true)).toBe(CREW_DRAW_SCALE);
    expect(visibleScale(48, false)).toBe(CREW_DRAW_SCALE);
    expect(visibleScale(7000, false)).toBe(100);
    expect(visibleScale(7000, true)).toBe(CREW_DRAW_SCALE);
    expect(visibleScale(7000, true, true)).toBe(1);
    expect(visibleScale(48, false, true)).toBe(1);
  });
});

describe('gait', () => {
  it('standing still is a straight leg at hip height', () => {
    const a = legAngles(0.3, 0);
    expect(legReach(a)).toBeCloseTo(HIP_Y, 9);
    expect(pelvisDrop(a, a)).toBeCloseTo(0, 9);
  });
  it('the lower boot is always exactly on the ground and the pelvis never rises', () => {
    for (let ph = 0; ph < 2 * Math.PI; ph += 0.1) {
      const l = legAngles(ph, 1), r = legAngles(ph + Math.PI, 1);
      const drop = pelvisDrop(l, r);
      expect(drop).toBeLessThanOrEqual(1e-12);
      expect(Math.min(HIP_Y + drop - legReach(l), HIP_Y + drop - legReach(r))).toBeCloseTo(0, 9);
    }
  });
  it('the swinging leg bends its knee more than the stance leg, and the sole stays level', () => {
    const swing = legAngles(0, 1), stance = legAngles(Math.PI, 1);
    expect(swing.knee).toBeGreaterThan(stance.knee * 3);
    for (const a of [swing, stance, legAngles(1, 0.7)]) expect(a.hip - a.knee + a.ankle).toBeCloseTo(0, 9);
  });
});

describe('chase lens on a portrait phone (QA round 3: crew and rover in frame at 390 px)', () => {
  it('keeps the 28 degree lens on landscape stages and widens it on portrait ones so the pair stays inside', () => {
    expect(chaseFovDeg(1048 / 724)).toBe(CHASE_FOV_DEG);
    const aspect = 346 / 755, v = chaseFovDeg(aspect);
    const halfH = (Math.atan(Math.tan((v * Math.PI) / 360) * aspect) * 180) / Math.PI;
    expect(halfH).toBeGreaterThanOrEqual(12.9);
  });
});
