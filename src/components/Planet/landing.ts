/**
 * Landing simulation on the Cesium planet. A 3D capsule enters, the parachute opens, the heat shield drops away, the back
 * shell and parachute are cut loose, the descent stage hovers and lowers the rover on three bridles, then flies off.
 * Everything rides the shared playback clock and sits on the real Mars Trek terrain. The vehicle is drawn
 * LANDING_DRAW_SCALE times true size (cords, offsets and dust in proportion; the legend says so). After touchdown the
 * camera pulls back over the ellipse and the SAME seeded Monte-Carlo touchdowns drop onto it, accelerating, with a live
 * counter ("Testing 10,000 landings"); at the end the rover is labelled, the dots settle and the landing verdict is emitted
 * (lib/scenario/outcome). Models are built by models/build.mjs into public/models.
 */
import type * as CesiumNS from 'cesium';
import { destinationPoint, ellipsePoints, greatCircleLerp } from '../Globe/geo';
import { APPROACH_FROM_BEARING_DEG, APPROACH_RANGE_KM, approachFraction, popScale, unpackTouchdowns } from '../Scenario/landing';
import { getScenario } from '../../lib/scenario/store';
import { LANDING_CAM_SCALE, LANDING_DRAW_SCALE, useDrawScale } from '../../lib/scenario/drawScale';
import { emitScenarioEnd } from '../../lib/scenario/outcome';
import {
  MC_END_S, MC_FALL_H_M, MC_FALL_S, MC_PUFF_S, MC_SETTLE_S, MC_START_S, MC_TEST_S, mcCounterParts, mcProgress, monteCarloSchedule,
} from '../../lib/scenario/playback';
import type { LandingScenarioResultWithRunning } from '../../lib/scenario/types';
import { landingVerdict, type VerdictTone } from '../../lib/scenario/verdict';
import { useHud } from '../../state/hud';
import { usePlayback } from '../../state/playback';
import { useGlobal } from '../../state/services';
import {
  ARC_HIDE_BELOW_M, GROUND_CAM_DIST_M, GROUND_CAM_EYE_M, STAGE_TOP_M, groundCamDistM, groundCamEyeM,
  chaseCamera, craneBlend, craneFraming, drawAltM, dust, events, groundCamActive, hangM, touchdownFraming, phaseCaption, pullBack, shellAltM, stageOf, vehicleAltM, DEPART_S,
} from './descent';
import mc from './mcCounter.module.css';
import type { Overlays, PlanetCtx } from './overlays';
import { GO, NODATA, NOGO, TERRAIN_DATUM_OFFSET_M, clamp, inJezero, landingViewpoint, liftBucket, liftForRangeM, smoothstep } from './planetMath';
import { currentSim, onSimChange, type LandingSimSpec } from './simBus';

const ARC = '#e0884a', BONE = '#ece7e1';
const MODELS = ['rover', 'lander', 'heatshield', 'backshell', 'parachute', 'dust'] as const;
type ModelName = (typeof MODELS)[number];
const TRACK_N = 120;
/** On-screen minimum size (px) of the capsule and the descent stage while they are far from the chase camera during entry. */
const MIN_PX = 26;
const D2R = Math.PI / 180;
/** Drawing scale of the vehicle and the camera-distance scale of the close-ups (lib/scenario/drawScale). */
const K = LANDING_DRAW_SCALE, CK = LANDING_CAM_SCALE;
const TONE_CSS: Record<VerdictTone, string> = { go: GO, caution: '#f3d250', nogo: NOGO };
const DUST = '#b49a84';
/** Pools for the falling streaks and the dust puffs of the Monte-Carlo playback (only the most recent touchdowns get them). */
const STREAKS = 96, PUFFS = 96;
/** Dot size (px) while the runs land, and after they settle so the terrain reads. */
const DOT_PX = 3.4, DOT_END_PX = 2.4;

interface Active { id: string; dispose(): void; refresh(lift: number): void; follow(on: boolean): void }

export class LandingLayer {
  private cur: Active | null = null;
  private unsubs: (() => void)[] = [];
  private bucket = -1;

  constructor(private ctx: PlanetCtx, private ov: Overlays) {
    this.unsubs.push(useHud.subscribe(() => this.sync()));
    this.unsubs.push(useGlobal.subscribe(() => this.sync()));
    this.unsubs.push(onSimChange(() => this.sync()));
    this.unsubs.push(ctx.onFrame(() => this.tick()));
    this.sync();
  }
  dispose() { this.unsubs.forEach((u) => u()); this.cur?.dispose(); this.cur = null; this.ctx.caption(null); }
  /** The user took the camera (drag, wheel): stop following. */
  releaseFollow() { this.cur?.follow(false); }

  private tick() {
    const b = liftBucket(this.ctx.rangeM());
    if (b !== this.bucket) { this.bucket = b; this.cur?.refresh(liftForRangeM(this.ctx.rangeM())); }
  }

  /** Spec from the API call, or from the HUD's landing record (the flow's path). */
  private spec(): LandingSimSpec | null {
    const sim = currentSim();
    if (sim) return sim;
    const landing = useHud.getState().landing;
    const phases = useGlobal.getState().gs?.edlPhases() ?? [];
    const rec = landing ? getScenario(landing.scenarioId) : undefined;
    if (!landing || !rec || !phases.length) return null;
    return { id: landing.scenarioId, site: landing.site, points: rec.result.points, maxSlopeDeg: landing.maxSlopeDeg, ellipse: landing.ellipse, phases, caption: false, scenarioId: landing.scenarioId };
  }

