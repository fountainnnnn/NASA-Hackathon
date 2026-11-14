'use client';
import { useMemo } from 'react';
import * as THREE from 'three';

/** Haze colour shared by the sky horizon, the distance fog and the apron's edge fade, so the land meets the sky seamlessly. */
export const HAZE = '#a8795f';
const ZENITH = '#2b1c1e';
const MID = '#7a5547';

/** Camera-centred gradient dome. Drawn at the far plane (depth = 1) with the rotation-only view matrix. */
export function Sky() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: new THREE.Color(HAZE) }, uMid: { value: new THREE.Color(MID) }, uZenith: { value: new THREE.Color(ZENITH) } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 uHorizon, uMid, uZenith; varying vec3 vDir;
      void main() {
        float h = max(normalize(vDir).y, 0.0);
        vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.16, h));
        c = mix(c, uZenith, smoothstep(0.10, 0.75, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }), []);
  return (
    <mesh material={material} renderOrder={-100} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}
