'use client';
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useGlobeStore, type GlobeArc, type GlobeEllipse, type GlobeMarker, type ScatterSet } from '../../state/globe';
import { globalDemVersion, reliefRadius, subscribeDem } from './dem';
import {
  ellipsePoints, greatCircleKm, greatCirclePath, JEZERO_BOUNDS, lonLatToXYZ, R_KM,
} from './geo';
import { useCam } from './globeCtx';

const LIFT = 0.0015;
// survey-reticle palette (docs/DESIGN_SYSTEM.md): bone marks, hue only when it means something
const KIND_COLOR: Record<GlobeMarker['kind'], string> = { click: '#ece7e1', site: '#a39c95', landing: '#5cc8ff', hazard: '#d9423b' };
const TONE_COLOR: Record<GlobeEllipse['tone'], string> = { ok: '#58c98a', warn: '#f3d250', bad: '#d9423b' };
const pathLen = (p: THREE.Vector3[]) => p.reduce((a, v, i) => (i ? a + v.distanceTo(p[i - 1]) : 0), 0);
const ARC_COLOR = '#a39c95';
const OUTLINE_COLOR = '#ece7e1';

const useDemVersion = () => useSyncExternalStore(subscribeDem, globalDemVersion, () => 0);
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
/** Point faces the camera (horizon test; terrain occlusion is ignored). */
const facing = (p: THREE.Vector3, cam: THREE.Vector3) => cam.dot(p) > p.lengthSq();

const labelStyle = (color: string): React.CSSProperties => ({
  transform: 'translate(14px, -9px)', whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
  font: '400 11px/1.2 var(--font-mono, "Martian Mono", ui-monospace, monospace)', fontVariantNumeric: 'tabular-nums', color: '#ece7e1',
  background: '#0d0b0b', border: '1px solid rgba(236,231,225,0.10)', borderLeft: `2px solid ${color}`, borderRadius: 2, padding: '2px 6px',
  transition: 'opacity 90ms linear',
});

/** Every globe label registers here so one pass can keep them from landing on each other or on the HUD. */
const registry = new Set<{ el: HTMLDivElement; prio: number }>();

/** Greedy screen-space declutter: higher priority first, a label that would overlap one already placed (or a HUD block) is hidden. */
function declutter() {
  const hud: DOMRect[] = [];
  document.querySelectorAll('[data-avoid], [data-companion]').forEach((n) => hud.push(n.getBoundingClientRect()));
  const hit = (a: DOMRect, b: DOMRect) => a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 3 && a.bottom > b.top - 3;
  const placed: DOMRect[] = [];
  for (const l of [...registry].sort((a, b) => b.prio - a.prio)) {
    const faded = l.el.style.opacity === '0';
    if (faded) continue;
    l.el.style.visibility = 'visible';
    const r = l.el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (placed.some((p) => hit(p, r)) || hud.some((h) => hit(h, r))) l.el.style.visibility = 'hidden';
    else placed.push(r);
  }
}

/** Label that hides itself behind the planet limb. `world` is the anchor in scene units; it sits to the right of the anchor so the click ring and Scout (up and left) stay clear. */
function Label({ world, text, color, dy = 0, prio = 1 }: { world: THREE.Vector3; text: string; color: string; dy?: number; prio?: number }) {
  const div = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = div.current; if (!el) return;
    const rec = { el, prio }; registry.add(rec);
    return () => { registry.delete(rec); };
  }, [prio]);
  useFrame(({ camera }) => { if (div.current) div.current.style.opacity = facing(world, camera.position) ? '1' : '0'; });
  return (
    <Html position={world} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={div} data-gl-label style={{ ...labelStyle(color), transform: `translate(14px, ${-9 + dy}px)` }}>{text}</div>
    </Html>
  );
}

/** Runs the declutter a few times a second. */
function Declutter() {
  const n = useRef(0);
  useFrame(() => { if (n.current++ % 2 === 0) declutter(); });
  return null;
}

/** 1 px reticle: ring with a clear centre and four ticks, lying in the tangent plane, constant screen size. */
const RETICLE = (() => {
  const v: number[] = [], n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    v.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0);
  }
  for (let k = 0; k < 4; k++) { const c = Math.cos((k * Math.PI) / 2), s2 = Math.sin((k * Math.PI) / 2); v.push(c * 1.0, s2 * 1.0, 0, c * 1.7, s2 * 1.7, 0); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
})();

