import * as THREE from 'three';
import { makeDummyTexture } from '@/lib/scene/textures';

/** Terrain = MeshStandardMaterial (so sun + hemisphere lighting apply) with the layer blend injected. */
export interface TerrainUniforms {
  tCtx: { value: THREE.Texture }; tDay: { value: THREE.Texture }; tNight: { value: THREE.Texture };
  tGeo: { value: THREE.Texture }; tPal: { value: THREE.Texture }; tSlope: { value: THREE.Texture };
  uHas: { value: THREE.Vector4 };       // ctx, day, night, geology (0/1)
  uHas2: { value: THREE.Vector2 };      // slope texture present, palette present
  uOp: { value: THREE.Vector4 };        // ctx, day, night, geology opacity (0 = layer hidden)
  uSlopeOp: { value: number };          // slope overlay opacity (0 = hidden)
  uLimit: { value: number };            // max slope, degrees
}

const GLSL_INFERNO = /* glsl */ `
vec3 inferno(float t){
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
  const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
  const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
  const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
  const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
  const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
  const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
  return clamp(c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6))))), 0.0, 1.0);
}
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
`;

export function createTerrainMaterial() {
  const dummy = makeDummyTexture();
  const uniforms: TerrainUniforms = {
    tCtx: { value: dummy }, tDay: { value: dummy }, tNight: { value: dummy }, tGeo: { value: dummy },
    tPal: { value: dummy }, tSlope: { value: dummy },
    uHas: { value: new THREE.Vector4(0, 0, 0, 0) }, uHas2: { value: new THREE.Vector2(0, 0) },
    uOp: { value: new THREE.Vector4(1, 0, 0, 0) }, uSlopeOp: { value: 0 }, uLimit: { value: 15 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aValid; attribute float aElev;
varying float vValid; varying float vElevN; varying vec2 vTUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vValid = aValid; vElevN = aElev; vTUv = uv;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vValid; varying float vElevN; varying vec2 vTUv;
uniform sampler2D tCtx, tDay, tNight, tGeo, tPal, tSlope;
uniform vec4 uHas, uOp; uniform vec2 uHas2; uniform float uSlopeOp, uLimit;
${GLSL_INFERNO}`)
      .replace('#include <map_fragment>', `
if (vValid < 0.5) discard;
// hypsometric tint when no imagery: dark rust -> sand
vec3 hyps = mix(vec3(0.20,0.09,0.06), vec3(0.62,0.40,0.26), smoothstep(0.0, 1.0, vElevN));
vec3 col = hyps;
if (uHas.x > 0.5) {
  float g = texture2D(tCtx, vTUv).r;
  vec3 ctxCol = vec3(g) * vec3(1.00, 0.80, 0.64); // cosmetic warm tint: CTX is greyscale
  col = mix(hyps, ctxCol, uOp.x);
}
if (uHas.y > 0.5 && uOp.y > 0.0) col = mix(col, toLin(inferno(texture2D(tDay, vTUv).r)), uOp.y);
if (uHas.z > 0.5 && uOp.z > 0.0) col = mix(col, toLin(inferno(texture2D(tNight, vTUv).r)), uOp.z);
if (uHas.w > 0.5 && uHas2.y > 0.5 && uOp.w > 0.0) {
  float idx = floor(texture2D(tGeo, vTUv).r * 255.0 + 0.5);
  if (idx > 0.5) col = mix(col, texture2D(tPal, vec2((idx + 0.5) / 256.0, 0.5)).rgb, uOp.w);
}
if (uHas2.x > 0.5 && uSlopeOp > 0.0) {
  float s = texture2D(tSlope, vTUv).r;
  float red = smoothstep(uLimit - 0.4, uLimit + 0.4, s);
  float amber = smoothstep(0.8 * uLimit - 0.4, 0.8 * uLimit + 0.4, s) * (1.0 - red);
  col = mix(col, vec3(0.95, 0.10, 0.08), red * 0.62 * uSlopeOp);
  col = mix(col, vec3(1.00, 0.62, 0.10), amber * 0.45 * uSlopeOp);
}
diffuseColor.rgb *= col;
`);
  };
  material.customProgramCacheKey = () => 'marswalk-terrain-v1';
  return { material, uniforms, dummy };
}
