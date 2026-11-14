/**
 * Original astronaut built from three.js primitives. Realistic proportions (1.99 m to the top of the helmet in the suit),
 * matte off-white suit, no flags, patches or insignia of any agency. Jointed at hip, knee, ankle, shoulder and elbow so the
 * gait (chase.ts) can keep the planted boot on the ground. Units: metres, +y up, forward = +z.
 */
import * as THREE from 'three';
import { FOOT_M, HIP_Y, SHIN_M, THIGH_M, legAngles, pelvisDrop } from './chase';

export interface Astronaut {
  root: THREE.Group;
  body: THREE.Group;        // pelvis: drops and sways with the gait
  torso: THREE.Group;       // leans under the pack
  legL: THREE.Group; legR: THREE.Group;
  kneeL: THREE.Group; kneeR: THREE.Group;
  ankleL: THREE.Group; ankleR: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  elbowL: THREE.Group; elbowR: THREE.Group;
  height: number;
}

const SEG = 12;
const mats = (() => {
  // matte, muted off-white suit with grey detail; nothing glossy except a slightly smoother visor
  const m = (color: string, roughness = 0.92, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    suit: m('#d9d6cf'), suitShade: m('#c4c1ba'), joint: m('#a9a7a1'), trim: m('#8d8c88'), pack: m('#cbc8c1'),
    dark: m('#3a3833'), sole: m('#2a2926'), visor: m('#3d3a35', 0.35, 0.25), band: m('#8a4b3a', 0.9),
  };
})();

const geo = (() => ({
  torso: new THREE.CylinderGeometry(0.205, 0.185, 0.5, SEG, 1),
  chestPlate: new THREE.BoxGeometry(0.3, 0.2, 0.06),
  hips: new THREE.CylinderGeometry(0.19, 0.175, 0.18, SEG, 1),
  thigh: new THREE.CapsuleGeometry(0.088, THIGH_M - 0.12, 3, SEG),
  knee: new THREE.SphereGeometry(0.083, SEG, 8),
  shin: new THREE.CapsuleGeometry(0.078, SHIN_M - 0.12, 3, SEG),
  boot: new THREE.BoxGeometry(0.15, 0.11, 0.29),
  sole: new THREE.BoxGeometry(0.155, 0.025, 0.3),
  band: new THREE.CylinderGeometry(0.092, 0.092, 0.06, SEG, 1, true),
  upperArm: new THREE.CapsuleGeometry(0.066, 0.2, 3, SEG),
  elbow: new THREE.SphereGeometry(0.062, SEG, 8),
  foreArm: new THREE.CapsuleGeometry(0.058, 0.18, 3, SEG),
  glove: new THREE.SphereGeometry(0.06, SEG, 8),
  helmet: new THREE.SphereGeometry(0.19, 20, 14),
  visor: new THREE.SphereGeometry(0.195, 20, 12, Math.PI / 2 - 0.95, 1.9, 0.75, 1.25),
  neckRing: new THREE.TorusGeometry(0.13, 0.025, 8, 20),
  pack: new THREE.BoxGeometry(0.44, 0.58, 0.22),
  packTop: new THREE.BoxGeometry(0.36, 0.1, 0.18),
  shoulder: new THREE.SphereGeometry(0.092, SEG, 8),
  shadow: new THREE.PlaneGeometry(1, 1),
}))();

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

