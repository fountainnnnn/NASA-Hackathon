'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { destinationPoint, ellipsePoints, greatCircleLerp, lonLatToXYZ, R_KM } from '../Globe/geo';
import type { LonLat } from '../../lib/contracts';
import type { EdlPhase, LandingScenarioResult } from '../../lib/globeContracts';
import { usePlayback } from '@/state/playback';
import {
  APPROACH_FROM_BEARING_DEG, APPROACH_RANGE_KM, altitudeKmAt, approachFraction, edlEndS, phaseAt, popScale, revealCount, revealProgress, unpackTouchdowns,
} from './landing';
import { LANDING_REVEAL_S } from './landing';
import css from './scenario.module.css';

const OK = '#5cc8ff', FAIL = '#d9423b', ARC = '#e0884a';

export interface LandingPlaybackProps {
  phases: EdlPhase[];
  result: LandingScenarioResult;
  site: LonLat;
  /** Slope limit used to colour the touchdowns (same value the scenario used). */
  maxSlopeDeg: number;
  ellipse?: { semiMajorKm: number; semiMinorKm: number; azimuthDeg: number };
  /** Schematic approach direction and range (assumptions, see landing.ts). */
  approachFromBearingDeg?: number;
  approachRangeKm?: number;
  /** Globe units: 1 = one Mars radius. surfaceRadius lets the host return the relief radius (1 + exaggerated elevation). */
  surfaceRadius?: (lon: number, lat: number) => number;
  /** Drawn size of the capsule marker and touchdown dots, km (marker grows with camera distance so it stays visible). */
  capsuleSizeKm?: number;
  pointRadiusKm?: number;
  /** Vertical exaggeration of the descent altitude on the globe (1 = true). */
  altitudeExaggeration?: number;
  revealS?: number;
}

const surf = (r: number, lon: number, lat: number, alt: number): THREE.Vector3 => {
  const [x, y, z] = lonLatToXYZ(lon, lat, r + alt);
  return new THREE.Vector3(x, y, z);
};

