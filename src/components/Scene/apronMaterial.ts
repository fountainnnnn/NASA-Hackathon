import * as THREE from 'three';
import { makeDummyTexture } from '@/lib/scene/textures';

/**
 * Material of the regional apron. Lit like the patch (MeshStandardMaterial), coloured from the CTX global mosaic crop
 * (hypsometric tint without it), with
 *  - a hole where the high-resolution patch sits (fragments inside the patch rectangle are discarded), and
 *  - a radial fade that carries the outer edge of the apron into the haze colour, so it ends in a horizon, not a slab.
 */
export interface ApronUniforms {
  tCtx: { value: THREE.Texture };
  uHasCtx: { value: number };
  uOpCtx: { value: number };
  uGain: { value: number };
  uHole: { value: THREE.Vector4 };      // xMin, zMin, xMax, zMax of the discarded rectangle, local metres
  uExtent: { value: THREE.Vector2 };    // apron width, height, metres
  uFadeM: { value: number };            // edge fade distance, metres
}

export const APRON_FADE_M = 28000;

export function createApronMaterial() {
  const dummy = makeDummyTexture();
  const uniforms: ApronUniforms = {
    tCtx: { value: dummy }, uHasCtx: { value: 0 }, uOpCtx: { value: 1 }, uGain: { value: 1 },
    uHole: { value: new THREE.Vector4(0, 0, 0, 0) }, uExtent: { value: new THREE.Vector2(1, 1) }, uFadeM: { value: APRON_FADE_M },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0 });
  // push the apron slightly away from the camera so the patch always wins where the two overlap
  material.polygonOffset = true;
  material.polygonOffsetFactor = 2;
  material.polygonOffsetUnits = 2;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aElev;
varying float vElevN; varying vec2 vTUv; varying vec2 vXZ;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vElevN = aElev; vTUv = uv; vXZ = position.xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vElevN; varying vec2 vTUv; varying vec2 vXZ;
uniform sampler2D tCtx; uniform vec4 uHole; uniform vec2 uExtent;
uniform float uHasCtx, uOpCtx, uGain, uFadeM;
float edgeFade(){
  float e = min(min(vTUv.x, 1.0 - vTUv.x) * uExtent.x, min(vTUv.y, 1.0 - vTUv.y) * uExtent.y);
  return 1.0 - smoothstep(0.0, uFadeM, e);
}`)
      .replace('#include <map_fragment>', `
if (vXZ.x > uHole.x && vXZ.x < uHole.z && vXZ.y > uHole.y && vXZ.y < uHole.w) discard;
vec3 hyps = mix(vec3(0.20,0.09,0.06), vec3(0.62,0.40,0.26), smoothstep(0.0, 1.0, vElevN));
vec3 col = hyps;
if (uHasCtx > 0.5) {
  float g = clamp(texture2D(tCtx, vTUv).r * uGain, 0.0, 1.0);
  col = mix(hyps, vec3(g) * vec3(1.00, 0.80, 0.64), uOpCtx);
}
diffuseColor.rgb *= col;
`)
      .replace('#include <fog_fragment>', `
#ifdef USE_FOG
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  fogF = max(fogF, pow(edgeFade(), 1.4));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogF);
#endif
`);
  };
  material.customProgramCacheKey = () => 'marswalk-apron-v1';
  return { material, uniforms, dummy };
}
