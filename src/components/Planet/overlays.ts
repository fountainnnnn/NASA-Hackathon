/**
 * Store state drawn on the Cesium planet: markers, landing ellipses, EDL arcs, touchdown scatter and the click ring.
 * All marks are thin and precise. Terrain heights come from the most detailed terrain tiles (sampled once per mark);
 * marks sit a small lift above that, and the lift follows camera range so a coarser rendered tile never hides them.
 */
import type * as CesiumNS from 'cesium';
import { ellipsePoints, greatCircleKm, greatCirclePath } from '../Globe/geo';
import { useGlobeStore, type GlobeArc, type GlobeEllipse, type GlobeMarker, type ScatterSet } from '../../state/globe';
import type { LabelHandle, LabelLayer } from './labels';
import {
  GO, KIND_COLOR, NODATA, NOGO, RING_VERTS, TONE_STYLE, arcApexM, liftBucket, liftForRangeM, ringRadiusM,
} from './planetMath';

type C = typeof CesiumNS;

export interface PlanetCtx {
  C: C;
  scene: CesiumNS.Scene;
  ellipsoid: CesiumNS.Ellipsoid;
  labels: LabelLayer;
  /** Ellipsoid heights (m) at the most detailed terrain level; falls back to the rendered height where tiles are missing. */
  sample(pts: { lon: number; lat: number }[]): Promise<number[]>;
  /** Rendered terrain height now (m); undefined where no tile is loaded yet. */
  groundHeight(lonRad: number, latRad: number): number | undefined;
  /** Camera distance to the look-at point (m). */
  rangeM(): number;
  onFrame(cb: () => void): () => void;
  /** Runs just before each render, so camera and objects move together. */
  onPreRender(cb: () => void): () => void;
  /** Stop any camera flight (a simulation takes the camera). */
  cancelFlight(): void;
  /** A simulation owns the camera: no Jezero hand-off while true. */
  setSimActive(on: boolean): void;
  /** Phase caption drawn in the view; null clears it. `loading` draws it above the veil (terrain still loading). */
  caption(c: { title: string; detail: string; loading?: boolean } | null): void;
  /** Opaque veil over the view (1 = black), used while a simulation waits for its terrain. */
  veil(opacity: number): void;
}

/** A mark whose vertices follow terrain and re-lift when camera range changes. */
export interface Mark { refresh(liftM: number): void; destroy(): void }

const css = (C: C, hex: string, a = 1) => C.Color.fromCssColorString(hex).withAlpha(a);

/** Positions of a closed ring of lon/lat degrees at sampled heights + lift. */
function liftPositions(C: C, ellipsoid: CesiumNS.Ellipsoid, ll: { lon: number; lat: number }[], h: number[], lift: number): CesiumNS.Cartesian3[] {
  return ll.map((p, i) => C.Cartesian3.fromDegrees(p.lon, p.lat, (h[i] ?? 0) + lift, ellipsoid));
}

export class Overlays {
  private lines: CesiumNS.PolylineCollection;
  private points: CesiumNS.PointPrimitiveCollection;
  /** The landing simulation's own lines and points, kept apart so the store's marks can be quieted without touching them. */
  private simLines: CesiumNS.PolylineCollection;
  private simPoints: CesiumNS.PointPrimitiveCollection;
  private marks = new Map<string, { mark: Mark; sig: string }>();
  private bucket = -1;
  private lift = 4;
  private unsubs: (() => void)[] = [];
  private ringMark: { sig: string; mark: Mark } | null = null;
  private disposed = false;

  constructor(private ctx: PlanetCtx) {
    const { C, scene } = ctx;
    this.lines = scene.primitives.add(new C.PolylineCollection());
    this.points = scene.primitives.add(new C.PointPrimitiveCollection());
    this.simLines = scene.primitives.add(new C.PolylineCollection());
    this.simPoints = scene.primitives.add(new C.PointPrimitiveCollection());
    this.unsubs.push(useGlobeStore.subscribe(() => this.sync()));
    this.unsubs.push(ctx.onFrame(() => this.tick()));
    this.sync();
  }

  /** Collections for the landing playback (drawn after the store's marks). */
  get polylines() { return this.simLines; }
  get pointPrimitives() { return this.simPoints; }

  /**
   * Hide the store's marks (landing-check ellipse, scatter, click ring, their labels) while a simulation camera is down
   * among them: seen from 100 m up, a 7 km ellipse is a hard bright line across the horizon.
   */
  setQuiet(on: boolean) {
    if (this.lines.show === !on) return;
    this.lines.show = !on; this.points.show = !on; this.ctx.labels.muted = on;
  }

  dispose() {
    this.disposed = true;
    this.unsubs.forEach((u) => u());
    for (const { mark } of this.marks.values()) mark.destroy();
    this.marks.clear(); this.ringMark?.mark.destroy();
    this.ctx.scene.primitives.remove(this.lines); this.ctx.scene.primitives.remove(this.points);
    this.ctx.scene.primitives.remove(this.simLines); this.ctx.scene.primitives.remove(this.simPoints);
  }

