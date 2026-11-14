/**
 * Line helpers shared by the Jezero scene's route, ruler and traverse marks.
 *  - near fade: marks closer to the camera than NEAR_FADE.far fade out (fully gone at .near). Set only in helmet view, so
 *    the route under the walker's own boots never runs up the screen as a vertical bar.
 *  - screen dashes: dash and gap given in pixels, rescaled every frame from the camera distance (drei's dashes are world
 *    units, which turn into huge strokes near the camera and sub-pixel flicker far away).
 */
import * as THREE from 'three';

/** Shared fade window in metres from the camera (view depth). far = 0 switches the fade off. */
export const NEAR_FADE = { near: { value: 0 }, far: { value: 0 } };
export function setNearFade(near: number, far: number) { NEAR_FADE.near.value = near; NEAR_FADE.far.value = far; }

const FADE_FN = /* glsl */ `
uniform float uFadeNear; uniform float uFadeFar; varying float vFadeZ;
float nearFade() { return uFadeFar > 0.0 ? smoothstep(uFadeNear, uFadeFar, vFadeZ) : 1.0; }`;

/** Patch a drei <Line> material (three-stdlib LineMaterial) with the near fade. Idempotent. */
export function fadeLineMaterial(m: THREE.Material & { userData: Record<string, unknown> }) {
  if (m.userData.nearFade) return;
  m.userData.nearFade = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeNear = NEAR_FADE.near; sh.uniforms.uFadeFar = NEAR_FADE.far;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vFadeZ;\nvoid main() {')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\nvFadeZ = -(( position.y < 0.5 ) ? start.z : end.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${FADE_FN}\nvoid main() {`)
      .replace('gl_FragColor = diffuseColor;', 'diffuseColor.a *= nearFade();\ngl_FragColor = diffuseColor;');
  };
  m.customProgramCacheKey = () => 'line-near-fade-v1';
  m.transparent = true;
  m.needsUpdate = true;
}

/** Patch a LineBasicMaterial / MeshBasicMaterial with the near fade. */
export function fadeBasicMaterial(m: THREE.Material) {
  if (m.userData.nearFade) return;
  m.userData.nearFade = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeNear = NEAR_FADE.near; sh.uniforms.uFadeFar = NEAR_FADE.far;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vFadeZ;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeZ = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${FADE_FN}\nvoid main() {`)
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= nearFade();\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'basic-near-fade-v1';
  m.transparent = true;
  m.needsUpdate = true;
}

/** Metres covered by one screen pixel at `distM` from a perspective camera. */
export function metresPerPx(cam: THREE.PerspectiveCamera, distM: number, heightPx: number): number {
  return (2 * Math.tan((cam.fov * Math.PI) / 360) * Math.max(distM, 0.1)) / Math.max(1, heightPx);
}
