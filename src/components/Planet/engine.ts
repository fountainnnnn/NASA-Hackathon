/**
 * CesiumJS planet engine: real Mars Trek terrain and imagery, flown like Google Earth, driven by the globe store.
 * Imperative on purpose (one widget, one render loop); PlanetView.tsx is the thin React shell.
 */
import type * as CesiumNS from 'cesium';
import type { LonLat } from '../../lib/contracts';
import { JEZERO_CENTER, useGlobeStore, type GlobeFlight } from '../../state/globe';
import { LabelLayer } from './labels';
import { LandingLayer } from './landing';
import { Overlays, type PlanetCtx } from './overlays';
import type { Screen } from './projection';
import { CESIUM_CDN_BASE, CESIUM_JS_SRI, CESIUM_LOCAL_BASE } from './cesiumCdn';
import { marsImagery } from './imagery';
import { withTerrainNormals } from './terrainNormals';
import {
  DATA_CREDIT, JEZERO_HANDOFF_ALT_KM, MARS_RADII_M, MIN_CAMERA_HEIGHT_M, SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG, TERRAIN_DATUM_OFFSET_M, TERRAIN_URL,
  ctxAlpha, effectiveExaggeration, reliefShading, elevationFromHeight, flightDurationS, globeLightBlend, inJezero, pitchForAltitudeKm,
  rangeForAltitudeM, roundAltKm,
  PICK_RETRY_MS, retryEachFrame,
} from './planetMath';

type C = typeof CesiumNS;

export interface PlanetDebug {
  Cesium: C; scene: CesiumNS.Scene; widget: CesiumNS.CesiumWidget;
  /** Move the camera to look at lon/lat from `altKm` of height at `pitchDeg` / `headingDeg`. instant skips the flight. */
  view(lon: number, lat: number, altKm: number, opts?: { pitchDeg?: number; headingDeg?: number; instant?: boolean }): Promise<void>;
  handoff: boolean;
  datumCheck(points: LonLat[]): Promise<number[]>;
  stats(): { altKm: number; rangeM: number; tilesLoaded: boolean; terrainLevels: number; imageryFailures: number; fuseThreads: number };
}

export interface PlanetHandle {
  destroy(): void;
  /** Render loop on/off (off while the Jezero planner owns the screen). */
  setActive(a: boolean): void;
  project(p: LonLat): Screen;
  debug: PlanetDebug;
}

export interface EngineOpts {
  container: HTMLElement; creditEl: HTMLElement; labelsEl: HTMLElement;
  /** Opaque veil for the Jezero hand-off. 1 = black. */
  veil: (opacity: number) => void;
  caption: (c: { title: string; detail: string; loading?: boolean } | null) => void;
  onTerrainFailed?: () => void;
}

type CesiumWindow = { Cesium?: C; CESIUM_BASE_URL?: string };

function loadScript(src: string, integrity?: string): Promise<void> {
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src; el.async = true;
    if (integrity) { el.integrity = integrity; el.crossOrigin = 'anonymous'; }
    el.onload = () => res();
    el.onerror = () => { el.remove(); rej(new Error(`failed to load ${src}`)); };
    document.head.appendChild(el);
  });
}

/**
 * Cesium's prebuilt bundle (never through webpack): jsDelivr at the pinned version with SRI, else the local copy in
 * public/cesium (dev only). CESIUM_BASE_URL points workers and assets at whichever one loaded. See cesiumCdn.ts.
 */
let cesiumLoad: Promise<C> | null = null;
function loadCesium(): Promise<C> {
  const w = window as unknown as CesiumWindow;
  if (w.Cesium) return Promise.resolve(w.Cesium);
  cesiumLoad ??= (async () => {
    try {
      w.CESIUM_BASE_URL = CESIUM_CDN_BASE;
      await loadScript(`${CESIUM_CDN_BASE}Cesium.js`, CESIUM_JS_SRI);
    } catch {
      console.warn('CesiumJS CDN unavailable, trying the local copy in /cesium');
      w.CESIUM_BASE_URL = CESIUM_LOCAL_BASE;
      await loadScript(`${CESIUM_LOCAL_BASE}Cesium.js`);
    }
    if (!w.Cesium) throw new Error('Cesium global missing');
    return w.Cesium;
  })();
  cesiumLoad.catch(() => { cesiumLoad = null; });
  return cesiumLoad;
}

