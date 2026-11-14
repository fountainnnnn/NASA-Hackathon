/**
 * Original low-poly astronaut built from three.js primitives. Realistic proportions (about 1.85 m in the suit),
 * muted colours, no flags, patches or insignia of any agency. Units: metres, +y up, forward = +z.
 */
import * as THREE from 'three';

export interface Astronaut {
  root: THREE.Group;
  body: THREE.Group;        // bobs for gait
  legL: THREE.Group; legR: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  footL: THREE.Object3D; footR: THREE.Object3D;
  height: number;
}

const SEG = 8;
const mats = (() => {
  const suit = new THREE.MeshStandardMaterial({ color: '#cfcac1', roughness: 0.85, metalness: 0.0, flatShading: true });
  const suitShade = new THREE.MeshStandardMaterial({ color: '#b3aea6', roughness: 0.9, metalness: 0.0, flatShading: true });
  const trim = new THREE.MeshStandardMaterial({ color: '#8c6a4c', roughness: 0.8, metalness: 0.05, flatShading: true });
  const pack = new THREE.MeshStandardMaterial({ color: '#a9a49b', roughness: 0.75, metalness: 0.1, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2927', roughness: 0.9, metalness: 0.1, flatShading: true });
  const visor = new THREE.MeshStandardMaterial({ color: '#c2a057', roughness: 0.3, metalness: 0.6, flatShading: false });
  return { suit, suitShade, trim, pack, dark, visor };
})();

const geo = (() => ({
  torso: new THREE.CylinderGeometry(0.21, 0.19, 0.56, SEG, 1),
  hips: new THREE.CylinderGeometry(0.19, 0.18, 0.2, SEG, 1),
  thigh: new THREE.CapsuleGeometry(0.088, 0.36, 2, SEG),
  shin: new THREE.CapsuleGeometry(0.08, 0.34, 2, SEG),
  boot: new THREE.BoxGeometry(0.15, 0.1, 0.3),
  upperArm: new THREE.CapsuleGeometry(0.066, 0.24, 2, SEG),
  foreArm: new THREE.CapsuleGeometry(0.06, 0.22, 2, SEG),
  glove: new THREE.SphereGeometry(0.065, SEG, 6),
  helmet: new THREE.SphereGeometry(0.2, 12, 9),
  visor: new THREE.SphereGeometry(0.206, 12, 8, Math.PI / 2 - 0.9, 1.8, 0.7, 1.35),
  neck: new THREE.CylinderGeometry(0.1, 0.12, 0.07, SEG),
  pack: new THREE.BoxGeometry(0.42, 0.56, 0.24),
  packTop: new THREE.BoxGeometry(0.34, 0.12, 0.2),
  chest: new THREE.BoxGeometry(0.2, 0.15, 0.04),
  shoulder: new THREE.SphereGeometry(0.095, SEG, 6),
}))();

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  return o;
}

function limb(parts: [THREE.BufferGeometry, THREE.Material, number, number, number][], x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  for (const [gm, mt, px, py, pz] of parts) g.add(mesh(gm, mt, px, py, pz));
  return g;
}

export function createAstronaut(): Astronaut {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hipY = 0.93;

  const mkLeg = (side: number) => {
    const leg = limb([
      [geo.thigh, mats.suit, 0, -0.26, 0],
      [geo.shin, mats.suitShade, 0, -0.64, 0.01],
      [geo.boot, mats.dark, 0, -0.86, 0.06],
    ], side * 0.105, hipY);
    return leg;
  };
  const legL = mkLeg(-1), legR = mkLeg(1);
  const footL = legL.children[2], footR = legR.children[2];
  body.add(legL, legR);

  body.add(mesh(geo.hips, mats.suitShade, 0, hipY + 0.04, 0));
  body.add(mesh(geo.torso, mats.suit, 0, hipY + 0.36, 0));
  body.add(mesh(geo.chest, mats.dark, 0, hipY + 0.45, 0.17));
  body.add(mesh(geo.shoulder, mats.trim, -0.245, hipY + 0.58, 0), mesh(geo.shoulder, mats.trim, 0.245, hipY + 0.58, 0));
  body.add(mesh(geo.neck, mats.suitShade, 0, hipY + 0.68, 0));
  // life-support pack
  body.add(mesh(geo.pack, mats.pack, 0, hipY + 0.4, -0.23));
  body.add(mesh(geo.packTop, mats.trim, 0, hipY + 0.73, -0.23));
  // helmet + gold visor
  const helmetY = hipY + 0.86;
  body.add(mesh(geo.helmet, mats.suit, 0, helmetY, 0));
  const v = mesh(geo.visor, mats.visor, 0, helmetY, 0);
  v.rotation.y = 0; // faces +z
  body.add(v);

  const mkArm = (side: number) => limb([
    [geo.upperArm, mats.suit, side * 0.03, -0.17, 0],
    [geo.foreArm, mats.suitShade, side * 0.04, -0.46, 0.02],
    [geo.glove, mats.dark, side * 0.04, -0.62, 0.03],
  ], side * 0.27, hipY + 0.55);
  const armL = mkArm(-1), armR = mkArm(1);
  body.add(armL, armR);

  root.traverse((o) => { o.matrixAutoUpdate = true; });
  return { root, body, legL, legR, armL, armR, footL, footR, height: helmetY + 0.2 };
}

/** Gait pose for phase (radians) and amplitude 0..1. Mars gravity gives a longer, softer bob than Earth walking. */
export function poseAstronaut(a: Astronaut, phase: number, amp: number, riding = false): void {
  if (riding) {
    a.legL.rotation.x = -0.9; a.legR.rotation.x = -0.9;
    a.armL.rotation.x = -0.5; a.armR.rotation.x = -0.5;
    a.body.position.y = -0.38; a.body.rotation.x = 0;
    return;
  }
  const s = Math.sin(phase);
  const swing = 0.62 * amp;
  a.legL.rotation.x = s * swing;
  a.legR.rotation.x = -s * swing;
  a.armL.rotation.x = -s * swing * 0.7;
  a.armR.rotation.x = s * swing * 0.7;
  a.body.position.y = Math.abs(Math.cos(phase)) * 0.045 * amp;
  a.body.rotation.x = 0.06 * amp; // slight forward lean under the pack
}
