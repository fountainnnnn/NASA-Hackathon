'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  JEZERO_CENTER, JEZERO_ENTER_ALT_KM, MAX_ALT_KM, MIN_ALT_KM, useGlobeStore, type GlobeFlight,
} from '../../state/globe';
import { sampleElevationM } from './dem';
import { centralAngle, greatCircleLerp, lonLatToXYZ, pickRay, R_KM, wrapLon } from './geo';
import { useCam } from './globeCtx';

const FLY_SECONDS = 1.2;
const HANDOFF_FADE_S = 0.35;
const MAX_LAT = 89.5;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Flight { from: { lon: number; lat: number; alt: number }; to: GlobeFlight; t: number; angle: number }

/**
 * Orbit-style controller in lon/lat/altitude space: drag rotates the planet under the cursor (with inertia),
 * wheel / pinch zooms exponentially between MIN_ALT_KM and MAX_ALT_KM, double-click flies in, store.flight flies
 * anywhere in ≤1.2 s. Also owns hover/click picking and the Jezero hand-off.
 */
export function GlobeCameraRig({ fadeRef, reticleRef }: { fadeRef: React.RefObject<HTMLDivElement | null>; reticleRef: React.RefObject<HTMLDivElement | null> }) {
  const { gl, camera } = useThree();
  const cam = useCam();
  const target = useRef({ lon: useGlobeStore.getState().view.lon, lat: useGlobeStore.getState().view.lat, alt: useGlobeStore.getState().view.altitudeKm });
  const vel = useRef({ lon: 0, lat: 0 });
  const flight = useRef<Flight | null>(null);
  const handoff = useRef<{ t: number } | null>(null);
  const seenSeq = useRef(useGlobeStore.getState().flight?.seq ?? 0);
  const radius = useRef(1 + target.current.alt / R_KM);
  const lastView = useRef(0);
  const lastHover = useRef(0);
  const ray = useRef(new THREE.Raycaster());

  const setFade = (v: number) => { const el = fadeRef.current; if (el) el.style.opacity = String(v); };

  const startHandoff = () => { if (!handoff.current) handoff.current = { t: 0 }; };
  const cancelMotion = () => {
    flight.current = null; vel.current.lon = vel.current.lat = 0;
    if (handoff.current) { handoff.current = null; setFade(0); }
  };

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = 'none';
    const pts = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: boolean } | null = null;
    let last = { x: 0, y: 0, t: 0 };
    let pinch = 0;

    const kPerPx = () => {
      // degrees of surface rotation per screen pixel at the sub-camera point
      const fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
      const d = Math.max(cam.current.dist - 1, 0.02);
      const worldPerPx = (2 * Math.tan(fov / 2) * Math.max(d, 0.02)) / el.clientHeight;
      return Math.min(worldPerPx * 180 / Math.PI, 0.5);
    };

    const pickAt = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.current.setFromCamera(ndc, camera);
      const o = ray.current.ray.origin, d = ray.current.ray.direction;
      const exag = useGlobeStore.getState().exaggeration;
      const hit = pickRay([o.x, o.y, o.z], [d.x, d.y, d.z], (lon, lat) => 1 + ((sampleElevationM(lon, lat) ?? 0) * exag) / (R_KM * 1000));
      return hit ? { lon: hit.lon, lat: hit.lat } : null;
    };

    const onDown = (e: PointerEvent) => {
      if (useGlobeStore.getState().mode !== 'globe') return;
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cancelMotion();
      if (pts.size === 1) { down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; last = { x: e.clientX, y: e.clientY, t: performance.now() }; }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); down = null; }
    };
    const onMove = (e: PointerEvent) => {
      if (useGlobeStore.getState().mode !== 'globe') return;
      const p = pts.get(e.pointerId);
      if (p) {
        p.x = e.clientX; p.y = e.clientY;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0 && dist > 0) target.current.alt = clamp(target.current.alt * (pinch / dist), MIN_ALT_KM, MAX_ALT_KM);
          pinch = dist; return;
        }
        if (down) {
          if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
          if (down.moved) {
            const now = performance.now(), dt = Math.max((now - last.t) / 1000, 0.004);
            const k = kPerPx(), cl = Math.max(Math.cos(target.current.lat * Math.PI / 180), 0.15);
            const dLon = (-(e.clientX - last.x) * k) / cl, dLat = (e.clientY - last.y) * k;
            target.current.lon = wrapLon(target.current.lon + dLon);
            target.current.lat = clamp(target.current.lat + dLat, -MAX_LAT, MAX_LAT);
            vel.current.lon = vel.current.lon * 0.5 + (dLon / dt) * 0.5; vel.current.lat = vel.current.lat * 0.5 + (dLat / dt) * 0.5;
            last = { x: e.clientX, y: e.clientY, t: now };
          }
        }
        return;
      }
      const now = performance.now();               // hover (no buttons): throttled to ~30 Hz
      if (now - lastHover.current < 33) return;
      lastHover.current = now;
      useGlobeStore.getState().setHovered(pickAt(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      if (useGlobeStore.getState().mode !== 'globe') return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      const d = down; down = null;
      if (d && !d.moved && performance.now() - d.t < 500) {
        vel.current.lon = vel.current.lat = 0;
        const hit = pickAt(e.clientX, e.clientY);
        if (hit) emitPick(hit.lon, hit.lat, 'click');
      } else if (performance.now() - last.t > 80) { vel.current.lon = vel.current.lat = 0; }
    };
    const onLeave = () => useGlobeStore.getState().setHovered(null);
    const onWheel = (e: WheelEvent) => {
      if (useGlobeStore.getState().mode !== 'globe') return;
      e.preventDefault();
      cancelMotion();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      target.current.alt = clamp(target.current.alt * Math.exp(clamp(dy, -400, 400) * 0.0016), MIN_ALT_KM, MAX_ALT_KM);
    };
    const onDbl = (e: MouseEvent) => {
      if (useGlobeStore.getState().mode !== 'globe') return;
      const hit = pickAt(e.clientX, e.clientY);
      if (!hit) return;
      emitPick(hit.lon, hit.lat, 'dblclick');
      useGlobeStore.getState().flyTo(hit.lon, hit.lat, Math.max(MIN_ALT_KM, cam.current.altKm * 0.35));
    };
    const emitPick = (lon: number, lat: number, kind: 'click' | 'dblclick') =>
      useGlobeStore.getState().pick({ lon, lat, elevationM: sampleElevationM(lon, lat), kind, altitudeKm: cam.current.altKm, at: Date.now() });

    el.addEventListener('pointerdown', onDown); el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp); el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false }); el.addEventListener('dblclick', onDbl);
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel); el.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const st = useGlobeStore.getState();
    const T = target.current;

    // new flight request
    if (st.flight && st.flight.seq !== seenSeq.current) {
      seenSeq.current = st.flight.seq;
      if (st.mode === 'globe') {
        const from = { lon: T.lon, lat: T.lat, alt: T.alt };
        const angle = centralAngle(from, st.flight);
        flight.current = { from, to: st.flight, t: 0, angle };
        vel.current.lon = vel.current.lat = 0;
      }
    }

    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + dt / FLY_SECONDS);
      const e = easeInOut(f.t);
      const p = greatCircleLerp(f.from, f.to, e);
      // altitude: log-interpolate, with a swoop up for long hops
      const swoop = 1 + Math.min(f.angle / Math.PI, 1) * 1.4 * Math.sin(Math.PI * e);
      T.lon = p.lon; T.lat = clamp(p.lat, -MAX_LAT, MAX_LAT);
      T.alt = clamp(Math.exp(Math.log(f.from.alt) * (1 - e) + Math.log(f.to.altitudeKm) * e) * swoop, MIN_ALT_KM, MAX_ALT_KM);
      if (f.to.enterJezero && e > 0.72) startHandoff();
      if (f.t >= 1) {
        flight.current = null;
        if (f.to.enterJezero) startHandoff();
      }
    } else {
      // inertia
      if (Math.abs(vel.current.lon) + Math.abs(vel.current.lat) > 0.01) {
        T.lon = wrapLon(T.lon + vel.current.lon * dt);
        T.lat = clamp(T.lat + vel.current.lat * dt, -MAX_LAT, MAX_LAT);
        const decay = Math.exp(-dt * 4.5);
        vel.current.lon *= decay; vel.current.lat *= decay;
      }
    }

    // zoom-in auto hand-off (user zoomed down onto Jezero)
    if (st.mode === 'globe' && !handoff.current && T.alt <= JEZERO_ENTER_ALT_KM + 5 &&
        centralAngle(T, JEZERO_CENTER) * R_KM < 140) startHandoff();

    if (handoff.current) {
      handoff.current.t += dt;
      const v = Math.min(1, handoff.current.t / HANDOFF_FADE_S);
      setFade(v);
      if (v >= 1 && st.mode === 'globe') { handoff.current = null; st.setMode('jezero'); }
    }

    // crosshair locked on the target (screen centre) for the whole Jezero fall
    if (reticleRef.current) reticleRef.current.style.opacity = (f?.to.enterJezero || handoff.current) && st.mode === 'globe' ? '1' : '0';

    // camera placement (radius follows the local surface relief, smoothed)
    const exag = st.exaggeration;
    const surf = 1 + ((sampleElevationM(T.lon, T.lat) ?? 0) * exag) / (R_KM * 1000);
    const wantR = surf + T.alt / R_KM;
    radius.current += (wantR - radius.current) * (1 - Math.exp(-dt * 12));
    const r = Math.max(radius.current, surf + MIN_ALT_KM / R_KM * 0.9);
    const [x, y, z] = lonLatToXYZ(T.lon, T.lat, r);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    const pc = camera as THREE.PerspectiveCamera;
    const altU = r - surf;
    pc.near = clamp(altU * 0.3, 0.0012, 1);
    pc.far = 300;
    pc.updateProjectionMatrix();
    cam.current.lon = T.lon; cam.current.lat = T.lat; cam.current.altKm = (r - surf) * R_KM; cam.current.dist = r;

    // publish view ≤ 10 Hz
    const now = performance.now();
    if (now - lastView.current > 100) {
      lastView.current = now;
      st.setView({ lon: T.lon, lat: T.lat, altitudeKm: Math.round(cam.current.altKm) });
    }
  });

  return null;
}