export async function createPlanet(o: EngineOpts): Promise<PlanetHandle> {
  const C = await loadCesium();
  const MARS = new C.Ellipsoid(MARS_RADII_M.x, MARS_RADII_M.y, MARS_RADII_M.z);
  C.Ellipsoid.default = MARS;
  C.Ion.defaultAccessToken = '';
  C.RequestScheduler.maximumRequestsPerServer = 24;

  const widget = new C.CesiumWidget(o.container, {
    baseLayer: false, skyBox: false, skyAtmosphere: false, scene3DOnly: true, requestRenderMode: false,
    globe: new C.Globe(MARS), mapProjection: new C.GeographicProjection(MARS), creditContainer: o.creditEl,
    // full device resolution for sharp ground; MSAA instead of FXAA (FXAA softens imagery). Retina screens skip MSAA for speed.
    useBrowserRecommendedResolution: false, showRenderLoopErrors: false, msaaSamples: window.devicePixelRatio >= 2 ? 1 : 4,
    contextOptions: { webgl: { alpha: false, antialias: true, powerPreference: 'high-performance' } },
  });
  const { scene, camera, canvas } = widget;
  const globe = scene.globe;
  const store = useGlobeStore;
  widget.clock.shouldAnimate = false;

  /* ------------------------------------------------------------ scene look: dark space, dusty air, a low afternoon sun */
  scene.backgroundColor = C.Color.fromCssColorString('#060505');
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  scene.highDynamicRange = false;
  scene.postProcessStages.fxaa.enabled = false;
  // Dust haze and sky. Cesium's scattering model reddens toward the zenith and turns teal at the horizon when given a red-heavy
  // spectrum (it uses one set of coefficients for scattering and extinction), so the scattering is kept neutral and the
  // colour comes from a hue / saturation shift to dusty butterscotch. Fog takes the ground-atmosphere colour. Visual only.
  scene.fog.enabled = true;
  scene.fog.density = 2.2e-4;
  scene.fog.visualDensityScalar = 0.2;
  scene.fog.minimumBrightness = 0.35;
  const RAYLEIGH = new C.Cartesian3(6e-6, 6e-6, 6e-6), MIE = new C.Cartesian3(21e-6, 21e-6, 21e-6);
  const HUE = 0.07, SAT = 0.3;
  globe.atmosphereRayleighCoefficient = RAYLEIGH; globe.atmosphereMieCoefficient = MIE;
  globe.atmosphereLightIntensity = 8; globe.atmosphereRayleighScaleHeight = 11_100; globe.atmosphereMieScaleHeight = 11_100;
  globe.atmosphereHueShift = HUE; globe.atmosphereSaturationShift = SAT; globe.atmosphereBrightnessShift = 0;
  scene.atmosphere.rayleighCoefficient = RAYLEIGH; scene.atmosphere.mieCoefficient = MIE; scene.atmosphere.lightIntensity = 8;
  scene.atmosphere.hueShift = HUE; scene.atmosphere.saturationShift = SAT;
  scene.skyAtmosphere = new C.SkyAtmosphere(MARS);
  Object.assign(scene.skyAtmosphere, {
    atmosphereRayleighCoefficient: RAYLEIGH, atmosphereMieCoefficient: MIE, atmosphereRayleighScaleHeight: 11_100, atmosphereMieScaleHeight: 11_100,
    atmosphereLightIntensity: 22, hueShift: HUE, saturationShift: SAT, brightnessShift: 0.1,
  });
  globe.dynamicAtmosphereLighting = false;     // the haze is lit as daytime wherever you look; the sun below only shades relief
  globe.baseColor = C.Color.fromCssColorString('#5a3d2c');
  globe.showGroundAtmosphere = false;
  globe.showWaterEffect = false;
  globe.enableLighting = true;
  // diffuse = clamp(lambert * 0.85 + 0.5): flat ground under the 35 degree sun sits near full brightness, slopes facing away
  // from the sun fall to about half, so relief reads without the whole scene going dark
  globe.lambertDiffuseMultiplier = 0.85; globe.vertexShadowDarkness = 0.5;
  globe.lightingFadeOutDistance = 6e7; globe.lightingFadeInDistance = 9e7;
  globe.depthTestAgainstTerrain = true;
  globe.maximumScreenSpaceError = 1.33;
  globe.tileCacheSize = 400;
  globe.preloadSiblings = true;
  scene.light = new C.DirectionalLight({ direction: new C.Cartesian3(1, 0, 0) });
  scene.verticalExaggerationRelativeHeight = TERRAIN_DATUM_OFFSET_M;

  /* ------------------------------------------------------------ imagery: graded Viking colour, then CTX 5 m detail fused onto it */
  const imagery = marsImagery(C, MARS);
  scene.imageryLayers.addImageryProvider(imagery.base);
  const ctxLayer = scene.imageryLayers.addImageryProvider(imagery.fused);
  ctxLayer.alpha = 0; ctxLayer.show = false;

  // one compact line; the providers carry no credits of their own so nothing spills into a second line or a pop-up
  widget.creditDisplay.addStaticCredit(new C.Credit(DATA_CREDIT, true));

  /* ------------------------------------------------------------ terrain */
  let terrainOk = false;
  try {
    const tp = await C.CesiumTerrainProvider.fromUrl(TERRAIN_URL, { ellipsoid: MARS, requestVertexNormals: true });
    withTerrainNormals(C, tp, MARS);   // the tiles ship without the normals layer.json promises; compute them per tile
    scene.terrainProvider = tp; terrainOk = true;
  } catch { o.onTerrainFailed?.(); }

  /* ------------------------------------------------------------ helpers */
  const datum = TERRAIN_DATUM_OFFSET_M;
  const carto = new C.Cartographic();
  const groundHeight = (lonRad: number, latRad: number): number | undefined => {
    carto.longitude = lonRad; carto.latitude = latRad; carto.height = 0;
    return globe.getHeight(carto);
  };
  const sample: PlanetCtx['sample'] = async (pts) => {
    const cs = pts.map((p) => new C.Cartographic(C.Math.toRadians(p.lon), C.Math.toRadians(p.lat), NaN));
    if (terrainOk) { try { await C.sampleTerrainMostDetailed(scene.terrainProvider, cs); } catch { /* use the rendered height */ } }
    return cs.map((c) => (Number.isFinite(c.height) ? c.height : groundHeight(c.longitude, c.latitude) ?? datum));
  };
  const sampleOne = async (p: LonLat, ms = 700): Promise<number | null> => {
    const r = await Promise.race([sample([p]), new Promise<null>((res) => setTimeout(() => res(null), ms))]);
    return r ? r[0] : null;
  };

  const st = { altKm: 9000, rangeM: 9_000_000, centre: null as LonLat | null, sim: false, flying: false, flightJezero: false, armed: true, active: true };
  const scratch = { ray: new C.Ray(), c2: new C.Cartesian2(), c3: new C.Cartesian3(), cart: new C.Cartographic() };

  const pickGround = (x: number, y: number): { lon: number; lat: number; height: number; world: CesiumNS.Cartesian3 } | null => {
    scratch.c2.x = x; scratch.c2.y = y;
    const ray = camera.getPickRay(scratch.c2, scratch.ray);
    if (!ray) return null;
    const p = globe.pick(ray, scene, scratch.c3);
    if (!p) return null;
    MARS.cartesianToCartographic(p, scratch.cart);
    return { lon: C.Math.toDegrees(scratch.cart.longitude), lat: C.Math.toDegrees(scratch.cart.latitude), height: scratch.cart.height, world: C.Cartesian3.clone(p) };
  };

  /** The point under the pointer on the bare Mars ellipsoid (height unknown): the fallback while terrain tiles load. */
  const pickEllipsoid = (x: number, y: number): { lon: number; lat: number; height: number; world: CesiumNS.Cartesian3 } | null => {
    scratch.c2.x = x; scratch.c2.y = y;
    const p = camera.pickEllipsoid(scratch.c2, MARS, scratch.c3);
    if (!p) return null;
    MARS.cartesianToCartographic(p, scratch.cart);
    return { lon: C.Math.toDegrees(scratch.cart.longitude), lat: C.Math.toDegrees(scratch.cart.latitude), height: NaN, world: C.Cartesian3.clone(p) };
  };

  const frameFrags = new Set<() => void>();
  const preFrags = new Set<() => void>();
  const ctx: PlanetCtx = {
    C, scene, ellipsoid: MARS, labels: new LabelLayer(C, o.labelsEl, MARS), sample, groundHeight,
    rangeM: () => st.rangeM, onFrame: (cb) => { frameFrags.add(cb); return () => { frameFrags.delete(cb); }; },
    onPreRender: (cb) => { preFrags.add(cb); return () => { preFrags.delete(cb); }; },
    cancelFlight: () => cancelFlight(), setSimActive: (on) => { st.sim = on; }, caption: o.caption, veil: o.veil,
  };
  const overlays = new Overlays(ctx);
  const landing = new LandingLayer(ctx, overlays);

  /* ------------------------------------------------------------ camera controller: Google Earth style */
  const cc = scene.screenSpaceCameraController;
  cc.enableCollisionDetection = true;
  cc.minimumZoomDistance = MIN_CAMERA_HEIGHT_M;
  cc.maximumZoomDistance = 30_000_000;
  cc.zoomEventTypes = [C.CameraEventType.WHEEL, C.CameraEventType.PINCH];
  cc.tiltEventTypes = [C.CameraEventType.RIGHT_DRAG, C.CameraEventType.MIDDLE_DRAG, C.CameraEventType.PINCH, { eventType: C.CameraEventType.LEFT_DRAG, modifier: C.KeyboardEventModifier.CTRL }];
  cc.inertiaSpin = 0.85; cc.inertiaZoom = 0.8;
  canvas.style.touchAction = 'none';

  const v0 = store.getState().view;
  camera.setView({ destination: C.Cartesian3.fromDegrees(v0.lon, v0.lat, v0.altitudeKm * 1000 + datum, MARS), orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 } });

  /* ------------------------------------------------------------ flights */
  let flightToken = 0;
  const cancelFlight = () => { flightToken++; camera.cancelFlight(); st.flying = false; st.flightJezero = false; };

  async function flyView(target: LonLat, p: { altKm?: number; pitchDeg?: number; headingDeg?: number; rangeM?: number; instant?: boolean; jezero?: boolean }): Promise<void> {
    cancelFlight();
    const token = flightToken;
    const h = (await sampleOne(target)) ?? datum;
    if (token !== flightToken) return;
    const pitch = p.pitchDeg ?? pitchForAltitudeKm(p.altKm ?? st.altKm);
    const range = Math.max(p.rangeM ?? rangeForAltitudeM(p.altKm ?? st.altKm, pitch), MIN_CAMERA_HEIGHT_M * 2);
    const heading = p.headingDeg !== undefined ? C.Math.toRadians(p.headingDeg) : camera.heading;
    const sphere = new C.BoundingSphere(C.Cartesian3.fromDegrees(target.lon, target.lat, h, MARS), 0);
    const offset = new C.HeadingPitchRange(heading, C.Math.toRadians(pitch), range);
    if (p.instant) { camera.lookAt(sphere.center, offset); camera.lookAtTransform(C.Matrix4.IDENTITY); return; }
    const from = view();
    const distKm = from ? Math.hypot(from.lon - target.lon, from.lat - target.lat) * 59.3 : 3000;
    const ratio = from ? Math.max(st.altKm, 0.1) / Math.max(range / 1000, 0.1) : 1;
    st.flying = true; st.flightJezero = !!p.jezero;
    await new Promise<void>((resolve) => camera.flyToBoundingSphere(sphere, {
      offset, duration: flightDurationS(distKm, ratio), easingFunction: C.EasingFunction.CUBIC_IN_OUT,
      complete: () => { if (token === flightToken) { st.flying = false; if (p.jezero) startHandoff(); } resolve(); },
      cancel: () => resolve(),
    }));
  }

  const runStoreFlight = (f: GlobeFlight) => {
    if (f.enterJezero) void flyView({ lon: f.lon, lat: f.lat }, { altKm: 20, pitchDeg: -55, jezero: true });
    else void flyView({ lon: f.lon, lat: f.lat }, { altKm: f.altitudeKm });
  };
  let seenFlight = store.getState().flight?.seq ?? 0;
  const unsubFlight = store.subscribe((s) => {
    if (!s.flight || s.flight.seq === seenFlight) return;
    seenFlight = s.flight.seq;
    if (s.mode === 'globe') runStoreFlight(s.flight);
  });

  /* ------------------------------------------------------------ view publishing and Jezero hand-off */
  function view(): { lon: number; lat: number; altKm: number } | null {
    const pc = camera.positionCartographic;
    if (!pc) return null;
    const gh = globe.getHeight(pc) ?? datum;
    return { lon: C.Math.toDegrees(pc.longitude), lat: C.Math.toDegrees(pc.latitude), altKm: Math.max(0, (pc.height - gh) / 1000) };
  }

  let handing = false;
  const startHandoff = () => {
    if (handing || store.getState().mode !== 'globe') return;
    handing = true; st.armed = false;
    o.veil(1);
    setTimeout(() => { handing = false; if (store.getState().mode === 'globe') store.getState().setMode('jezero'); }, 380);
  };

  let lastPub = 0;
  const publish = () => {
    const now = performance.now();
    if (now - lastPub < 100) return;
    lastPub = now;
    const v = view(); if (!v) return;
    st.altKm = v.altKm;
    const c = pickGround(canvas.clientWidth / 2, canvas.clientHeight / 2);
    st.centre = c ? { lon: c.lon, lat: c.lat } : { lon: v.lon, lat: v.lat };
    st.rangeM = Math.max(c ? C.Cartesian3.distance(camera.positionWC, c.world) : v.altKm * 1000, 50);
    store.getState().setView({ lon: st.centre.lon, lat: st.centre.lat, altitudeKm: roundAltKm(v.altKm) });
    if (!st.armed && v.altKm > 60) st.armed = true;
    if (dbg.handoff && !st.sim && st.armed && !handing && (!st.flying || st.flightJezero) && v.altKm <= JEZERO_HANDOFF_ALT_KM && inJezero(st.centre.lon, st.centre.lat, 0.05)) startHandoff();
  };

  /* ------------------------------------------------------------ per-frame: light, imagery fades, exaggeration, labels */
  const dir = new C.Cartesian3(), tmp = new C.Cartesian3(), local = new C.Cartesian3(), enu = new C.Matrix4(), col = new C.Cartesian4();
  const sunAz = C.Math.toRadians(SUN_AZIMUTH_DEG), sunEl = C.Math.toRadians(SUN_ELEVATION_DEG);
  const sunENU = new C.Cartesian3(Math.cos(sunEl) * Math.sin(sunAz), Math.cos(sunEl) * Math.cos(sunAz), Math.sin(sunEl));
  let lastAlphaKey = '';
  const preRender = () => {
    preFrags.forEach((f) => f());
    const v = view(); const alt = v ? v.altKm : st.altKm;

    // Sun. Near the ground: fixed in the local frame of the view centre, low from the west-southwest (the afternoon light CTX
    // was taken in, so baked shading and relief agree). From orbit: upper left of the camera, so the disc reads as a sphere.
    C.Cartesian3.multiplyByScalar(camera.directionWC, -0.6, dir);
    C.Cartesian3.add(dir, C.Cartesian3.multiplyByScalar(camera.rightWC, -0.6, tmp), dir);
    C.Cartesian3.add(dir, C.Cartesian3.multiplyByScalar(camera.upWC, 0.5, tmp), dir);
    C.Cartesian3.normalize(dir, dir);
    const k = globeLightBlend(alt);
    if (k < 1) {
      const c = st.centre ?? (v ? { lon: v.lon, lat: v.lat } : null);
      if (c) {
        C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(c.lon, c.lat, 0, MARS), MARS, enu);
        C.Cartesian3.multiplyByScalar(C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(enu, 0, col), tmp), sunENU.x, local);
        C.Cartesian3.add(local, C.Cartesian3.multiplyByScalar(C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(enu, 1, col), tmp), sunENU.y, tmp), local);
        C.Cartesian3.add(local, C.Cartesian3.multiplyByScalar(C.Cartesian3.fromCartesian4(C.Matrix4.getColumn(enu, 2, col), tmp), sunENU.z, tmp), local);
        C.Cartesian3.lerp(local, dir, k, dir);
        C.Cartesian3.normalize(dir, dir);
      }
    }
    const l = scene.light as CesiumNS.DirectionalLight;
    C.Cartesian3.negate(dir, l.direction);

    const key = `${Math.round(alt)}|${store.getState().exaggeration}`;
    if (key !== lastAlphaKey) {
      lastAlphaKey = key;
      const a = ctxAlpha(alt);
      ctxLayer.alpha = a; ctxLayer.show = a > 0.01;
      const r = reliefShading(alt);
      globe.lambertDiffuseMultiplier = 0.85 * r; globe.vertexShadowDarkness = 0.5 + 0.5 * (1 - r);
      scene.verticalExaggeration = effectiveExaggeration(store.getState().exaggeration, alt);
    }
    publish();
  };
  scene.preRender.addEventListener(preRender);
  const postRender = () => { frameFrags.forEach((f) => f()); ctx.labels.update(scene); };
  scene.postRender.addEventListener(postRender);

  /* ------------------------------------------------------------ own layers (MOLA hypsometric, geology, ...) */
  const own = new Map<string, { layer: CesiumNS.ImageryLayer | null; pending: boolean }>();
  const syncLayers = () => {
    const s = store.getState();
    if (!s.manifest) return;
    for (const info of s.manifest.layers) {
      const want = !!s.layers[info.id];
      const cur = own.get(info.id);
      if (want && !cur) {
        own.set(info.id, { layer: null, pending: true });
        void C.SingleTileImageryProvider.fromUrl(`/data/global/${info.file}`, { rectangle: C.Rectangle.fromDegrees(-180, -90, 180, 90), credit: new C.Credit(info.credit, false) })
          .then((p) => {
            const rec = own.get(info.id);
            if (!rec || !store.getState().layers[info.id]) { own.delete(info.id); return; }
            rec.layer = scene.imageryLayers.addImageryProvider(p); rec.layer.alpha = 0.68; rec.pending = false;
          }).catch(() => own.delete(info.id));
      } else if (!want && cur) {
        if (cur.layer) scene.imageryLayers.remove(cur.layer, true);
        own.delete(info.id);
      }
    }
  };
  const unsubLayers = store.subscribe(syncLayers);
  syncLayers();

  /* ------------------------------------------------------------ input: hover, click, double click */
  const handler = new C.ScreenSpaceEventHandler(canvas);
  const globeMode = () => store.getState().mode === 'globe';
  let lastHover = 0;
  const onMove = (e: PointerEvent) => {
    if (!globeMode() || e.buttons) return;
    const now = performance.now();
    if (now - lastHover < 66) return;
    lastHover = now;
    const r = canvas.getBoundingClientRect();
    const p = pickGround(e.clientX - r.left, e.clientY - r.top);
    store.getState().setHovered(p ? { lon: p.lon, lat: p.lat } : null);
  };
  const onLeave = () => store.getState().setHovered(null);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', onLeave);
  const stopFlightOnInput = () => { if (st.flying) cancelFlight(); landing.releaseFollow(); };
  canvas.addEventListener('pointerdown', stopFlightOnInput);
  canvas.addEventListener('wheel', stopFlightOnInput, { passive: true });

  const emitPick = async (kind: 'click' | 'dblclick', x: number, y: number) => {
    // right after load the terrain under the pointer may not be pickable yet: retry each frame for up to 2 s, then take
    // the point on the Mars ellipsoid (elevation still comes from the terrain sample below), so the first click after
    // load is never dropped (QA round 2, item 21)
    const p = (await retryEachFrame(() => pickGround(x, y), ctx.onFrame, PICK_RETRY_MS)) ?? pickEllipsoid(x, y);
    if (!p) return null;
    const sampled = await sampleOne(p);
    const h = sampled ?? p.height;
    store.getState().pick({ lon: p.lon, lat: p.lat, elevationM: Number.isFinite(h) ? Math.round(elevationFromHeight(h)) : null, kind, altitudeKm: st.altKm, at: Date.now() });
    return p;
  };
  handler.setInputAction((m: { position: CesiumNS.Cartesian2 }) => { if (globeMode()) void emitPick('click', m.position.x, m.position.y); }, C.ScreenSpaceEventType.LEFT_CLICK);
  handler.setInputAction((m: { position: CesiumNS.Cartesian2 }) => {
    if (!globeMode()) return;
    const x = m.position.x, y = m.position.y;
    const p = pickGround(x, y);
    void emitPick('dblclick', x, y);
    if (!p) return;
    const from = view();
    const dist = C.Cartesian3.distance(camera.positionWC, p.world);
    void flyView({ lon: p.lon, lat: p.lat }, { rangeM: Math.max(dist * 0.35, 900), pitchDeg: from && st.altKm < 400 ? C.Math.toDegrees(camera.pitch) : pitchForAltitudeKm(st.altKm * 0.35) });
  }, C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  /* ------------------------------------------------------------ Scout projection */
  const occluder = new C.EllipsoidalOccluder(MARS, C.Cartesian3.ZERO);
  const project = (p: LonLat): Screen => {
    const h = groundHeight(C.Math.toRadians(p.lon), C.Math.toRadians(p.lat)) ?? datum;
    const w = C.Cartesian3.fromDegrees(p.lon, p.lat, h, MARS);
    occluder.cameraPosition = camera.positionWC;
    const s = scene.cartesianToCanvasCoordinates(w, scratch.c2);
    const r = canvas.getBoundingClientRect();
    if (!s) return { x: 0, y: 0, visible: false };
    return { x: r.left + s.x, y: r.top + s.y, visible: occluder.isPointVisible(w) };
  };

  /* ------------------------------------------------------------ debug / QA hook */
  const dbg: PlanetDebug = {
    Cesium: C, scene, widget, handoff: true,
    view: (lon, lat, altKm, opts = {}) => flyView({ lon, lat }, { altKm, pitchDeg: opts.pitchDeg, headingDeg: opts.headingDeg, instant: opts.instant }),
    datumCheck: async (pts) => (await sample(pts)),
    stats: () => ({
      altKm: st.altKm, rangeM: st.rangeM,
      tilesLoaded: globe.tilesLoaded, terrainLevels: (scene.terrainProvider as { availability?: { _maximumLevel?: number } }).availability?._maximumLevel ?? 0,
      imageryFailures: imagery.failures(), fuseThreads: imagery.threads(),
    }),
  };

  const destroy = () => {
    unsubFlight(); unsubLayers();
    scene.preRender.removeEventListener(preRender); scene.postRender.removeEventListener(postRender);
    canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', stopFlightOnInput); canvas.removeEventListener('wheel', stopFlightOnInput);
    handler.destroy(); landing.dispose(); overlays.dispose(); ctx.labels.destroy();
    widget.destroy(); imagery.destroy();
  };

  return {
    destroy, debug: dbg, project,
    setActive: (a) => { st.active = a; widget.useDefaultRenderLoop = a; if (a) { widget.resize(); } },
  };
}

export { JEZERO_CENTER };