/** Capsule along a schematic great-circle approach, then touchdown points pop in and the landing ellipse draws. */
export function LandingPlayback({
  phases, result, site, maxSlopeDeg, ellipse, approachFromBearingDeg = APPROACH_FROM_BEARING_DEG, approachRangeKm = APPROACH_RANGE_KM,
  surfaceRadius, capsuleSizeKm = 25, pointRadiusKm = 0.5, altitudeExaggeration = 1, revealS = LANDING_REVEAL_S,
}: LandingPlaybackProps) {
  const endS = edlEndS(phases);
  const radiusAt = useMemo(() => surfaceRadius ?? (() => 1), [surfaceRadius]);
  const start = useMemo(() => destinationPoint(site, approachFromBearingDeg, approachRangeKm), [site, approachFromBearingDeg, approachRangeKm]);
  const { camera } = useThree();

  const arcPts = useMemo(() => {
    const n = 96;
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = greatCircleLerp(start, site, i / n);
      const v = surf(radiusAt(p.lon, p.lat), p.lon, p.lat, 0.0004 * altitudeExaggeration);
      return [v.x, v.y, v.z] as [number, number, number];
    });
  }, [start, site, radiusAt, altitudeExaggeration]);

  const capsule = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Line>(null);
  const trailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arcPts.length * 3), 3));
    return g;
  }, [arcPts.length]);

  const trailLine = useMemo(() => new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: ARC })), [trailGeo]);

  const points = useMemo(() => unpackTouchdowns(result.points, maxSlopeDeg), [result.points, maxSlopeDeg]);
  const inst = useRef<THREE.InstancedMesh>(null);
  const base = useMemo(() => points.map((p) => {
    const r = radiusAt(p.lon, p.lat);
    const pos = surf(r, p.lon, p.lat, 0.00015);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize());
    return { pos, q };
  }), [points, radiusAt]);

  useEffect(() => {
    const im = inst.current;
    if (!im) return;
    const c = new THREE.Color();
    points.forEach((p, i) => im.setColorAt(i, c.set(p.ok ? OK : FAIL)));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [points]);

  const ellipseLine = useMemo(() => {
    if (!ellipse) return null;
    return ellipsePoints(site, ellipse.semiMajorKm, ellipse.semiMinorKm, ellipse.azimuthDeg, 128).map((p) => {
      const v = surf(radiusAt(p.lon, p.lat), p.lon, p.lat, 0.0002);
      return [v.x, v.y, v.z] as [number, number, number];
    });
  }, [ellipse, site, radiusAt]);
  const ellRef = useRef<{ material: THREE.Material & { opacity: number } } | null>(null);

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), s: new THREE.Vector3(), o: new THREE.Object3D() }), []);
  const last = useRef({ t: -1, n: -1 });

  useFrame(() => {
    const t = usePlayback.getState().t;
    const f = approachFraction(Math.min(t, endS), endS);
    const p = greatCircleLerp(start, site, f);
    const alt = altitudeKmAt(phases, Math.min(t, endS)) ?? 0;
    const pos = surf(radiusAt(p.lon, p.lat), p.lon, p.lat, (alt / R_KM) * altitudeExaggeration);
    const cap = capsule.current;
    if (cap) {
      cap.position.copy(pos);
      const next = greatCircleLerp(start, site, Math.min(1, f + 0.01));
      const nv = surf(radiusAt(next.lon, next.lat), next.lon, next.lat, (alt / R_KM) * altitudeExaggeration);
      const up = pos.clone().normalize();
      const fwd = nv.sub(pos).normalize();
      if (fwd.lengthSq() > 0) cap.quaternion.setFromRotationMatrix(tmp.m.lookAt(new THREE.Vector3(), fwd, up));
      const dist = camera.position.length();
      cap.scale.setScalar(Math.max(capsuleSizeKm / R_KM, (dist - 1) * 0.012));
      cap.visible = t <= endS + revealS * 0.25;
    }
    // flown part of the arc
    const tl = trail.current;
    if (tl) {
      const n = Math.max(1, Math.floor(f * (arcPts.length - 1)));
      const a = trailGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= n; i++) a.setXYZ(i, ...arcPts[i]);
      trailGeo.setDrawRange(0, n + 1);
      a.needsUpdate = true;
    }
    // touchdown points
    const im = inst.current;
    const cnt = revealCount(t, endS, points.length, revealS);
    if (im && (last.current.t !== t || last.current.n !== cnt)) {
      const prog = revealProgress(t, endS, revealS);
      const sz = pointRadiusKm / R_KM;
      const popWindow = 0.06; // fraction of the reveal each point takes to pop in
      for (let i = 0; i < points.length; i++) {
        const born = i / points.length;
        const age = (prog - born) / popWindow;
        const sc = i < cnt || age > 0 ? popScale(age) : 0;
        tmp.o.position.copy(base[i].pos);
        tmp.o.quaternion.copy(base[i].q);
        tmp.o.scale.setScalar(Math.max(1e-9, sz * sc * Math.max(1, (camera.position.length() - 1) * 6)));
        tmp.o.updateMatrix();
        im.setMatrixAt(i, tmp.o.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      last.current = { t, n: cnt };
    }
    if (ellRef.current) ellRef.current.material.opacity = Math.min(1, revealProgress(t, endS, revealS) * 4) * 0.9;
  });

  return (
    <group>
      <Line points={arcPts} color={ARC} lineWidth={1} transparent opacity={0.3} dashed dashSize={0.004} gapSize={0.004} raycast={() => null} />
      <primitive object={trailLine} ref={trail} />
      <group ref={capsule}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.35, 0.8, 2, 8]} />
          <meshBasicMaterial color="#ece7e1" />
        </mesh>
        <mesh position={[0, 0, -0.8]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.5, 0.5, 8]} />
          <meshBasicMaterial color="#a39c95" />
        </mesh>
      </group>
      <instancedMesh ref={inst} args={[undefined, undefined, Math.max(1, points.length)]} frustumCulled={false} renderOrder={4}>
        <circleGeometry args={[1, 10]} />
        <meshBasicMaterial transparent side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </instancedMesh>
      {ellipseLine && <Line ref={ellRef as never} points={ellipseLine} color="#ece7e1" lineWidth={1.5} transparent opacity={0} raycast={() => null} />}
    </group>
  );
}

/** DOM caption for the current EDL phase: label, altitude and the cited source. Mount in the page overlay. */
export function LandingCaption({ phases, result, maxSlopeDeg }: { phases: EdlPhase[]; result?: LandingScenarioResult; maxSlopeDeg?: number }) {
  const t = usePlayback((s) => Math.floor(s.t));
  const endS = edlEndS(phases);
  const p = phaseAt(phases, t);
  const alt = altitudeKmAt(phases, Math.min(t, endS));
  const done = t >= endS && result;
  return (
    <div data-avoid data-caption style={{ position: 'absolute', left: 'calc((100% - var(--log-w, 0px)) / 2)', bottom: 'calc(var(--inset, 0px) + 44px)', transform: 'translateX(-50%)', textAlign: 'center', pointerEvents: 'auto', width: 'max-content', maxWidth: 'calc(100vw - var(--log-w, 0px) - 16px)' }}>
      {done ? (
        <div className={css.contour} style={{ fontSize: 13, padding: '6px 10px', whiteSpace: 'normal' }}>
          {Math.round(result.okFraction * 100)} % of {result.samples.toLocaleString('en-US')} simulated touchdowns land at or under {maxSlopeDeg ?? '?'} degrees
        </div>
      ) : p ? (
        <div className={css.contour} style={{ fontSize: 13, padding: '6px 10px', display: 'grid', gap: 2, whiteSpace: 'normal' }}>
          <span style={{ fontFamily: 'var(--font-sans, system-ui)', fontWeight: 600 }}>{p.label}</span>
          {alt != null && <span style={{ color: 'var(--text-2, #a39c95)' }}>{alt.toFixed(1)} km above the surface</span>}
          <a href={p.source.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-2, #a39c95)', fontFamily: 'var(--font-sans, system-ui)', fontSize: 11 }}>{p.source.title}</a>
        </div>
      ) : null}
    </div>
  );
}
