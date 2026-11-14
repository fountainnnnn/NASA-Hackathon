'use client';
/**
 * Everything the orchestrator adds inside the Jezero canvas: Scout's projector, the drag-to-plan and shift-drag lasso
 * pointer tools, the live preview line, the route ruler, and the scenario actors (crew, rover, base camp, helmet camera).
 * Pointer tools use DOM listeners on the canvas element and the same heightfield ray march as the terrain picker.
 */
import { Line } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { LonLat } from '@/lib/contracts';
import { densify } from '@/lib/scene/drape';
import { marchRay, meshHeightAt } from '@/lib/scene/terrainGrid';
import { BaseCamp } from '@/components/Scenario/BaseCamp';
import { Crew } from '@/components/Scenario/Crew';
import { HelmetCamera } from '@/components/Scenario/HelmetHud';
import { RoverAssist } from '@/components/Scenario/RoverAssist';
import { RulerLine } from '@/components/Scenario/RulerLine';
import { useSceneGround } from '@/components/Scenario/sceneAdapter';
import { useWalkUi } from '@/components/Scenario/walkStore';
import { clickGuard, insideBounds } from '@/components/Scene/pick';
import { lineY, trueHeight, useScene } from '@/components/Scene/sceneCtx';
import type { SceneCtxValue } from '@/components/Scene/sceneCtx';
import { useHud } from '@/state/hud';
import type { Tone } from '@/state/hud';
import { useRuntime } from '@/state/services';
import { useWorld } from '@/state/world';
import { polygonAreaKm2 } from './demTools';
import { SceneProjector } from './projector';
import { useWalkTimeline } from './useWalk';

const TONE_COLOR: Record<Tone, string> = { go: '#58c98a', caution: '#f3d250', nogo: '#d9423b' };
const noRaycast = () => null;
const DRAG_PX = 6;

export interface JezeroLayerProps {
  /** Release after a drag: round-trip plan from `from` to `to`. */
  onPlan: (from: LonLat, to: LonLat) => void;
  /** Shift-drag lasso closed. Polygon is in lon/lat. */
  onLasso: (poly: LonLat[], areaKm2: number) => void;
  /** Debounced live preview request; resolves the line to draw. */
  preview: (from: LonLat, to: LonLat, at: { x: number; y: number }) => void;
  clearPreview: () => void;
}

/* ------------------------------------------------------------------ pointer tools */

function useGroundPicker() {
  const v = useScene();
  const { gl, camera } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  return useMemo(() => (cx: number, cy: number): LonLat | null => {
    const r = gl.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const t = marchRay(v.grid, useWorld.getState().exaggeration, ray.ray.origin, ray.ray.direction, camera.near, camera.far);
    if (t == null) return null;
    const p = ray.ray.at(t, new THREE.Vector3());
    return v.rt.geo.toLonLat(v.rt.meta, p.x, p.z);
  }, [v, gl, camera, ray, ndc]);
}