  private sync() {
    const s = this.spec();
    if ((this.cur?.id ?? '') === (s?.id ?? '')) return;
    this.cur?.dispose(); this.cur = null; this.ctx.caption(null);
    if (s) this.cur = this.build(s);
  }

  /** The stored Monte-Carlo result behind these touchdown points (same seeded draws), for exact counts and the verdict. */
  private fullResult(spec: LandingSimSpec): { result: LandingScenarioResultWithRunning; id: string } | null {
    const ids = [spec.scenarioId, useHud.getState().landing?.scenarioId].filter((x): x is string => !!x);
    for (const id of ids) {
      const rec = getScenario(id);
      if (rec && rec.result.points === spec.points) return { result: rec.result as LandingScenarioResultWithRunning, id };
    }
    return null;
  }

  private build(spec: LandingSimSpec): Active {
    const ctx = this.ctx, C = ctx.C, scene = ctx.scene, { site, maxSlopeDeg, ellipse, phases } = spec;
    const ev = events(phases), endS = ev.touchdown;
    const SK = new C.Cartesian3(K, K, K);
    useDrawScale.getState().set('landing', K);
    const start = destinationPoint(site, APPROACH_FROM_BEARING_DEG, APPROACH_RANGE_KM);
    const col = (hex: string, a = 1) => C.Color.fromCssColorString(hex).withAlpha(a);
    const wide = landingViewpoint(ellipse);
    let dead = false, lift = liftForRangeM(ctx.rangeM());
    // the shell hands a landing inside the 20 m coverage to the Jezero planner, so the camera is left alone there
    const following = !inJezero(site.lon, site.lat, 0.02);
    ctx.setSimActive(following);
    if (following) ctx.cancelFlight();

    /* ---- ground track: where the vehicle is over the ground at each time, with sampled terrain heights */
    const tt = (k: number) => (endS * k) / TRACK_N;
    const lonlat = (t: number) => greatCircleLerp(start, site, approachFraction(clamp(t, 0, endS), endS));
    const track = Array.from({ length: TRACK_N + 1 }, (_, k) => lonlat(tt(k)));
    let trackH: number[] = [];
    const fallbackH = (p: { lon: number; lat: number }) => ctx.groundHeight(C.Math.toRadians(p.lon), C.Math.toRadians(p.lat)) ?? TERRAIN_DATUM_OFFSET_M;
    const groundAt = (t: number): number => {
      if (!trackH.length) return fallbackH(lonlat(t));
      const f = (clamp(t, 0, endS) / endS) * TRACK_N, k = Math.min(TRACK_N - 1, Math.floor(f)), u = f - k;
      return trackH[k] + (trackH[k + 1] - trackH[k]) * u;
    };
    const cart = (p: { lon: number; lat: number }, h: number) => C.Cartesian3.fromDegrees(p.lon, p.lat, h, ctx.ellipsoid);

    /* ---- models */
    const models = new Map<ModelName, CesiumNS.Model>();
    const add = (n: ModelName) => {
      void C.Model.fromGltfAsync({
        url: `/models/${n}.glb`, modelMatrix: C.Matrix4.IDENTITY, show: false, allowPicking: false, shadows: C.ShadowMode.DISABLED,
        minimumPixelSize: n === 'parachute' || n === 'dust' ? 0 : MIN_PX,
      }).then((m) => {
        if (dead) { m.destroy(); return; }
        // matte hardware in the same low sun as the terrain, with enough ambient that the shaded side keeps its colour
        m.lightColor = new C.Cartesian3(2.2, 2.1, 2.0);
        m.imageBasedLighting.imageBasedLightingFactor = new C.Cartesian2(1, 1);
        scene.primitives.add(m); models.set(n, m);
      }).catch(() => { /* a missing model leaves the rest of the simulation running */ });
    };
    MODELS.forEach(add);

    /* ---- lines and points */
    const faint = this.ov.polylines.add({ positions: [], width: 1.2, show: false, material: C.Material.fromType('PolylineDash', { color: col(ARC, 0.5), gapColor: col(ARC, 0), dashLength: 12 }) });
    const cables = [0, 1, 2].map(() => this.ov.polylines.add({ positions: [], width: 1.2, show: false, material: C.Material.fromType('Color', { color: col('#cfcac2', 0.9) }) }));
    let trackPos: CesiumNS.Cartesian3[] = [];
    void ctx.sample(track).then((h) => { if (dead) return; trackH = h; place(); });

    const eLL = ellipse ? ellipsePoints(site, ellipse.semiMajorKm, ellipse.semiMinorKm, ellipse.azimuthDeg, 128) : [];
    const eLine = eLL.length ? this.ov.polylines.add({ positions: [], width: 1.6, show: false, material: C.Material.fromType('Color', { color: col(BONE, 0) }) }) : null;
    let eH: number[] = [];
    if (eLL.length) void ctx.sample(eLL).then((h) => { if (dead) return; eH = h; place(); });

    /* ---- Monte-Carlo playback: the SAME seeded touchdowns as the computed result (lib/scenario/playback) */
    const td = unpackTouchdowns(spec.points, maxSlopeDeg);
    const full = this.fullResult(spec);
    const res = full?.result;
    const sched = monteCarloSchedule({
      points: spec.points, samples: res?.samples ?? spec.samples ?? td.length, maxSlopeDeg,
      okFraction: res?.okFraction ?? spec.okFraction, nodataFraction: res?.nodataFraction ?? spec.nodataFraction,
      slopeP95: res?.slopeP95 ?? spec.slopeP95, running: res?.running ?? spec.running,
    });
    const finalStats = sched.statsAt(sched.samples);
    const verdict = landingVerdict({ okFraction: finalStats.okFraction, nodataFraction: finalStats.nodataFraction, demResM: res?.demResM ?? spec.demResM }, ellipse, maxSlopeDeg);
    // time (s after touchdown) at which kept point k lands
    const landAt = td.map((_, k) => MC_START_S + MC_TEST_S * sched.progressAt(sched.runOfKept(k)));
    const tdCol = td.map((p) => col(Number.isFinite(p.slope) ? (p.ok ? GO : NOGO) : NODATA, 1));
    const prims: CesiumNS.PointPrimitive[] = [];
    let tdH: number[] = [];
    let groundCart: CesiumNS.Cartesian3[] = [];
    const mcGround = () => { if (tdH.length) groundCart = td.map((p, i) => cart(p, tdH[i] + lift)); };
    void ctx.sample(td).then((h) => {
      if (dead) return;
      tdH = h; mcGround();
      td.forEach((_, i) => prims.push(this.ov.pointPrimitives.add({
        position: groundCart[i], pixelSize: 0, show: false, outlineColor: col('#0d0b0b', 0.6), outlineWidth: 0.5,
        color: tdCol[i], disableDepthTestDistance: 2e4,
      })));
    });
    const streaks = Array.from({ length: STREAKS }, () => this.ov.polylines.add({ positions: [], width: 1.5, show: false, material: C.Material.fromType('Color', { color: col(BONE, 0.75) }) }));
    const puffs = Array.from({ length: PUFFS }, () => this.ov.pointPrimitives.add({ position: C.Cartesian3.ZERO, pixelSize: 0, show: false, color: col(DUST, 0), disableDepthTestDistance: 2e4 }));
    // the hero rover in the wide view: a bone ring at the touchdown point and a label once the testing is done
    const roverRing: CesiumNS.PointPrimitive = this.ov.pointPrimitives.add({ position: C.Cartesian3.ZERO, pixelSize: 14, show: false, color: col(BONE, 0), outlineColor: col(BONE, 0.95), outlineWidth: 1.5, disableDepthTestDistance: 2e4 });
    let roverTag: { remove(): void; setWorld(p: CesiumNS.Cartesian3): void } | null = null;
    // the live counter, in the stage (mono): run, share within the slope limit, p95 slope, running verdict
    const host = (ctx.scene.canvas.parentElement?.parentElement ?? ctx.scene.canvas.parentElement) as HTMLElement;
    const counter = document.createElement('div');
    counter.className = mc.counter; counter.setAttribute('data-avoid', ''); counter.setAttribute('aria-live', 'off'); counter.style.visibility = 'hidden';
    const cRun = document.createElement('span'), cOk = document.createElement('span'), cP95 = document.createElement('span'), cWord = document.createElement('b');
    cOk.className = mc.ok; cWord.className = mc.word;
    counter.append(cRun, cOk, cP95, cWord);
    host?.appendChild(counter);
    let lastCounter = '', ended = false;
    const up1 = new C.Cartesian3();
    const lifted = (i: number, hM: number) => {
      const g = groundCart[i]; C.Cartesian3.normalize(g, up1);
      return C.Cartesian3.add(g, C.Cartesian3.multiplyByScalar(up1, hM, new C.Cartesian3()), new C.Cartesian3());
    };
    const mcCaption = (t: number) => {
      const n = sched.samples.toLocaleString('en-US');
      if (t < endS + MC_END_S) return { title: `Testing ${n} landings`, detail: 'Seeded draws, sped up' };
      return { title: `Landing ${verdict.label}`, detail: `${n} landings tested` };
    };
    const mcFrame = (t: number) => {
      const a = t - endS;                       // seconds after touchdown
      const on = a >= MC_START_S - 20 && !loading && prims.length === td.length && groundCart.length === td.length;
      // ellipse outline fades in as the testing starts
      if (eLine) (eLine.material.uniforms as { color: CesiumNS.Color }).color = col(BONE, clamp((a - (MC_START_S - 20)) / 20, 0, 1) * 0.9);
      if (!on) {
        for (const p of prims) if (p.show) p.show = false;
        streaks.forEach((l) => { l.show = false; }); puffs.forEach((p) => { p.show = false; });
        roverRing.show = false;
        roverTag?.remove(); roverTag = null;
        counter.style.visibility = 'hidden'; ended = false;
        return;
      }
      const u = mcProgress(a), runs = sched.runsAt(u), m = sched.keptAt(runs);
      const settle = clamp((a - MC_END_S) / (MC_SETTLE_S * 0.5), 0, 1);
      const px = DOT_PX + (DOT_END_PX - DOT_PX) * settle;
      // landed dots: pop in, then settle smaller and a little fainter so the terrain reads
      for (let i = 0; i < prims.length; i++) {
        const pr = prims[i];
        if (i >= m) { if (pr.show) pr.show = false; continue; }
        const age = (a - landAt[i]) / 6;
        const sc = age >= 1 ? 1 : popScale(Math.max(0.05, age));
        pr.pixelSize = px * sc; pr.show = true; pr.position = groundCart[i];
        if (settle > 0) { const c = tdCol[i]; if (Math.abs(c.alpha - (1 - 0.3 * settle)) > 0.02) pr.color = C.Color.clone(c).withAlpha(1 - 0.3 * settle); }
        else if (pr.color.alpha !== 1) pr.color = tdCol[i];
      }
      // falling: the next touchdowns, from MC_FALL_H_M above the ground, each with a short streak above it
      let si = 0;
      for (let i = m; i < td.length && si < STREAKS; i++) {
        const left = landAt[i] - a;
        if (left > MC_FALL_S) break;
        const f = clamp(left / MC_FALL_S, 0, 1), h = MC_FALL_H_M * f * f;
        const l = streaks[si++];
        l.positions = [lifted(i, h + 4), lifted(i, h + 40 + 80 * f)]; l.show = true;
      }
      for (; si < STREAKS; si++) streaks[si].show = false;
      // dust puffs for the most recent touchdowns
      let pi = 0;
      for (let i = m - 1; i >= 0 && pi < PUFFS; i--) {
        const age = a - landAt[i];
        if (age > MC_PUFF_S) break;
        const k = clamp(age / MC_PUFF_S, 0, 1), p = puffs[pi++];
        p.position = groundCart[i]; p.pixelSize = 4 + 9 * k; p.color = col(DUST, 0.45 * (1 - k)); p.show = true;
      }
      for (; pi < PUFFS; pi++) puffs[pi].show = false;
      // counter
      const st = sched.statsAt(runs), parts = mcCounterParts(st, maxSlopeDeg);
      const v = st.final ? verdict : landingVerdict({ okFraction: st.okFraction, nodataFraction: st.nodataFraction });
      const word = st.final ? verdict.label : runs > 0 ? `${v.verdict} so far` : '';
      const key = `${parts.run}|${parts.ok}|${parts.p95}|${word}`;
      if (key !== lastCounter) {
        lastCounter = key;
        cRun.textContent = parts.run; cOk.textContent = parts.ok; cP95.textContent = parts.p95; cWord.textContent = word;
        cOk.style.color = cWord.style.color = runs > 0 ? TONE_CSS[v.tone] : '';
      }
      counter.style.visibility = a >= MC_START_S ? 'visible' : 'hidden';
      counter.dataset.done = a >= MC_END_S ? '1' : '0';
      // end state: the rover ring and label, and the verdict for the shell's completion card (once per pass)
      const done = a >= MC_END_S;
      { roverRing.show = done; if (done) roverRing.position = cart(site, groundAt(endS) + lift); }
      if (done && !roverTag) { roverTag = ctx.labels.add('Rover at touchdown', BONE, { prio: 9, dy: -16 }); roverTag.setWorld(cart(site, groundAt(endS) + lift)); }
      if (!done && roverTag) { roverTag.remove(); roverTag = null; }
      if (done && !ended) {
        ended = true;
        emitScenarioEnd({
          kind: 'landing', id: full?.id ?? spec.id, verdict: verdict.verdict, label: verdict.label, tone: verdict.tone, reason: verdict.reason, rule: verdict.rule,
          stats: { samples: sched.samples, okPercent: Math.round(finalStats.okFraction * 1000) / 10, nodataPercent: Math.round(finalStats.nodataFraction * 1000) / 10, slopeP95Deg: finalStats.p95, maxSlopeDeg, estimated: verdict.estimated },
        });
      }
      if (!done) ended = false;
    };

    const place = () => {
      if (trackH.length) {
        // the approach arc stops 2 km above the ground: below that it would drop through the close-up views as a line
        trackPos = track.flatMap((p, i) => (vehicleAltM(tt(i), ev) >= ARC_HIDE_BELOW_M ? [cart(p, trackH[i] + vehicleAltM(tt(i), ev) + lift)] : []));
        faint.positions = trackPos;
      }
      if (eLine && eH.length) { eLine.positions = eLL.map((p, i) => cart(p, eH[i] + lift)); eLine.show = true; }
    };

    /* ---- poses */
    const enuUp = new C.Cartesian3(), enuE = new C.Cartesian3();
    const basis = (p: CesiumNS.Cartesian3) => {
      const m = C.Transforms.eastNorthUpToFixedFrame(p, ctx.ellipsoid);
      C.Matrix4.getColumn(m, 0, v4); C.Cartesian3.fromCartesian4(v4, enuE);
      C.Matrix4.getColumn(m, 2, v4); C.Cartesian3.fromCartesian4(v4, enuUp);
    };
    const v4 = new C.Cartesian4();
    /** Model frame: x forward, y left, z up (glTF +Z forward, +Y up). `fwd` is projected onto the plane normal to `up`. */
    const pose = (pos: CesiumNS.Cartesian3, up: CesiumNS.Cartesian3, fwdHint: CesiumNS.Cartesian3, scale?: CesiumNS.Cartesian3): CesiumNS.Matrix4 => {
      const u = C.Cartesian3.normalize(up, new C.Cartesian3());
      const f = C.Cartesian3.subtract(fwdHint, C.Cartesian3.multiplyByScalar(u, C.Cartesian3.dot(fwdHint, u), new C.Cartesian3()), new C.Cartesian3());
      if (C.Cartesian3.magnitudeSquared(f) < 1e-9) C.Cartesian3.clone(C.Cartesian3.UNIT_X, f);
      C.Cartesian3.normalize(f, f);
      const l = C.Cartesian3.cross(u, f, new C.Cartesian3());
      const m = C.Matrix4.fromRotationTranslation(C.Matrix3.fromArray([f.x, f.y, f.z, l.x, l.y, l.z, u.x, u.y, u.z]), pos);
      return scale ? C.Matrix4.multiplyByScale(m, scale, m) : m;
    };
    /** A glTF-local point (x right, y up, z forward) in world coordinates. */
    const local = (m: CesiumNS.Matrix4, gx: number, gy: number, gz: number) => C.Matrix4.multiplyByPoint(m, new C.Cartesian3(gz, -gx, gy), new C.Cartesian3());
    const mat = (n: ModelName, m: CesiumNS.Matrix4 | null, extra?: { scale?: number; color?: CesiumNS.Color }) => {
      const mod = models.get(n); if (!mod) return;
      mod.show = !!m;
      if (!m) return;
      mod.modelMatrix = m;
      if (extra?.color) mod.color = extra.color;
    };

    const sepA = lonlat(ev.shieldSep), sepB = lonlat(ev.backshellSep);
    const siteP = () => cart(site, groundAt(endS));
    let lastCaption = '', dir = C.Cartesian3.clone(C.Cartesian3.UNIT_X);
    let released = false;

    const vehPos = (t: number): CesiumNS.Cartesian3 => {
      const tc = Math.min(t, endS), p = lonlat(tc);
      return cart(p, groundAt(tc) + drawAltM(vehicleAltM(tc, ev), K));
    };

    const frame = () => {
      if (dead) return;
      const t = Math.max(0, usePlayback.getState().t);
      const ph = stageOf(t, ev);
      const vp = vehPos(t);
      // travel direction (world) for orientation, held after touchdown
      const vp2 = vehPos(Math.min(t + 1, endS));
      const d = C.Cartesian3.subtract(vp2, vp, new C.Cartesian3());
      if (C.Cartesian3.magnitudeSquared(d) > 1) dir = C.Cartesian3.normalize(d, dir);
      basis(vp); const localUp = C.Cartesian3.clone(enuUp);
      const toUnit = (a: CesiumNS.Cartesian3) => C.Cartesian3.normalize(a, new C.Cartesian3());

      // capsule: shield forward while entering, hanging under the parachute once it opens
      const velUp = toUnit(C.Cartesian3.negate(dir, new C.Cartesian3()));
      const hang = smoothstep(ev.chute, ev.chute + 8, t);
      const capUp = toUnit(C.Cartesian3.lerp(velUp, localUp, hang, new C.Cartesian3()));
      const capAlive = t < ev.backshellSep;
      let focus = vp;

      if (capAlive) {
        // under the parachute, frame the capsule and the canopy together (canopy rim 32 m above the capsule)
        if (t >= ev.chute) focus = C.Cartesian3.add(vp, C.Cartesian3.multiplyByScalar(capUp, 16 * K * hang, new C.Cartesian3()), new C.Cartesian3());
        const m = pose(vp, capUp, dir, SK);
        mat('backshell', m);
        mat('heatshield', t < ev.shieldSep ? m : null);
        if (t >= ev.chute) {
          const k = K * (0.08 + 0.92 * smoothstep(ev.chute, ev.chute + 5, t));
          const cm = pose(C.Cartesian3.add(vp, C.Cartesian3.multiplyByScalar(capUp, 1.85 * K, new C.Cartesian3()), new C.Cartesian3()), capUp, dir, new C.Cartesian3(k, k, k));
          mat('parachute', cm);
        } else mat('parachute', null);
      } else {
        // back shell and parachute cut loose and fall, then lie on the ground
        const ga = groundAt(ev.backshellSep), alt = shellAltM(t, ev);
        const p = cart(sepB, ga + drawAltM(alt, K) + K);
        basis(p); const u = C.Cartesian3.clone(enuUp);
        mat('backshell', pose(p, u, dir, SK));
        const lying = alt <= 0.5;
        const flat = lying ? 0.12 : 1;
        mat('parachute', pose(C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(u, 1.85 * K, new C.Cartesian3()), new C.Cartesian3()), u, dir, new C.Cartesian3(K, K, K * flat)));
      }
      // heat shield falls from where it let go
      if (t >= ev.shieldSep) {
        const ga = groundAt(ev.shieldSep), a0 = vehicleAltM(ev.shieldSep, ev), alt = Math.max(0, a0 - (t - ev.shieldSep) * 70);
        const p = cart(sepA, ga + drawAltM(alt, K) + 0.5 * K); basis(p);
        mat('heatshield', pose(p, enuUp, dir, SK));
      }

      // descent stage with the rover on its bridles, then the rover alone
      let gcTop: CesiumNS.Cartesian3 | null = null, gcBottom: CesiumNS.Cartesian3 | null = null;
      let stageM: CesiumNS.Matrix4 | null = null, roverM: CesiumNS.Matrix4 | null = null;
      if (t >= ev.backshellSep) {
        const dt = Math.max(0, t - endS);
        let sp = vp;
        if (dt > 0) { basis(siteP()); sp = cart(site, groundAt(endS) + drawAltM(vehicleAltM(t, ev), K)); sp = C.Cartesian3.add(sp, C.Cartesian3.multiplyByScalar(enuE, dt * 24 * CK, new C.Cartesian3()), new C.Cartesian3()); }
        basis(sp); const u = C.Cartesian3.clone(enuUp);
        stageM = dt < DEPART_S ? pose(sp, u, dir, SK) : null;
        // the cords pay out in proportion with the enlarged vehicle (drawAltM keeps the touchdown exact)
        const h = hangM(t, ev) * K;
        const rp = C.Cartesian3.subtract(dt > 0 ? cart(site, groundAt(endS)) : sp, dt > 0 ? C.Cartesian3.ZERO : C.Cartesian3.multiplyByScalar(u, h, new C.Cartesian3()), new C.Cartesian3());
        roverM = pose(rp, dt > 0 ? localUpAt(siteP()) : u, dir, SK);
        // what the ground tracking camera frames: stage top to the rover's wheels, then the rover alone after touchdown
        if (t < endS) { gcTop = C.Cartesian3.add(sp, C.Cartesian3.multiplyByScalar(u, STAGE_TOP_M * K, new C.Cartesian3()), new C.Cartesian3()); gcBottom = rp; }
        else { const ru = localUpAt(siteP()); gcTop = C.Cartesian3.add(rp, C.Cartesian3.multiplyByScalar(ru, 2.2 * K, new C.Cartesian3()), new C.Cartesian3()); gcBottom = rp; }
        focus = t < endS ? C.Cartesian3.subtract(sp, C.Cartesian3.multiplyByScalar(u, h / 2, new C.Cartesian3()), new C.Cartesian3()) : siteP();
        // bridles: three lines from the stage underside to the rover deck
        cables.forEach((c, i) => {
          const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
          if (stageM && roverM && t < endS + 1.5) {
            c.positions = [local(stageM, Math.cos(a) * 0.55, -0.05, Math.sin(a) * 0.55), local(roverM, Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.4)];
            c.show = true;
          } else c.show = false;
        });
      } else cables.forEach((c) => { c.show = false; });
      mat('lander', stageM); mat('rover', roverM);

      // dust bloom under the engines
      const ds = dust(t, ev);
      if (ds.radius > 0.5 && t >= ev.backshellSep) {
        const gp = t <= endS ? cart(lonlat(t), groundAt(t) + 0.3) : cart(site, groundAt(endS) + 0.3);
        basis(gp);
        mat('dust', pose(gp, enuUp, enuE, new C.Cartesian3(ds.radius * K, ds.radius * K, 1)), { color: C.Color.WHITE.withAlpha(clamp(ds.alpha * 0.5, 0, 1)) });
      } else mat('dust', null);

      // discarded hardware and, once the camera pulls back, everything else at true scale: a minimum pixel size would turn the
      // heat shield lying 14 km up-range into a dark disc floating over the ellipse
      const pb = pullBack(t, ev);
      minPx('heatshield', t < ev.shieldSep ? MIN_PX : 0);
      minPx('backshell', t < ev.backshellSep ? MIN_PX : 0);
      minPx('lander', pb > 0 ? 0 : MIN_PX);
      minPx('rover', pb > 0 ? 0 : MIN_PX);
      // approach arc only while the vehicle is above 2 km (and never after touchdown)
      faint.show = trackPos.length > 1 && t < endS && vehicleAltM(t, ev) >= ARC_HIDE_BELOW_M;

      // the Monte-Carlo testing phase: the seeded touchdowns drop onto the ellipse, then settle (mcFrame below)
      mcFrame(t);

      // camera. Entry and parachute: chase the vehicle. Below 1.3 km: cut to a tracking camera on the ground 40 m south of the
      // touchdown point that looks up at the vehicle (sky, horizon and the vehicle at true scale). Under 120 m it rises with the
      // stage and pitches down, so the sky crane hangs over real ground with the horizon at 35 % of the height. After
      // touchdown: a 2 m eye with the rover at 60 % of the height. 10 s after touchdown: pull back to the whole ellipse.
      // the store's own ellipse label carries the final percentage: it stays quiet until the testing phase has finished
      this.ov.setQuiet(following && !released && (pb < 0.5 || t < endS + MC_END_S));
      if (following && !released && !loading) {
        const gc = (groundCamActive(t, ev) || t >= endS) && gcTop && gcBottom ? groundPose(t, gcTop, gcBottom, t >= endS) : null;
        if (gc && pb > 0) applyPose(blendPose(gc, widePose(), pb));
        else if (gc) applyPose(gc);
        else if (pb > 0) applyPose(widePose());
        else {
          setVfov(null);
          const cam = chaseCamera(t, ev);
          ctx.scene.camera.lookAt(focus, new C.HeadingPitchRange(0, C.Math.toRadians(cam.pitchDeg), cam.rangeM * CK));
          ctx.scene.camera.lookAtTransform(C.Matrix4.IDENTITY);
        }
        if (pb >= 1) setVfov(null);
      }

      if (spec.caption && !loading) {
        const cap = t >= endS + MC_START_S ? mcCaption(t) : (() => { const c = phaseCaption(t, phases, ph === 'landed' ? 0 : vehicleAltM(Math.min(t, endS), ev)); return { title: c.label, detail: c.altitude }; })();
        const text = `${cap.title}|${cap.detail}`;
        if (text !== lastCaption) { lastCaption = text; ctx.caption(cap); }
      }
    };