/** @param marked a darker band on the thighs and upper arms, the way EVA crews tell two suits apart. */
export function createAstronaut(marked = false): Astronaut {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const mkLeg = (side: number) => {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, HIP_Y, 0);
    hip.add(mesh(geo.thigh, mats.suit, 0, -THIGH_M / 2, 0));
    if (marked) hip.add(mesh(geo.band, mats.band, 0, -THIGH_M * 0.45, 0));
    const knee = new THREE.Group(); knee.position.set(0, -THIGH_M, 0); hip.add(knee);
    knee.add(mesh(geo.knee, mats.joint));
    knee.add(mesh(geo.shin, mats.suitShade, 0, -SHIN_M / 2, 0));
    const ankle = new THREE.Group(); ankle.position.set(0, -SHIN_M, 0); knee.add(ankle);
    ankle.add(mesh(geo.boot, mats.dark, 0, -FOOT_M + 0.055 + 0.0125, 0.05));
    ankle.add(mesh(geo.sole, mats.sole, 0, -FOOT_M + 0.0125, 0.05));
    return { hip, knee, ankle };
  };
  const L = mkLeg(-1), R = mkLeg(1);
  body.add(L.hip, R.hip);
  body.add(mesh(geo.hips, mats.suitShade, 0, HIP_Y + 0.04, 0));

  const torso = new THREE.Group(); torso.position.set(0, HIP_Y + 0.1, 0); body.add(torso);
  torso.add(mesh(geo.torso, mats.suit, 0, 0.25, 0));
  torso.add(mesh(geo.chestPlate, mats.trim, 0, 0.36, 0.17));
  torso.add(mesh(geo.shoulder, mats.joint, -0.235, 0.46, 0), mesh(geo.shoulder, mats.joint, 0.235, 0.46, 0));
  torso.add(mesh(geo.pack, mats.pack, 0, 0.3, -0.22));
  torso.add(mesh(geo.packTop, mats.trim, 0, 0.64, -0.22));
  const ring = mesh(geo.neckRing, mats.trim, 0, 0.53, 0); ring.rotation.x = Math.PI / 2; torso.add(ring);
  const helmetY = 0.71;
  torso.add(mesh(geo.helmet, mats.suit, 0, helmetY, 0));
  torso.add(mesh(geo.visor, mats.visor, 0, helmetY, 0)); // faces +z

  const mkArm = (side: number) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.255, 0.44, 0);
    sh.add(mesh(geo.upperArm, mats.suit, side * 0.01, -0.15, 0));
    if (marked) sh.add(mesh(geo.band, mats.band, side * 0.01, -0.12, 0));
    const el = new THREE.Group(); el.position.set(side * 0.015, -0.3, 0); sh.add(el);
    el.add(mesh(geo.elbow, mats.joint));
    el.add(mesh(geo.foreArm, mats.suitShade, 0, -0.14, 0.0));
    el.add(mesh(geo.glove, mats.dark, 0, -0.29, 0.0));
    torso.add(sh);
    return { sh, el };
  };
  const AL = mkArm(-1), AR = mkArm(1);
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return {
    root, body, torso, legL: L.hip, legR: R.hip, kneeL: L.knee, kneeR: R.knee, ankleL: L.ankle, ankleR: R.ankle,
    armL: AL.sh, armR: AR.sh, elbowL: AL.el, elbowR: AR.el, height: HIP_Y + 0.1 + helmetY + 0.19,
  };
}

/**
 * Gait pose for phase (radians) and amplitude 0..1. Mars gravity: a long, soft stride with a forward lean under the pack.
 * The pelvis drops so the lower boot stays exactly on the ground (no floating or sinking feet).
 */
export function poseAstronaut(a: Astronaut, phase: number, amp: number, riding = false): void {
  if (riding) {
    // standing on the rover's rear deck, knees soft, hands forward on the rail
    for (const [hip, knee, ankle] of [[a.legL, a.kneeL, a.ankleL], [a.legR, a.kneeR, a.ankleR]] as const) {
      hip.rotation.x = -0.12; knee.rotation.x = 0.24; ankle.rotation.x = -0.12;
    }
    a.armL.rotation.x = -0.75; a.armR.rotation.x = -0.75; a.elbowL.rotation.x = -0.5; a.elbowR.rotation.x = -0.5;
    a.torso.rotation.x = 0.05; a.body.rotation.z = 0;
    a.body.position.y = pelvisDrop({ hip: 0.12, knee: 0.24, ankle: 0 }, { hip: 0.12, knee: 0.24, ankle: 0 });
    return;
  }
  const l = legAngles(phase, amp), r = legAngles(phase + Math.PI, amp);
  // three.js rotation.x > 0 swings a hanging limb backwards (-z), so a forward hip angle is negative here
  a.legL.rotation.x = -l.hip; a.kneeL.rotation.x = l.knee; a.ankleL.rotation.x = -l.ankle;
  a.legR.rotation.x = -r.hip; a.kneeR.rotation.x = r.knee; a.ankleR.rotation.x = -r.ankle;
  // arms counter-swing (left arm with the right leg), elbows a little bent; pressurised gloves stay low
  const s = Math.sin(phase);
  a.armL.rotation.x = s * 0.32 * amp - 0.05; a.armR.rotation.x = -s * 0.32 * amp - 0.05;
  a.elbowL.rotation.x = -0.25 - Math.max(0, -s) * 0.25 * amp; a.elbowR.rotation.x = -0.25 - Math.max(0, s) * 0.25 * amp;
  a.body.position.y = pelvisDrop(l, r);
  a.body.rotation.z = 0.025 * amp * Math.sin(phase);          // weight shift over the stance leg
  a.torso.rotation.x = 0.04 + 0.08 * amp;                       // lean under the life-support pack
}

/** Soft contact shadow texture: a radial falloff, darkest at the centre. Shared by all figures. */
let shadowTex: THREE.Texture | null = null;
export function contactShadowTexture(): THREE.Texture {
  if (shadowTex) return shadowTex;
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
    const r = Math.min(1, Math.hypot(dx, dy));
    const a = Math.pow(1 - r, 1.6);
    const i = (y * n + x) * 4;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = Math.round(a * 255);
  }
  shadowTex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  shadowTex.magFilter = THREE.LinearFilter; shadowTex.minFilter = THREE.LinearFilter; shadowTex.needsUpdate = true;
  return shadowTex;
}
export const SHADOW_GEOMETRY = geo.shadow;