  private tick() {
    const b = liftBucket(this.ctx.rangeM());
    if (b === this.bucket) return;
    this.bucket = b;
    this.lift = liftForRangeM(this.ctx.rangeM());
    for (const { mark } of this.marks.values()) mark.refresh(this.lift);
    this.ringMark?.mark.refresh(this.lift);
  }

  /** Diff the store against live marks. */
  private sync() {
    if (this.disposed) return;
    const s = useGlobeStore.getState();
    const want = new Map<string, { sig: string; make: () => Mark }>();
    for (const m of s.markers) want.set(`m:${m.id}`, { sig: `${m.lon},${m.lat},${m.label},${m.kind}`, make: () => this.marker(m) });
    for (const e of s.ellipses) want.set(`e:${e.id}`, { sig: JSON.stringify(e), make: () => this.ellipse(e) });
    for (const a of s.arcs) want.set(`a:${a.id}`, { sig: JSON.stringify(a), make: () => this.arc(a) });
    for (const r of s.scatterShown) {
      const set = s.scatter[r.scenarioId];
      if (set) want.set(`s:${r.id}`, { sig: `${r.scenarioId}:${set.points.length}:${set.maxSlopeDeg}:${set.points[0]}`, make: () => this.scatter(set) });
    }
    for (const [k, v] of this.marks) {
      const w = want.get(k);
      if (!w || w.sig !== v.sig) { v.mark.destroy(); this.marks.delete(k); }
    }
    for (const [k, w] of want) if (!this.marks.has(k)) this.marks.set(k, { sig: w.sig, mark: w.make() });
    // click ring
    const c = s.clicked;
    const sig = c ? `${c.lon},${c.lat},${c.seq}` : '';
    if ((this.ringMark?.sig ?? '') !== sig) {
      this.ringMark?.mark.destroy(); this.ringMark = null;
      if (c) this.ringMark = { sig, mark: this.ring(c.lon, c.lat) };
    }
  }

  /* ------------------------------------------------------------ marks */

  private marker(m: GlobeMarker): Mark {
    const ctx = this.ctx, C = ctx.C;
    const color = KIND_COLOR[m.kind];
    const pt = this.points.add({
      position: C.Cartesian3.ZERO, pixelSize: m.kind === 'click' ? 5 : 6, color: css(C, color), outlineColor: css(C, '#0d0b0b', 0.9), outlineWidth: 1.5,
      show: false, disableDepthTestDistance: 4e4,
    });
    // the pointer readout already says where a click is, so a click marker carries no label
    const label: LabelHandle | null = m.kind === 'click' ? null : ctx.labels.add(m.label, color, { prio: m.kind === 'landing' ? 5 : 3 });
    let h = 0, ready = false, dead = false;
    void ctx.sample([m]).then(([hh]) => { if (dead) return; h = hh; ready = true; refresh(this.lift); });
    const refresh = (lift: number) => {
      if (!ready) return;
      const p = C.Cartesian3.fromDegrees(m.lon, m.lat, h + lift, ctx.ellipsoid);
      pt.position = p; pt.show = true; label?.setWorld(p);
    };
    return { refresh, destroy: () => { dead = true; this.points.remove(pt); label?.remove(); } };
  }

  private ellipse(e: GlobeEllipse): Mark {
    const ctx = this.ctx, C = ctx.C;
    const st = TONE_STYLE[e.tone];
    const ll = ellipsePoints(e, e.semiMajorKm, e.semiMinorKm, e.azimuthDeg, 128);
    const mat = st.dashed
      ? C.Material.fromType('PolylineDash', { color: css(C, st.color), gapColor: css(C, st.color, 0), dashLength: 14 })
      : C.Material.fromType('Color', { color: css(C, st.color) });
    const line = this.lines.add({ positions: [], width: 1.6, material: mat, show: false });
    const ticks: CesiumNS.Polyline[] = [];
    if (st.hatched) for (let i = 0; i < ll.length - 1; i += 2) ticks.push(this.lines.add({ positions: [], width: 1.2, material: C.Material.fromType('Color', { color: css(C, st.color) }), show: false }));
    const label = ctx.labels.add(e.label, st.color, { prio: 4, dy: 22 });
    let h: number[] = [], hc = 0, ready = false, dead = false;
    void ctx.sample([...ll, { lon: e.lon, lat: e.lat }]).then((hh) => { if (dead) return; hc = hh.pop() ?? 0; h = hh; ready = true; refresh(this.lift); });
    const refresh = (lift: number) => {
      if (!ready) return;
      const pos = liftPositions(C, ctx.ellipsoid, ll, h, lift);
      line.positions = pos; line.show = true;
      const c = C.Cartesian3.fromDegrees(e.lon, e.lat, hc + lift, ctx.ellipsoid);
      ticks.forEach((t, k) => { const a = pos[k * 2]; t.positions = [a, C.Cartesian3.lerp(a, c, 0.12, new C.Cartesian3())]; t.show = true; });
      label.setWorld(c);
    };
    return { refresh, destroy: () => { dead = true; this.lines.remove(line); ticks.forEach((t) => this.lines.remove(t)); label.remove(); } };
  }

