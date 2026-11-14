'use client';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { ribbonGeometryData } from './ribbon';

type Pt = [number, number, number];
export type RibbonStyle = 'solid' | 'dashed' | 'hatched';

const VERT = /* glsl */ `
attribute float aS; attribute float aT;
varying float vS; varying float vT; varying float vDepth;
void main() {
  vS = aS; vT = aT;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/**
 * Painted-on-the-ground look: a band of world width with stronger edges, a chevron pointing along the walk every 10 m, and
 * the status carried by pattern as well as colour (caution dashed, no-go hatched). Fades in from 2 to 5 m in front of the
 * eye (the band under the boots would otherwise fill the bottom of the view) and out beyond 250 to 600 m, where it is
 * thinner than a pixel and would only shimmer.
 */
const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; uniform float uStyle; uniform float uChevron;
varying float vS; varying float vT; varying float vDepth;
void main() {
  float at = abs(vT);
  float aa = max(fwidth(vS), 1e-3);
  float edge = smoothstep(0.62, 0.8, at);                        // stronger rims, lighter middle
  float a = mix(0.42, 0.85, edge);
  if (uChevron > 0.5) {
    // chevron: a V whose point leads in the walking direction, 0.5 m deep, every 10 m
    float c = fract((vS + at * 0.5) / 10.0) * 10.0;
    float chev = 1.0 - smoothstep(0.35 - aa, 0.35 + aa, c);
    a = max(a, 0.95 * chev);
  }
  if (uStyle > 0.5 && uStyle < 1.5) {                            // caution: 2 m dashes
    a *= step(0.0, sin(vS * 3.14159 / 2.0)) * 0.85 + 0.15;
  } else if (uStyle > 1.5) {                                       // no-go: diagonal hatch across the band, 1.5 m period
    float h = fract((vS + vT * 0.3) / 1.5);
    a *= mix(0.5, 1.0, smoothstep(0.5 - aa / 1.5, 0.5 + aa / 1.5, h));
  }
  a *= smoothstep(2.0, 5.0, vDepth) * (1.0 - smoothstep(250.0, 600.0, vDepth)) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export interface GroundRibbonProps {
  /** Points already on the rendered ground (scene y). */
  points: Pt[];
  color: string;
  /** World width in metres. */
  widthM?: number;
  style?: RibbonStyle;
  chevrons?: boolean;
  opacity?: number;
  /** Lift above the given points (m), so the band never dips into the terrain triangles. */
  liftM?: number;
  /** Distance already walked before the first point (m), so chevrons stay 10 m apart across pieces. */
  startS?: number;
  ground: (x: number, z: number) => number;
  renderOrder?: number;
}

/** A path drawn ON the ground in world units (it tapers with perspective), for the helmet view. */
export function GroundRibbon({ points, color, widthM = 0.4, style = 'solid', chevrons = true, opacity = 1, liftM = 0.05, startS = 0, ground, renderOrder = 11 }: GroundRibbonProps) {
  const geom = useMemo(() => {
    const d = ribbonGeometryData(points, widthM, 2, startS, (x, z) => ground(x, z) + liftM);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    g.setAttribute('aS', new THREE.BufferAttribute(d.s, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(d.t, 1));
    g.setIndex(new THREE.BufferAttribute(d.index, 1));
    g.computeBoundingSphere();
    return g;
  }, [points, widthM, startS, ground, liftM]);
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uStyle: { value: style === 'dashed' ? 1 : style === 'hatched' ? 2 : 0 }, uChevron: { value: chevrons ? 1 : 0 } },
  }), [color, opacity, style, chevrons]);
  useEffect(() => () => geom.dispose(), [geom]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh geometry={geom} material={mat} renderOrder={renderOrder} frustumCulled={false} raycast={() => null} />;
}
