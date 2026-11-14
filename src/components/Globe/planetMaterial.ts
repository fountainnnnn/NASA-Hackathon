/**
 * Planet + atmosphere shaders.
 *  - Vertex: displaces a unit sphere by the MOLA DEM texture (km) × exaggeration.
 *  - Fragment: per-pixel relief normal from DEM finite differences, soft terminator, dusty limb haze,
 *    up to six alpha layer overlays (GlobalLayerId order).
 * Sun is camera-relative (upper-left, ~50° off the view axis) so the visible disc always has a readable
 * terminator and raking light on relief.
 */
import * as THREE from 'three';
import { R_KM } from './geo';

export const LAYER_SLOTS = 6;

const planetVert = /* glsl */ `
uniform sampler2D uDem; uniform float uHasDem; uniform float uExag;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
void main() {
  vec3 n = normalize(position);
  float h = uHasDem > 0.5 ? texture2D(uDem, uv).r : 0.0; // km
  vec3 p = n * (1.0 + h * uExag / ${R_KM.toFixed(3)});
  vUv = uv; vN = n; vP = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const planetFrag = /* glsl */ `
uniform sampler2D uTex; uniform float uHasTex;
uniform sampler2D uDem; uniform float uHasDem; uniform vec2 uDemSize; uniform float uExag;
uniform sampler2D uL0; uniform sampler2D uL1; uniform sampler2D uL2; uniform sampler2D uL3; uniform sampler2D uL4; uniform sampler2D uL5;
uniform float uLA[${LAYER_SLOTS}];
uniform vec3 uSun; uniform float uGrid;
varying vec2 vUv; varying vec3 vN; varying vec3 vP;
#define PI 3.14159265359
void main() {
  vec3 n = normalize(vN);
  vec3 albedo = uHasTex > 0.5 ? texture2D(uTex, vUv).rgb : vec3(0.045, 0.022, 0.012); // linear dark ochre (loading / unavailable)
  vec4 l;
  if (uLA[0] > 0.0) { l = texture2D(uL0, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[0]); }
  if (uLA[1] > 0.0) { l = texture2D(uL1, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[1]); }
  if (uLA[2] > 0.0) { l = texture2D(uL2, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[2]); }
  if (uLA[3] > 0.0) { l = texture2D(uL3, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[3]); }
  if (uLA[4] > 0.0) { l = texture2D(uL4, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[4]); }
  if (uLA[5] > 0.0) { l = texture2D(uL5, vUv); albedo = mix(albedo, l.rgb, l.a * uLA[5]); }

  vec3 nn = n;
  if (uHasDem > 0.5) {
    vec2 d = 1.0 / uDemSize;
    float hE = texture2D(uDem, vUv + vec2(d.x, 0.0)).r - texture2D(uDem, vUv - vec2(d.x, 0.0)).r; // km across 2 texels, +u = east
    float hN = texture2D(uDem, vUv + vec2(0.0, d.y)).r - texture2D(uDem, vUv - vec2(0.0, d.y)).r; // +v = north
    float cl = max(sqrt(max(1.0 - n.y * n.y, 0.0)), 0.04);
    float dxE = 2.0 * d.x * 2.0 * PI * ${R_KM.toFixed(3)} * cl;
    float dyN = 2.0 * d.y * PI * ${R_KM.toFixed(3)};
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 E = cross(up, n); E = length(E) < 1e-4 ? vec3(1.0, 0.0, 0.0) : normalize(E);
    vec3 Nn = cross(n, E);
    nn = normalize(n - uExag * (E * (hE / dxE) + Nn * (hN / dyN)));
  }

  float ndlGeo = dot(n, uSun);
  float ndl = dot(nn, uSun);
  float term = smoothstep(-0.10, 0.32, ndlGeo);                       // soft terminator
  float diffuse = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
  float light = (0.10 + 0.90 * diffuse) * term;
  vec3 sunCol = vec3(1.0, 0.94, 0.86);
  vec3 col = albedo * sunCol * light * 1.22 + albedo * vec3(0.55, 0.62, 0.9) * 0.012; // faint earthshine-free night side

  vec3 V = normalize(cameraPosition - vP);
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  col += vec3(0.66, 0.46, 0.34) * fres * 0.16 * term;                // thin dusty limb haze

  // graticule: levels subdivide continuously; a level fades in when its lines are 34..80 px apart on screen
  float lonD = vUv.x * 360.0 - 180.0, latD = vUv.y * 180.0 - 90.0;
  float dLat = max(fwidth(latD), 1e-6);
  float dLon = max(min(fwidth(lonD), dLat * 8.0), 1e-6);
  float polar = smoothstep(86.0, 78.0, abs(latD));
  float grid = 0.0;
  float steps[7] = float[7](30.0, 10.0, 5.0, 1.0, 0.2, 0.05, 0.01);
  for (int i = 0; i < 7; i++) {
    float s = steps[i];
    float vis = smoothstep(34.0, 80.0, s / dLat);
    float lineLat = 1.0 - clamp(abs(fract(latD / s + 0.5) - 0.5) * s / dLat, 0.0, 1.0);
    float lineLon = (1.0 - clamp(abs(fract(lonD / s + 0.5) - 0.5) * s / dLon, 0.0, 1.0)) * polar;
    grid = max(grid, max(lineLat, lineLon) * vis * (i < 2 ? 0.7 : 1.0));
  }
  col = mix(col, vec3(0.80, 0.77, 0.73), grid * 0.09 * uGrid * max(term, 0.25));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const atmoVert = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

/** Shell at radius SHELL; brightness depends on the view ray's closest approach to the planet centre (distance-independent). */
export const ATMO_SHELL = 1.022;
const atmoFrag = /* glsl */ `
uniform vec3 uSun;
varying vec3 vW;
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vW - ro);
  float t = -dot(ro, rd);
  vec3 q = ro + rd * t;                         // closest point on the ray to the centre
  float b = length(q);                          // impact parameter, planet limb at b = 1
  float e = clamp((b - 1.0) / (${ATMO_SHELL.toFixed(3)} - 1.0), 0.0, 1.0);
  float glow = pow(1.0 - e, 2.6) * smoothstep(0.0, 0.08, e + 0.02);
  float lit = smoothstep(-0.35, 0.45, dot(normalize(q), uSun));
  vec3 col = mix(vec3(0.62, 0.40, 0.28), vec3(0.74, 0.55, 0.42), glow) * glow * (0.08 + 0.92 * lit) * 0.30;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function createPlanetMaterial(): THREE.ShaderMaterial {
  const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  dummy.needsUpdate = true;
  return new THREE.ShaderMaterial({
    vertexShader: planetVert,
    fragmentShader: planetFrag,
    uniforms: {
      uTex: { value: dummy }, uHasTex: { value: 0 },
      uDem: { value: dummy }, uHasDem: { value: 0 }, uDemSize: { value: new THREE.Vector2(2880, 1440) }, uExag: { value: 20 },
      uL0: { value: dummy }, uL1: { value: dummy }, uL2: { value: dummy }, uL3: { value: dummy }, uL4: { value: dummy }, uL5: { value: dummy },
      uLA: { value: new Array(LAYER_SLOTS).fill(0) }, uGrid: { value: 1 },
      uSun: { value: new THREE.Vector3(-0.6, 0.3, 0.75).normalize() },
    },
  });
}

export function createAtmosphereMaterial(sun: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: atmoVert, fragmentShader: atmoFrag,
    uniforms: { uSun: { value: sun } },
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
