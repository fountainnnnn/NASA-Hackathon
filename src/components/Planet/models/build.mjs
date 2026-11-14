/**
 * Builds the landing-simulation models as glTF binaries into public/models/ (run: node src/components/Planet/models/build.mjs).
 * Original simple models in metres, matte PBR, no insignia. glTF is Y-up, +Z forward; Cesium turns that into east-north-up.
 *   rover.glb       wheels' contact plane at y = 0, deck top at y = 1.2
 *   lander.glb      descent stage, origin at the underside centre of the deck, tanks and engines around it
 *   heatshield.glb  base plane at y = 0, shield extends to -y
 *   backshell.glb   base plane at y = 0, apex at y = +1.7
 *   parachute.glb   attach point at the origin, canopy rim at y = 32 m, canopy 21.5 m across
 *   dust.glb        soft stacked discs of radius 1 m, lying flat
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.FileReader = class {
  readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(b) { b.arrayBuffer().then((ab) => { this.result = `data:${b.type || 'application/octet-stream'};base64,${Buffer.from(ab).toString('base64')}`; this.onloadend?.(); }); }
};

const out = join(dirname(fileURLToPath(import.meta.url)), '../../../../public/models');
mkdirSync(out, { recursive: true });

const mat = (color, rough = 0.92, metal = 0.04, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };
const cyl = (rt, rb, h, seg = 24) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

/** A thin cylinder from a to b. */
function strut(a, b, r, m) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const o = mesh(cyl(r, r, len, 6), m);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return o;
}

function rover() {
  const g = new THREE.Group(); g.name = 'rover';
  const wheel = mat('#2b2b2d', 0.95), hub = mat('#5a5a5c', 0.8, 0.2), bar = mat('#8f9192', 0.7, 0.3);
  const body = mat('#bcb9b2'), deck = mat('#3b3a38', 0.85), white = mat('#d6d2ca');
  for (const sx of [-1, 1]) for (const z of [-1.2, 0, 1.2]) {
    const w = mesh(cyl(0.26, 0.26, 0.22, 20), wheel, sx * 1.1, 0.26, z); w.rotation.z = Math.PI / 2; g.add(w);
    const h = mesh(cyl(0.12, 0.12, 0.25, 12), hub, sx * 1.1, 0.26, z); h.rotation.z = Math.PI / 2; g.add(h);
    g.add(mesh(box(0.06, 0.34, 0.06), bar, sx * 1.0, 0.45, z));
  }
  for (const sx of [-1, 1]) g.add(mesh(box(0.08, 0.08, 2.6), bar, sx * 0.98, 0.62, 0));
  g.add(mesh(box(1.8, 0.55, 2.4), body, 0, 0.9, 0));
  g.add(mesh(box(1.74, 0.05, 2.34), deck, 0, 1.19, 0));
  const rtg = mesh(cyl(0.2, 0.2, 0.75, 16), mat('#6d6b67'), 0, 1.05, -1.5); rtg.rotation.x = Math.PI / 2; g.add(rtg);
  for (const sx of [-1, 1]) g.add(mesh(box(0.02, 0.28, 0.32), mat('#55534f'), sx * 0.2, 1.05, -1.62));
  g.add(mesh(cyl(0.04, 0.04, 1.1, 8), mat('#a9a7a2', 0.6, 0.3), -0.5, 1.75, 0.65));
  g.add(mesh(box(0.34, 0.2, 0.2), white, -0.5, 2.38, 0.65));
  g.add(mesh(box(0.1, 0.1, 0.05), mat('#202022'), -0.62, 2.38, 0.77)); g.add(mesh(box(0.1, 0.1, 0.05), mat('#202022'), -0.38, 2.38, 0.77));
  const hga = mesh(cyl(0.26, 0.26, 0.025, 24), white, 0.6, 1.45, -0.55); hga.rotation.set(0.5, 0, 0.4); g.add(hga);
  g.add(mesh(cyl(0.025, 0.025, 0.35, 6), bar, 0.6, 1.33, -0.55));
  g.add(mesh(box(0.55, 0.38, 0.4), mat('#a9a7a2'), 0, 0.88, 1.3));
  g.add(strut(new THREE.Vector3(-0.2, 0.9, 1.5), new THREE.Vector3(-0.35, 1.1, 2.0), 0.05, bar));
  g.add(strut(new THREE.Vector3(0.2, 0.9, 1.5), new THREE.Vector3(0.35, 1.05, 2.0), 0.05, bar));
  g.add(mesh(box(0.3, 0.25, 0.3), mat('#7e7c78'), 0, 0.85, 2.05));
  return g;
}

