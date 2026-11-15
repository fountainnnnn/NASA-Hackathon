/**
 * Line helpers shared by the Jezero scene's route, ruler and traverse marks.
 *  - near fade: marks closer to the camera than NEAR_FADE.far fade out (fully gone at .near). Set only in helmet view, so
 *    the route under the walker's own boots never runs up the screen as a vertical bar.
 *  - far dimming: marks beyond FAR_DIM.from drop to FAR_DIM.alpha (rover assist chase view: the distant legs recede).
 *  - screen dashes: dash and gap given in pixels, rescaled every frame from the camera distance (drei's dashes are world
 *    units, which turn into huge strokes near the camera and sub-pixel flicker far away).
 */
import * as THREE from 'three';

/** Shared fade window in metres from the camera (view depth). far = 0 switches the fade off. */
export const NEAR_FADE = { near: { value: 0 }, far: { value: 0 } };
export function setNearFade(near: number, far: number) { NEAR_FADE.near.value = near; NEAR_FADE.far.value = far; }
/** Far dimming: marks farther than `from` metres (view depth) drop to `alpha`. from = 0 switches it off (rover assist chase view uses it). */
export const FAR_DIM = { from: { value: 0 }, alpha: { value: 1 } };
export function setFarDim(from: number, alpha = 0.3) { FAR_DIM.from.value = from; FAR_DIM.alpha.value = alpha; }

const FADE_FN = /* glsl */ `
uniform float uFadeNear; uniform float uFadeFar; uniform float uDimFrom; uniform float uDimAlpha; varying float vFadeZ;
float nearFade() {
  float a = uFadeFar > 0.0 ? smoothstep(uFadeNear, uFadeFar, vFadeZ) : 1.0;
  if (uDimFrom > 0.0) a *= mix(1.0, uDimAlpha, smoothstep(uDimFrom * 0.9, uDimFrom, vFadeZ));
  return a;
}`;

/** Patch a drei <Line> material (three-stdlib LineMaterial) with the near fade. Idempotent. */
export function fadeLineMaterial(m: THREE.Material & { userData: Record<string, unknown> }) {
  if (m.userData.nearFade) return;
  m.userData.nearFade = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeNear = NEAR_FADE.near; sh.uniforms.uFadeFar = NEAR_FADE.far; sh.uniforms.uDimFrom = FAR_DIM.from; sh.uniforms.uDimAlpha = FAR_DIM.alpha;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vFadeZ;\nvoid main() {')
      .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\nvFadeZ = -(( position.y < 0.5 ) ? start.z : end.z);');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${FADE_FN}\nvoid main() {`)
      .replace('gl_FragColor = diffuseColor;', 'diffuseColor.a *= nearFade();\ngl_FragColor = diffuseColor;');
  };
  m.customProgramCacheKey = () => 'line-near-fade-v2';
  m.transparent = true;
  m.needsUpdate = true;
}

/** Patch a LineBasicMaterial / MeshBasicMaterial with the near fade. */
export function fadeBasicMaterial(m: THREE.Material) {
  if (m.userData.nearFade) return;
  m.userData.nearFade = true;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFadeNear = NEAR_FADE.near; sh.uniforms.uFadeFar = NEAR_FADE.far; sh.uniforms.uDimFrom = FAR_DIM.from; sh.uniforms.uDimAlpha = FAR_DIM.alpha;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'varying float vFadeZ;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFadeZ = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${FADE_FN}\nvoid main() {`)
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= nearFade();\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'basic-near-fade-v2';
  m.transparent = true;
  m.needsUpdate = true;
}

/** Metres covered by one screen pixel at `distM` from a perspective camera. */
export function metresPerPx(cam: THREE.PerspectiveCamera, distM: number, heightPx: number): number {
  return (2 * Math.tan((cam.fov * Math.PI) / 360) * Math.max(distM, 0.1)) / Math.max(1, heightPx);
}