  /** EDL approach track: dashed 3D polyline climbing to an apex above the great-circle ground track. */
  private arc(a: GlobeArc): Mark {
    const ctx = this.ctx, C = ctx.C;
    const n = 72, path = greatCirclePath(a.from, a.to, n), km = greatCircleKm(a.from, a.to), apex = arcApexM(km);
    const line = this.lines.add({
      positions: [], width: 1.5, show: false,
      material: C.Material.fromType('PolylineDash', { color: css(C, '#a39c95'), gapColor: css(C, '#a39c95', 0), dashLength: 12 }),
    });
    const label = ctx.labels.add(a.label, '#a39c95', { prio: 2 });
    let h0 = 0, h1 = 0, ready = false, dead = false;
    void ctx.sample([a.from, a.to]).then(([x, y]) => { if (dead) return; h0 = x; h1 = y; ready = true; refresh(this.lift); });
    const refresh = (lift: number) => {
      if (!ready) return;
      const pos = path.map((p, i) => { const t = i / n; return C.Cartesian3.fromDegrees(p.lon, p.lat, h0 + (h1 - h0) * t + lift + apex * Math.sin(Math.PI * t), ctx.ellipsoid); });
      line.positions = pos; line.show = true; label.setWorld(pos[n >> 1]);
    };
    return { refresh, destroy: () => { dead = true; this.lines.remove(line); label.remove(); } };
  }

  /** Touchdown scatter: go / no-go points on the ground (grey = no data). */
  private scatter(set: ScatterSet): Mark {
    const ctx = this.ctx, C = ctx.C;
    const n = Math.floor(set.points.length / 3);
    const ll: { lon: number; lat: number }[] = [];
    for (let i = 0; i < n; i++) ll.push({ lon: set.points[i * 3], lat: set.points[i * 3 + 1] });
    const prims: CesiumNS.PointPrimitive[] = [];
    let h: number[] = [], ready = false, dead = false;
    void ctx.sample(ll).then((hh) => {
      if (dead) return;
      h = hh; ready = true;
      for (let i = 0; i < n; i++) {
        const slope = set.points[i * 3 + 2];
        const col = Number.isNaN(slope) ? NODATA : slope <= set.maxSlopeDeg ? GO : NOGO;
        prims.push(this.points.add({ position: C.Cartesian3.ZERO, pixelSize: 3.2, color: css(C, col, 0.92), show: false, disableDepthTestDistance: 2e4 }));
      }
      refresh(this.lift);
    });
    const refresh = (lift: number) => {
      if (!ready) return;
      for (let i = 0; i < prims.length; i++) { prims[i].position = C.Cartesian3.fromDegrees(ll[i].lon, ll[i].lat, h[i] + lift, ctx.ellipsoid); prims[i].show = true; }
    };
    return { refresh, destroy: () => { dead = true; prims.forEach((p) => this.points.remove(p)); } };
  }

  /** Click ring: a thin tangent circle on the ground whose size tracks camera range so it stays about 20 px wide. */
  private ring(lon: number, lat: number): Mark {
    const ctx = this.ctx, C = ctx.C;
    const line = this.lines.add({ positions: [], width: 1.5, material: C.Material.fromType('Color', { color: css(C, '#ece7e1') }), show: false });
    let hc = 0, ready = false, dead = false;
    void ctx.sample([{ lon, lat }]).then(([x]) => { if (dead) return; hc = x; ready = true; refresh(this.lift); });
    const enu = C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(lon, lat, 0, ctx.ellipsoid), ctx.ellipsoid);
    const refresh = (lift: number) => {
      if (!ready) return;
      const r = ringRadiusM(ctx.rangeM());
      const pos: CesiumNS.Cartesian3[] = [];
      const local = new C.Cartesian3(), world = new C.Cartesian3(), carto = new C.Cartographic();
      for (let i = 0; i <= RING_VERTS; i++) {
        const a = (i / RING_VERTS) * Math.PI * 2;
        C.Cartesian3.fromElements(Math.cos(a) * r, Math.sin(a) * r, 0, local);
        C.Matrix4.multiplyByPoint(enu, local, world);
        ctx.ellipsoid.cartesianToCartographic(world, carto);
        const gh = ctx.groundHeight(carto.longitude, carto.latitude) ?? hc;
        pos.push(C.Cartesian3.fromRadians(carto.longitude, carto.latitude, gh + lift, ctx.ellipsoid));
      }
      line.positions = pos; line.show = true;
    };
    return { refresh, destroy: () => { dead = true; this.lines.remove(line); } };
  }
}