function lander() {
  const g = new THREE.Group(); g.name = 'lander';
  const skin = mat('#c9c3b5'), tank = mat('#9a8a67'), dark = mat('#38383a', 0.9), grey = mat('#8d8f90', 0.7, 0.3);
  g.add(mesh(cyl(1.55, 1.55, 0.35, 8), skin, 0, 0.175, 0));
  g.add(mesh(cyl(0.6, 0.6, 0.8, 16), mat('#d3cfc7'), 0, 0.75, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.4, 20, 14), tank, sx * 0.85, 0.7, sz * 0.85));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
    const noz = mesh(cyl(0.1, 0.22, 0.6, 14), dark); noz.position.set(x, -0.25, z);
    noz.rotation.set(Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28);
    g.add(noz);
    g.add(strut(new THREE.Vector3(x * 0.7, 0.1, z * 0.7), new THREE.Vector3(x, 0.0, z), 0.04, grey));
  }
  for (let k = 0; k < 3; k++) { const a = Math.PI / 2 + (k / 3) * Math.PI * 2; g.add(mesh(box(0.14, 0.1, 0.14), grey, Math.cos(a) * 0.55, -0.05, Math.sin(a) * 0.55)); }
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2; g.add(strut(new THREE.Vector3(Math.cos(a) * 0.5, 1.1, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 1.3, 0.35, Math.sin(a) * 1.3), 0.05, grey)); }
  return g;
}

function heatshield() {
  const g = new THREE.Group(); g.name = 'heatshield';
  const c = mesh(new THREE.ConeGeometry(2.25, 0.82, 48), mat('#2d2926', 0.97), 0, -0.41, 0); c.rotation.x = Math.PI; g.add(c);
  g.add(mesh(new THREE.TorusGeometry(2.22, 0.05, 8, 48), mat('#3a3531', 0.95), 0, 0, 0).rotateX(Math.PI / 2));
  return g;
}
function backshell() {
  const g = new THREE.Group(); g.name = 'backshell';
  g.add(mesh(cyl(0.9, 2.25, 1.7, 48), mat('#d1ccc4', 0.9), 0, 0.85, 0));
  g.add(mesh(cyl(0.5, 0.5, 0.3, 24), mat('#9a9791', 0.85), 0, 1.85, 0));
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const t = mesh(cyl(0.12, 0.18, 0.3, 10), mat('#444', 0.9), Math.cos(a) * 1.9, 0.45, Math.sin(a) * 1.9); t.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); g.add(t); }
  return g;
}
function parachute() {
  const g = new THREE.Group(); g.name = 'parachute';
  const R = 10.75, rim = 32, gores = 24;
  const sph = new THREE.SphereGeometry(R, gores * 2, 12, 0, Math.PI * 2, 0, Math.PI / 2.3);
  sph.scale(1, 0.62, 1); sph.translate(0, rim, 0);
  const pos = sph.attributes.position, col = new Float32Array(pos.count * 3);
  const or = new THREE.Color('#cf6a33'), wh = new THREE.Color('#e6e0d6');
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i)) + Math.PI, gi = Math.floor((a / (Math.PI * 2)) * gores) % gores;
    const rr = Math.hypot(pos.getX(i), pos.getZ(i)), ring = rr / R > 0.55 && gi % 2 === 0 ? 0.75 : 0;   // a darker band, no lettering
    (gi % 2 ? wh : or).toArray(col, i * 3);
    if (ring) { col[i * 3] *= 0.9; col[i * 3 + 1] *= 0.9; col[i * 3 + 2] *= 0.9; }
  }
  sph.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Mesh(sph, mat('#ffffff', 0.95, 0, { vertexColors: true, side: THREE.DoubleSide })));
  const line = mat('#d9d3c8', 0.9);
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; g.add(strut(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * R, rim, Math.sin(a) * R), 0.035, line)); }
  return g;
}
function dust() {
  const g = new THREE.Group(); g.name = 'dust';
  [[1, 0.1], [0.78, 0.1], [0.55, 0.12], [0.3, 0.14]].forEach(([r, a], i) => {
    const m = mat('#b69a7c', 1, 0, { transparent: true, opacity: a, side: THREE.DoubleSide, depthWrite: false });
    const d = mesh(new THREE.CircleGeometry(r, 48), m, 0, 0.02 * i, 0); d.rotation.x = -Math.PI / 2; g.add(d);
  });
  return g;
}

const jobs = { rover, lander, heatshield, backshell, parachute, dust };
for (const [name, fn] of Object.entries(jobs)) {
  const scene = new THREE.Scene(); scene.add(fn());
  const buf = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true }));
  writeFileSync(join(out, `${name}.glb`), Buffer.from(buf));
  console.log(name, buf.byteLength);
}