    /* ---- camera poses (world position, view direction, vertical field of view in degrees) */
    interface Pose { pos: CesiumNS.Cartesian3; dir: CesiumNS.Cartesian3; vfov: number }
    const cam = ctx.scene.camera;
    const frustum = cam.frustum as CesiumNS.PerspectiveFrustum;
    const defaultFov = frustum.fov ?? Math.PI / 3;
    const aspect = () => frustum.aspectRatio || 1;
    const vfovOf = (fov: number) => (aspect() > 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect()) : fov) / D2R;
    /** null restores the default lens. */
    const setVfov = (vfovDeg: number | null) => {
      const want = vfovDeg == null ? defaultFov : aspect() > 1 ? 2 * Math.atan(Math.tan((vfovDeg * D2R) / 2) * aspect()) : vfovDeg * D2R;
      if (Math.abs((frustum.fov ?? 0) - want) > 1e-6) frustum.fov = want;
    };
    const enuAt = (p: CesiumNS.Cartesian3) => {
      const m = C.Transforms.eastNorthUpToFixedFrame(p, ctx.ellipsoid);
      const col3 = (i: number) => C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(m, i, new C.Cartesian4()), new C.Cartesian3());
      return { e: col3(0), n: col3(1), u: col3(2) };
    };
    const fromEnu = (b: ReturnType<typeof enuAt>, x: number, y: number, z: number) => {
      const r = C.Cartesian3.multiplyByScalar(b.e, x, new C.Cartesian3());
      C.Cartesian3.add(r, C.Cartesian3.multiplyByScalar(b.n, y, new C.Cartesian3()), r);
      return C.Cartesian3.add(r, C.Cartesian3.multiplyByScalar(b.u, z, new C.Cartesian3()), r);
    };
    const toEnu = (b: ReturnType<typeof enuAt>, d: CesiumNS.Cartesian3): [number, number, number] => [C.Cartesian3.dot(d, b.e), C.Cartesian3.dot(d, b.n), C.Cartesian3.dot(d, b.u)];
    const dirOf = (headingDeg: number, pitchDeg: number) => [Math.sin(headingDeg * D2R) * Math.cos(pitchDeg * D2R), Math.cos(headingDeg * D2R) * Math.cos(pitchDeg * D2R), Math.sin(pitchDeg * D2R)] as const;
    // the tracking camera stands on the ground south of the touchdown point and dollies in as the vehicle comes down; ground
    // heights along its track are sampled once, and it never goes under the rendered tile
    const GC_TRACK_M = [GROUND_CAM_DIST_M, 60, 100, 160, 250, 400, 550, 700].map((d) => d * CK);
    const gcTrack = GC_TRACK_M.map((d) => destinationPoint(site, 180, d / 1000));
    let gcGround: number[] | null = null;
    void ctx.sample(gcTrack).then((h) => { if (!dead) gcGround = h; });
    const groundEye = (t: number, eyeM: number) => {
      const d = clamp(CK * groundCamDistM(vehicleAltM(Math.min(t, endS), ev)), GC_TRACK_M[0], GC_TRACK_M[GC_TRACK_M.length - 1]);
      const ll = destinationPoint(site, 180, d / 1000);
      let k = 0; while (k < GC_TRACK_M.length - 2 && GC_TRACK_M[k + 1] < d) k++;
      const u = (d - GC_TRACK_M[k]) / (GC_TRACK_M[k + 1] - GC_TRACK_M[k]);
      const sampled = gcGround ? gcGround[k] + (gcGround[k + 1] - gcGround[k]) * u : groundAt(endS);
      const rendered = ctx.groundHeight(ll.lon * D2R, ll.lat * D2R);
      return cart(ll, Math.max(sampled, rendered ?? -Infinity) + eyeM);
    };
    // sky crane: the eye rises to just above the stage top so the ground fills the lower part of the frame (QA round 3, P0-2);
    // after touchdown it is back at 2 m and aims above the rover so the rover sits at 60 % of the height (P0-3)
    const groundPose = (t: number, top: CesiumNS.Cartesian3, bottom: CesiumNS.Cartesian3, landed = false): Pose => {
      const alt = vehicleAltM(Math.min(t, endS), ev);
      const eye = groundEye(t, landed ? GROUND_CAM_EYE_M : groundCamEyeM(alt, hangM(Math.min(t, endS), ev), K)), b = enuAt(eye);
      const tp = toEnu(b, C.Cartesian3.subtract(top, eye, new C.Cartesian3())), bt = toEnu(b, C.Cartesian3.subtract(bottom, eye, new C.Cartesian3()));
      const f = landed ? touchdownFraming(tp, bt) : craneFraming(tp, bt, craneBlend(alt));
      return { pos: eye, dir: C.Cartesian3.normalize(fromEnu(b, ...dirOf(f.headingDeg, f.pitchDeg)), new C.Cartesian3()), vfov: f.vfovDeg };
    };
    const widePose = (): Pose => {
      const s = siteP(), b = enuAt(s);
      const d = C.Cartesian3.normalize(fromEnu(b, ...dirOf(wide.headingDeg, wide.pitchDeg)), new C.Cartesian3());
      return { pos: C.Cartesian3.subtract(s, C.Cartesian3.multiplyByScalar(d, wide.rangeM, new C.Cartesian3()), new C.Cartesian3()), dir: d, vfov: vfovOf(defaultFov) };
    };
    /** Pull-back: the camera's offset from the site turns and grows on a log scale (no swoop through the ground), the view direction turns with it. */
    const blendPose = (a: Pose, b: Pose, k: number): Pose => {
      const s = siteP();
      const oa = C.Cartesian3.subtract(a.pos, s, new C.Cartesian3()), ob = C.Cartesian3.subtract(b.pos, s, new C.Cartesian3());
      const ma = C.Cartesian3.magnitude(oa), mb = C.Cartesian3.magnitude(ob);
      const u = C.Cartesian3.normalize(C.Cartesian3.lerp(C.Cartesian3.normalize(oa, oa), C.Cartesian3.normalize(ob, ob), k, new C.Cartesian3()), new C.Cartesian3());
      const m = Math.exp(Math.log(ma) * (1 - k) + Math.log(mb) * k);
      return {
        pos: C.Cartesian3.add(s, C.Cartesian3.multiplyByScalar(u, m, u), new C.Cartesian3()),
        dir: C.Cartesian3.normalize(C.Cartesian3.lerp(a.dir, b.dir, k, new C.Cartesian3()), new C.Cartesian3()),
        vfov: a.vfov + (b.vfov - a.vfov) * k,
      };
    };
    const applyPose = (p: Pose) => {
      const up = enuAt(p.pos).u;
      const right = C.Cartesian3.normalize(C.Cartesian3.cross(p.dir, up, new C.Cartesian3()), new C.Cartesian3());
      cam.setView({ destination: p.pos, orientation: { direction: p.dir, up: C.Cartesian3.cross(right, p.dir, new C.Cartesian3()) } });
      setVfov(p.vfov);
    };
    const minPx = (n: ModelName, px: number) => { const m = models.get(n); if (m && m.minimumPixelSize !== px) m.minimumPixelSize = px; };

    /* ---- wait for the terrain before playing: the touchdown area (seen from the tracking camera and from the wide view)
       and the start of the chase are loaded behind the veil, then the clock starts. A seek cancels the wait. */
    let loading = following;
    const prevCache = ctx.scene.globe.tileCacheSize;
    if (following) {
      ctx.scene.globe.tileCacheSize = Math.max(prevCache, 1500);
      usePlayback.getState().pause();
      ctx.caption({ title: 'Loading terrain', detail: 'Mars Trek imagery at the landing site', loading: true });
      ctx.veil(1);
      const stillWaiting = () => !dead && loading && usePlayback.getState().t === 0;
      const tiles = (ms: number) => new Promise<void>((done) => {
        const t0 = performance.now();
        let ok = 0;
        const off = ctx.onFrame(() => {
          ok = ctx.scene.globe.tilesLoaded ? ok + 1 : 0;
          if (ok >= 4 || performance.now() - t0 > ms || !stillWaiting()) { off(); done(); }
        });
      });
      void (async () => {
        await new Promise((r) => setTimeout(r, 650)); // the veil is closed before the camera moves
        const ready = performance.now();
        while (stillWaiting() && (!trackH.length || !gcGround) && performance.now() - ready < 8000) await new Promise((r) => setTimeout(r, 100));
        const roverTop = () => C.Cartesian3.add(siteP(), C.Cartesian3.multiplyByScalar(localUpAt(siteP()), 22, new C.Cartesian3()), new C.Cartesian3());
        if (stillWaiting()) { applyPose(groundPose(endS, roverTop(), siteP())); await tiles(15000); }
        if (stillWaiting()) { applyPose(widePose()); await tiles(10000); }
        if (stillWaiting()) {
          setVfov(null);
          const c0 = chaseCamera(0, ev);
          cam.lookAt(vehPos(0), new C.HeadingPitchRange(0, C.Math.toRadians(c0.pitchDeg), c0.rangeM));
          cam.lookAtTransform(C.Matrix4.IDENTITY);
          await tiles(10000);
        }
        if (dead) return;
        const play = stillWaiting() && !usePlayback.getState().playing;
        loading = false; lastCaption = '';
        ctx.caption(null); ctx.veil(0);
        if (play) usePlayback.getState().play();
      })();
    }

    const localUpAt = (p: CesiumNS.Cartesian3) => { basis(p); return C.Cartesian3.clone(enuUp); };
    const off = ctx.onPreRender(frame);

    return {
      id: spec.id,
      follow: (on) => { released = !on; if (!on) setVfov(null); },
      refresh: (l) => { lift = l; place(); mcGround(); },
      dispose: () => {
        dead = true; off(); ctx.setSimActive(false); this.ov.setQuiet(false); setVfov(null);
        useDrawScale.getState().set('landing', null);
        counter.remove(); roverTag?.remove(); roverTag = null;
        streaks.forEach((l) => this.ov.polylines.remove(l)); puffs.forEach((p) => this.ov.pointPrimitives.remove(p));
        this.ov.pointPrimitives.remove(roverRing);
        if (loading) { loading = false; ctx.veil(0); }
        ctx.scene.globe.tileCacheSize = prevCache;
        this.ov.polylines.remove(faint); cables.forEach((c) => this.ov.polylines.remove(c)); if (eLine) this.ov.polylines.remove(eLine);
        prims.forEach((p) => this.ov.pointPrimitives.remove(p));
        models.forEach((m) => { scene.primitives.remove(m); });
      },
    };
  }
}