function Marker({ m, exag, demV }: { m: GlobeMarker; exag: number; demV: number }) {
  const pos = useMemo(() => v3(lonLatToXYZ(m.lon, m.lat, reliefRadius(m.lon, m.lat, exag) + LIFT)), [m.lon, m.lat, exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), pos.clone().normalize()), [pos]);
  const g = useRef<THREE.Group>(null);
  const color = KIND_COLOR[m.kind];
  useFrame(({ camera }) => {
    if (!g.current) return;
    g.current.visible = facing(pos, camera.position);
    g.current.scale.setScalar(camera.position.distanceTo(pos) * 0.007);
  });
  return (
    <>
      <group ref={g} position={pos} quaternion={quat}>
        <lineSegments geometry={RETICLE} renderOrder={20}><lineBasicMaterial color={color} depthTest={false} /></lineSegments>
      </group>
      {/* the pointer readout already says where this is, so the click ring carries no label */}
      {m.kind !== 'click' && <Label world={pos} text={m.label} color={color} prio={m.kind === 'landing' ? 5 : 3} />}
    </>
  );
}

/** Tone is also a line style so it survives glare and colour deficiency: ok solid, warn dashed, bad hatched. */
function EllipseLine({ e, exag, demV }: { e: GlobeEllipse; exag: number; demV: number }) {
  const { pts, hatch } = useMemo(() => {
    const ll = ellipsePoints(e, e.semiMajorKm, e.semiMinorKm, e.azimuthDeg, 128);
    const out = ll.map((p) => v3(lonLatToXYZ(p.lon, p.lat, reliefRadius(p.lon, p.lat, exag) + LIFT)));
    const c = v3(lonLatToXYZ(e.lon, e.lat, reliefRadius(e.lon, e.lat, exag) + LIFT));
    // hatch: short ticks from every 2nd vertex toward the centre (10% of the radius), tangent to the surface
    const ticks: number[] = [];
    if (e.tone === 'bad') for (let i = 0; i < out.length - 1; i += 2) { const a = out[i], b = a.clone().lerp(c, 0.12); ticks.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    return { pts: out, hatch: g };
  }, [e, exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  const center = useMemo(() => v3(lonLatToXYZ(e.lon, e.lat, reliefRadius(e.lon, e.lat, exag) + LIFT)), [e.lon, e.lat, exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = TONE_COLOR[e.tone];
  return (
    <>
      <Line points={pts} color={color} lineWidth={1.5} dashed={e.tone === 'warn'} dashSize={pathLen(pts) / 48} gapSize={pathLen(pts) / 96} />
      {e.tone === 'bad' && <lineSegments geometry={hatch}><lineBasicMaterial color={color} /></lineSegments>}
      <Label world={center} text={e.label} color={color} dy={22} prio={4} />
    </>
  );
}

function ArcLine({ a, exag, demV }: { a: GlobeArc; exag: number; demV: number }) {
  const { pts, apex } = useMemo(() => {
    const n = 72, path = greatCirclePath(a.from, a.to, n);
    const km = greatCircleKm(a.from, a.to);
    const peak = 0.01 + 0.15 * (km / R_KM);
    const r0 = reliefRadius(a.from.lon, a.from.lat, exag), r1 = reliefRadius(a.to.lon, a.to.lat, exag);
    const out = path.map((p, i) => { const t = i / n; return v3(lonLatToXYZ(p.lon, p.lat, r0 + (r1 - r0) * t + LIFT + peak * Math.sin(Math.PI * t))); });
    return { pts: out, apex: out[n >> 1] };
  }, [a, exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Line points={pts} color={ARC_COLOR} lineWidth={1.5} dashed dashSize={pathLen(pts) / 60} gapSize={pathLen(pts) / 120} />
      <Label world={apex} text={a.label} color={ARC_COLOR} prio={2} />
    </>
  );
}

function Scatter({ set, exag, demV }: { set: ScatterSet; exag: number; demV: number }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const geo = useMemo(() => {
    const n = Math.floor(set.points.length / 3);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const lon = set.points[i * 3], lat = set.points[i * 3 + 1], slope = set.points[i * 3 + 2];
      const p = lonLatToXYZ(lon, lat, reliefRadius(lon, lat, exag) + LIFT * 0.6);
      pos.set(p, i * 3);
      const c = Number.isNaN(slope) ? [0.42, 0.39, 0.37] : slope <= set.maxSlopeDeg ? [0.36, 0.78, 1.0] : [0.85, 0.26, 0.23];
      col.set(c, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }, [set, exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  return <points geometry={geo} frustumCulled={false} renderOrder={10}><pointsMaterial size={2 * dpr} sizeAttenuation={false} vertexColors transparent opacity={0.9} depthWrite={false} /></points>;
}

/** Outline of the 20 m Jezero coverage; fades in below ~3,000 km. */
function JezeroOutline({ exag, demV }: { exag: number; demV: number }) {
  const cam = useCam();
  const lineRef = useRef<{ material: THREE.Material & { opacity: number } } | null>(null);
  const label = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = label.current; if (!el) return;
    const rec = { el, prio: 0 }; registry.add(rec);
    return () => { registry.delete(rec); };
  }, []);
  const { pts, top } = useMemo(() => {
    const { lonMin, lonMax, latMin, latMax } = JEZERO_BOUNDS, seg = 24, ring: [number, number][] = [];
    for (let i = 0; i < seg; i++) ring.push([lonMin + ((lonMax - lonMin) * i) / seg, latMin]);
    for (let i = 0; i < seg; i++) ring.push([lonMax, latMin + ((latMax - latMin) * i) / seg]);
    for (let i = 0; i < seg; i++) ring.push([lonMax - ((lonMax - lonMin) * i) / seg, latMax]);
    for (let i = 0; i < seg; i++) ring.push([lonMin, latMax - ((latMax - latMin) * i) / seg]);
    ring.push(ring[0]);
    const out = ring.map(([lo, la]) => v3(lonLatToXYZ(lo, la, reliefRadius(lo, la, exag) + LIFT)));
    return { pts: out, top: v3(lonLatToXYZ((lonMin + lonMax) / 2, latMax, reliefRadius((lonMin + lonMax) / 2, latMax, exag) + LIFT)) };
  }, [exag, demV]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ camera }) => {
    const a = cam.current.altKm;
    const o = THREE.MathUtils.clamp((3000 - a) / 1500, 0, 1) * 0.55;       // fade in 3000 → 1500 km
    if (lineRef.current) { lineRef.current.material.transparent = true; lineRef.current.material.opacity = o; }
    if (label.current) label.current.style.opacity = String(a < 1100 && facing(top, camera.position) ? 1 : 0);
  });
  return (
    <>
      <Line ref={lineRef as never} points={pts} color={OUTLINE_COLOR} lineWidth={1} transparent opacity={0} />
      <Html position={top} center zIndexRange={[25, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={label} style={{ ...labelStyle(OUTLINE_COLOR), transform: 'translateY(-12px)', opacity: 0 }}>Jezero 20 m terrain</div>
      </Html>
    </>
  );
}

export function Overlays() {
  const markers = useGlobeStore((s) => s.markers);
  const ellipses = useGlobeStore((s) => s.ellipses);
  const arcs = useGlobeStore((s) => s.arcs);
  const shown = useGlobeStore((s) => s.scatterShown);
  const scatter = useGlobeStore((s) => s.scatter);
  const exag = useGlobeStore((s) => s.exaggeration);
  const demV = useDemVersion();
  return (
    <group>
      <Declutter />
      <JezeroOutline exag={exag} demV={demV} />
      {ellipses.map((e) => <EllipseLine key={e.id} e={e} exag={exag} demV={demV} />)}
      {arcs.map((a) => <ArcLine key={a.id} a={a} exag={exag} demV={demV} />)}
      {shown.map((r) => (scatter[r.scenarioId] ? <Scatter key={r.id} set={scatter[r.scenarioId]} exag={exag} demV={demV} /> : null))}
      {markers.map((m) => <Marker key={m.id} m={m} exag={exag} demV={demV} />)}
    </group>
  );
}