function PointerTools({ onPlan, onLasso, preview, clearPreview }: JezeroLayerProps) {
  const { gl } = useThree();
  const pick = useGroundPicker();
  const cb = useRef({ onPlan, onLasso, preview, clearPreview });
  useEffect(() => { cb.current = { onPlan, onLasso, preview, clearPreview }; }, [onPlan, onLasso, preview, clearPreview]);

  useEffect(() => {
    const el = gl.domElement;
    let mode: 'none' | 'plan' | 'lasso' = 'none';
    let start: LonLat | null = null, down = { x: 0, y: 0 }, moved = false;
    let poly: { x: number; y: number }[] = [];
    let lastPreview = 0, timer = 0, lastLasso = 0;
    const bounds = () => useWorld.getState().bounds;

    const snapToBase = (p: LonLat) => {
      const b = useWorld.getState().base;
      if (!b) return p;
      const dN = (p.lat - b.lat) * (Math.PI / 180) * 3_396_190;
      const dE = (p.lon - b.lon) * (Math.PI / 180) * 3_396_190 * Math.cos((b.lat * Math.PI) / 180);
      return Math.hypot(dN, dE) < 400 ? { lon: b.lon, lat: b.lat } : p;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      down = { x: e.clientX, y: e.clientY }; moved = false;
      if (e.shiftKey) { mode = 'lasso'; poly = [{ x: e.clientX, y: e.clientY }]; return; }
      const g = pick(e.clientX, e.clientY);
      if (g && insideBounds(bounds(), g.lon, g.lat)) { mode = 'plan'; start = snapToBase(g); } else mode = 'none';
    };
    const onMove = (e: PointerEvent) => {
      if (mode === 'none') return;
      if (!moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < DRAG_PX) return;
      if (!moved) { moved = true; useHud.getState().patch({ dragging: true }); }
      if (mode === 'plan' && start) {
        const g = pick(e.clientX, e.clientY);
        if (!g || !insideBounds(bounds(), g.lon, g.lat)) return;
        const at = { x: e.clientX, y: e.clientY };
        const fire = () => { lastPreview = performance.now(); cb.current.preview(start!, g, at); };
        window.clearTimeout(timer);
        const wait = Math.max(0, 80 - (performance.now() - lastPreview));
        timer = window.setTimeout(fire, wait);
      } else if (mode === 'lasso') {
        poly.push({ x: e.clientX, y: e.clientY });
        const now = performance.now();
        if (now - lastLasso > 50) {
          lastLasso = now;
          const ll = poly.filter((_, i) => i % Math.max(1, Math.floor(poly.length / 24)) === 0).map((q) => pick(q.x, q.y)).filter((q): q is LonLat => !!q);
          useHud.getState().patch({ lasso: poly.slice(), lassoLabel: ll.length > 2 ? `${polygonAreaKm2(ll).toFixed(2)} km2` : null });
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      window.clearTimeout(timer);
      const m = mode; mode = 'none';
      if (!moved) return;
      clickGuard.until = performance.now() + 400;
      useHud.getState().patch({ dragging: false });
      if (m === 'plan' && start) {
        const g = pick(e.clientX, e.clientY);
        cb.current.clearPreview();
        if (g && insideBounds(bounds(), g.lon, g.lat)) cb.current.onPlan(start, g);
      } else if (m === 'lasso') {
        const step = Math.max(1, Math.floor(poly.length / 32));
        const ll = poly.filter((_, i) => i % step === 0).map((q) => pick(q.x, q.y)).filter((q): q is LonLat => !!q);
        useHud.getState().patch({ lasso: null, lassoLabel: null });
        if (ll.length >= 3) cb.current.onLasso(ll, polygonAreaKm2(ll));
      }
      start = null;
    };
    const onCancel = () => { window.clearTimeout(timer); mode = 'none'; useHud.getState().patch({ dragging: false, lasso: null, lassoLabel: null }); cb.current.clearPreview(); };

    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, pick]);
  return null;
}

/* ------------------------------------------------------------------ preview line */

function drape(v: SceneCtxValue, pts: LonLat[], exag: number): [number, number, number][] {
  const meshH = (x: number, z: number) => meshHeightAt(v.grid, x, z, exag);
  return pts.map((p) => {
    const { x, z } = v.rt.geo.toLocal(v.rt.meta, p.lon, p.lat);
    return [x, lineY(v, x, z, trueHeight(v, p.lon, p.lat), exag, 3, meshH), z];
  });
}

function PreviewLine() {
  const v = useScene();
  const pv = useHud((s) => s.preview);
  const exag = useWorld((s) => s.exaggeration);
  const pts = useMemo(() => (pv && pv.points.length > 1 ? drape(v, densify(pv.points, 10).pts, exag) : null), [pv, v, exag]);
  if (!pv || !pts) return null;
  const c = TONE_COLOR[pv.tone];
  // go solid, caution dashed, no-go short hatch: style carries the meaning as well as colour
  const dash = pv.tone === 'go' ? {} : pv.tone === 'caution' ? { dashed: true, dashSize: 36, gapSize: 24 } : { dashed: true, dashSize: 7, gapSize: 7 };
  return (
    <group>
      <Line points={pts} color="#060505" lineWidth={4} transparent opacity={0.8} depthWrite={false} renderOrder={12} raycast={noRaycast} {...dash} />
      <Line points={pts} color={c} lineWidth={pv.tone === 'nogo' ? 3 : 2} transparent depthWrite={false} renderOrder={13} raycast={noRaycast} {...dash} />
    </group>
  );
}

/* ------------------------------------------------------------------ ruler + scenario actors */

function RouteRuler() {
  const ground = useSceneGround();
  const tl = useWalkTimeline();
  const visible = useWorld((s) => s.visibleRouteIds);
  if (!tl || !visible.includes(tl.routeId)) return null;
  // 100 m ticks and a 10 min long tick on short walks; thinned on long ones so the ruler stays legible
  const long = tl.distM > 6000;
  return <RulerLine timeline={tl} ground={ground} showLine={false} everyM={long ? 500 : 100} everyMin={tl.durationS < 1800 ? 10 : tl.durationS < 5400 ? 30 : 60} />;
}

function Actors() {
  const ground = useSceneGround();
  const tl = useWalkTimeline();
  const walkOn = useHud((s) => s.walkOn);
  const reachOn = useHud((s) => s.reachOn);
  const reach = useHud((s) => s.reach);
  const rover = useWalkUi((s) => s.roverFraction);
  const base = useWorld((s) => s.base);
  return (
    <>
      {walkOn && tl && <Crew timeline={tl} ground={ground} />}
      {walkOn && tl && rover > 0 && <RoverAssist timeline={tl} ground={ground} />}
      {walkOn && tl && <HelmetCamera timeline={tl} ground={ground} />}
      {reachOn && base && <BaseCamp centre={{ lon: base.lon, lat: base.lat }} ground={ground} reach={reach} />}
    </>
  );
}

export default function JezeroLayer(props: JezeroLayerProps) {
  const rt = useRuntime((s) => s.rt);
  if (!rt) return null;
  return (
    <>
      <SceneProjector />
      <PointerTools {...props} />
      <PreviewLine />
      <RouteRuler />
      <Actors />
    </>
  );
}
