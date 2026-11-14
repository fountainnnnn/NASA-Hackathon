/**
 * Agent tools: zod schemas, descriptions and deterministic executors. Importable on the server
 * (no browser globals). Every number the LLM may quote comes out of these executors.
 */
import { z } from 'zod';
import { G_MARS } from '../contracts';
import type {
  LonLat, MissionConstraints, Provenance, RouteResult, SceneCommand, ToolDeps, WorldPoint, WorldSnapshot,
} from '../contracts';

/* ------------------------------------------------------------------ helpers */

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;
const rc = (x: number) => Math.round(x * 1e5) / 1e5;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const prov = (kind: Provenance, source: string) => ({ kind, source });

const SRC_DEM = 'MRO CTX DEM via JPL Mars Trek';
const SRC_GEO = 'USGS SIM 3464';
const SRC_NAMES = 'IAU nomenclature via JPL Mars Trek';
const SRC_TRAV = 'NASA MMGIS Perseverance traverse';

class ToolError extends Error {
  constructor(public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/* ------------------------------------------------------------------ schemas */

const lonS = z.number().min(-180).max(180);
const latS = z.number().min(-90).max(90);
const LonLatSchema = z.object({ lon: lonS, lat: latS });
const TargetSchema = z
  .union([z.enum(['selected', 'base']), LonLatSchema])
  .describe("'selected' (the clicked point), 'base', or {lon,lat} in degrees (east-positive)");
type Target = z.infer<typeof TargetSchema>;

const ObjectiveSchema = z.enum(['delta-sediments', 'crater-floor', 'rim-bedrock', 'aeolian', 'astrobiology-samples']);
const LayerSchema = z.enum(['ctx', 'themisDay', 'themisNight', 'geology', 'slope', 'traverse', 'ellipse']);

/** Mirrors the SceneCommand union in contracts.ts exactly. */
export const SceneCommandSchema: z.ZodType<SceneCommand> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add_pin'), id: z.string().max(64).optional(), lon: lonS, lat: latS,
    label: z.string().min(1).max(80), kind: z.enum(['science', 'hazard', 'info', 'base']),
  }),
  z.object({ type: z.literal('draw_route'), routeId: z.string(), style: z.enum(['primary', 'alternate']).optional() }),
  z.object({
    type: z.literal('highlight_segment'), routeId: z.string(), leg: z.number().int().min(0),
    startIdx: z.number().int().min(0), endIdx: z.number().int().min(0), label: z.string().min(1).max(80),
  }),
  z.object({ type: z.literal('show_elevation_profile'), routeId: z.string() }),
  z.object({ type: z.literal('focus_camera'), lon: lonS, lat: latS, distanceM: z.number().positive().max(100000).optional() }),
  z.object({ type: z.literal('set_layer_visibility'), layer: LayerSchema, visible: z.boolean() }),
  z.object({ type: z.literal('remove_annotation'), id: z.string() }),
  z.object({ type: z.literal('show_comparison'), routeIds: z.tuple([z.string(), z.string()]) }),
  z.object({ type: z.literal('clear_annotations') }),
]);

export const ConstraintsPatchSchema = z
  .object({
    maxSlopeDeg: z.number().min(5).max(40).optional(),
    batteryReservePct: z.number().min(0).max(80).optional(),
    objective: z.enum(['shortest', 'fastest']).optional(),
    evaMaxMin: z.number().min(30).max(480).optional(),
    dwellMin: z.number().min(0).max(180).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'provide at least one constraint' });

const PlanRouteSchema = z.object({
  from: TargetSchema.default('base'),
  to: TargetSchema,
  roundTrip: z.boolean().default(true),
  stops: z.array(TargetSchema).max(4).optional().describe('intermediate waypoints visited in order'),
  label: z.string().max(60).optional(),
});
const PlanMultiSchema = z.object({
  stops: z.array(TargetSchema).min(1).max(5).describe('visited in order from base; the last one is the destination'),
  roundTrip: z.boolean().default(true),
  label: z.string().max(60).optional(),
});

/* ------------------------------------------------------------------ point resolution */

function inBounds(snap: WorldSnapshot, p: LonLat) {
  const b = snap.demBounds;
  return p.lon >= b.lonMin && p.lon <= b.lonMax && p.lat >= b.latMin && p.lat <= b.latMax;
}

function resolvePoint(t: Target, deps: ToolDeps, label?: string): WorldPoint {
  const snap = deps.world.snapshot();
  if (t === 'selected') {
    if (!snap.selected) throw new ToolError('no_selected_point', 'No point is selected. Ask the user to click the terrain.');
    return snap.selected;
  }
  if (t === 'base') {
    if (!snap.base) throw new ToolError('no_base', 'No base is set.');
    return snap.base;
  }
  if (!inBounds(snap, t)) {
    throw new ToolError('out_of_bounds', 'That coordinate is outside the loaded terrain tile. No verified data available there.', { demBounds: snap.demBounds });
  }
  return deps.world.makePoint(t.lon, t.lat, 'agent', label);
}

const ll = (p: LonLat): LonLat => ({ lon: p.lon, lat: p.lat });
const pointBrief = (p: WorldPoint | null) =>
  p ? { lon: rc(p.lon), lat: rc(p.lat), elevationM: p.elevationM == null ? null : r0(p.elevationM), label: p.label } : null;

/* ------------------------------------------------------------------ route summaries */

const REASON_TEXT: Record<string, string> = {
  no_path_slope: 'No path exists within the maximum slope limit.',
  battery_reserve: 'Battery would drop below the reserve before the route is complete.',
  eva_time: 'Total EVA time exceeds the EVA limit.',
  nodata_endpoint: 'An endpoint has no valid terrain data.',
  out_of_bounds: 'An endpoint is outside the terrain tile.',
};

const roundTotals = (t: RouteResult['totals']) => ({
  lengthM: r0(t.lengthM), ascentM: r0(t.ascentM), descentM: r0(t.descentM), maxSlopeDeg: r1(t.maxSlopeDeg),
  walkMin: r0(t.walkMin), evaMin: r0(t.evaMin), batteryUsedPct: r1(t.batteryUsedPct), climbWorkKJ: r0(t.climbWorkKJ),
});
const constraintsBrief = (c: MissionConstraints) => ({
  maxSlopeDeg: c.maxSlopeDeg, batteryReservePct: c.batteryReservePct, objective: c.objective, evaMaxMin: c.evaMaxMin, dwellMin: c.dwellMin,
});
const ASSUMPTION_NOTE =
  'Feasible under the assumed model only (assumed suit power, battery capacity, crew mass and walking-speed factor; 20 m DEM). Not a certified plan.';

function summarizeRoute(r: RouteResult) {
  return {
    id: r.id,
    label: r.label,
    feasible: r.feasible,
    reasons: r.reasons,
    reasonText: r.reasons.map((x) => REASON_TEXT[x] ?? x),
    roundTrip: r.roundTrip,
    from: pointBrief(r.from),
    to: pointBrief(r.to),
    stopCount: r.stops?.length ?? 0,
    totals: roundTotals(r.totals),
    minFeasibleSlopeDeg: r.minFeasibleSlopeDeg ?? null,
    turnBack: r.turnBackIndex ?? null,
    legs: r.legs.map((l, i) => ({
      leg: i, lengthM: r0(l.lengthM), maxSlopeDeg: r1(l.maxSlopeDeg), timeMin: r0(l.timeMin), segments: l.segSlopeDeg.length,
    })),
    constraintsUsed: constraintsBrief(r.constraintsUsed),
    provenance: { totals: prov('computed', `route solver on ${SRC_DEM} (${r.demResM} m DEM)`), assumptions: prov('assumption', ASSUMPTION_NOTE) },
  };
}

function applyScene(deps: ToolDeps, cmds: SceneCommand[]) {
  return deps.world.applyCommands(cmds);
}

async function planCore(
  args: { from: Target; to: Target; roundTrip: boolean; stops?: Target[]; label?: string },
  deps: ToolDeps,
) {
  const snap = deps.world.snapshot();
  const constraints = snap.constraints;
  const previousRouteId = snap.routes.length ? snap.routes[snap.routes.length - 1].id : null;
  const from = resolvePoint(args.from, deps, 'Start');
  const to = resolvePoint(args.to, deps, 'Destination');
  const stops = (args.stops ?? []).map((s, i) => resolvePoint(s, deps, `Stop ${i + 1}`));
  const res = await deps.terrain.planRoute({
    from: ll(from), to: ll(to), stops: stops.length ? stops.map(ll) : undefined, roundTrip: args.roundTrip, constraints,
  });
  const label = args.label ?? `${args.roundTrip ? 'Round trip' : 'One way'} to ${rc(to.lat)}, ${rc(to.lon)}`;
  const route = deps.world.addRoute({ ...res, label, from, to, stops: stops.length ? stops : undefined });
  let scene: { applied: number; errors: string[] } | null = null;
  if (route.legs.some((l) => l.path.length > 1)) {
    scene = applyScene(deps, [
      { type: 'draw_route', routeId: route.id, style: 'primary' },
      { type: 'show_elevation_profile', routeId: route.id },
    ]);
  }
  return {
    ...summarizeRoute(route),
    previousRouteId,
    hint: previousRouteId ? `Call compare_routes with [${previousRouteId}, ${route.id}] if constraints changed.` : undefined,
    scene: scene ?? { applied: 0, errors: ['route has no drawable path'] },
  };
}

/* ------------------------------------------------------------------ snapshot */

export function compactSnapshot(s: WorldSnapshot) {
  return {
    selected: pointBrief(s.selected),
    base: pointBrief(s.base),
    constraints: s.constraints,
    layersVisible: (Object.keys(s.layers) as (keyof typeof s.layers)[]).filter((k) => s.layers[k]),
    routes: s.routes.map((r) => ({ id: r.id, label: r.label, feasible: r.feasible, reasons: r.reasons, totals: roundTotals(r.totals) })),
    visibleRouteIds: s.visibleRouteIds,
    annotations: s.annotations.slice(0, 10).map((a) => ({ id: a.id, kind: a.kind, label: a.label, lon: rc(a.lon), lat: rc(a.lat) })),
    cameraTarget: s.cameraTarget ? { lon: rc(s.cameraTarget.lon), lat: rc(s.cameraTarget.lat) } : null,
    demBounds: s.demBounds,
  };
}

/* ------------------------------------------------------------------ tool registry */

interface ToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (args: any, deps: ToolDeps) => unknown | Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Smaller view sent back to the LLM (the full result still goes to the UI/HUD). */
  compact?: (result: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}
function defineTool<S extends z.ZodType>(d: {
  name: string; description: string; schema: S;
  run: (args: z.output<S>, deps: ToolDeps) => unknown | Promise<unknown>;
  compact?: (result: any) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}): ToolDef {
  return d as ToolDef;
}

const NO_ARGS = z.object({});

export const TOOLS: ToolDef[] = [
  defineTool({
    name: 'get_scene_context',
    description: 'Current scene: selected point, base, mission constraints, existing routes, visible layers, annotations.',
    schema: NO_ARGS,
    run: (_a, deps) => ({ ...compactSnapshot(deps.world.snapshot()), provenance: prov('computed', 'app state') }),
  }),

  defineTool({
    name: 'get_location_context',
    description: 'Facts about a point: coordinates, elevation, geologic unit, nearby named features (5 km), nearest Perseverance traverse point, data coverage.',
    schema: z.object({ target: TargetSchema }),
    run: ({ target }, deps) => {
      const p = resolvePoint(target, deps);
      const at = ll(p);
      const geo = deps.science.geologyAt(at);
      const names = deps.science.namesNear(at, 5, 5);
      const trav = deps.science.nearestTraverse(at);
      const inside = inBounds(deps.world.snapshot(), at);
      return {
        point: { lon: rc(p.lon), lat: rc(p.lat), label: p.label },
        elevationM: p.elevationM == null ? null : r0(p.elevationM),
        elevationNote: 'metres above the Mars areoid',
        geology: geo
          ? { symbol: geo.symbol, name: geo.name, description: clip(geo.description, 300), interpretation: clip(geo.interpretation, 300), source: geo.source.title }
          : null,
        namedFeaturesNear: names.map((n) => ({ name: n.name, type: n.type, distanceKm: r1(n.distanceKm), bearingDeg: r0(n.bearingDeg) })),
        nearestRoverTraverse: trav ? { sol: trav.sol, distanceM: r0(trav.distanceM), lon: rc(trav.lon), lat: rc(trav.lat) } : null,
        coverage: inside
          ? 'Inside the loaded terrain tile (20 m DEM posting).'
          : 'Outside the loaded terrain tile. No verified data available.',
        missing: [
          p.elevationM == null ? 'elevation' : null, geo ? null : 'geology', trav ? null : 'traverse',
        ].filter(Boolean),
        provenance: {
          elevation: p.elevationM == null ? prov('unavailable', SRC_DEM) : prov('observed', SRC_DEM),
          geology: geo ? prov('observed', geo.source.title || SRC_GEO) : prov('unavailable', SRC_GEO),
          names: prov('observed', SRC_NAMES),
          traverse: trav ? prov('observed', SRC_TRAV) : prov('unavailable', SRC_TRAV),
        },
      };
    },
  }),

  defineTool({
    name: 'find_science_context',
    description: 'Curated NASA science sites within a radius of a point (with source links).',
    schema: z.object({ target: TargetSchema, radiusKm: z.number().positive().max(15).default(5) }),
    run: ({ target, radiusKm }, deps) => {
      const p = resolvePoint(target, deps);
      const sites = deps.science.sitesNear(ll(p), radiusKm).slice(0, 6);
      const geo = deps.science.geologyAt(ll(p));
      return {
        center: { lon: rc(p.lon), lat: rc(p.lat) },
        radiusKm,
        geologyHere: geo ? { symbol: geo.symbol, name: geo.name } : null,
        sites: sites.map((s) => ({
          id: s.id, name: s.name, lon: rc(s.lon), lat: rc(s.lat), distanceKm: r1(s.distanceKm), objectives: s.objectives,
          summary: clip(s.summary, 240), sourceTitle: s.sourceTitle, sourceUrl: s.sourceUrl, mission: s.mission,
        })),
        note: sites.length ? undefined : 'No verified data available (no curated science site in this radius).',
        provenance: { sites: sites.length ? prov('observed', 'NASA mission publications (see sourceTitle)') : prov('unavailable', 'curated science sites'), geology: geo ? prov('observed', geo.source.title || SRC_GEO) : prov('unavailable', SRC_GEO) },
      };
    },
  }),

  defineTool({
    name: 'get_rover_images_near',
    description: 'Perseverance raw images taken near a point (ids, URLs, sol, camera). The UI shows them.',
    schema: z.object({ target: TargetSchema, maxDistanceM: z.number().positive().max(2000).default(1000) }),
    run: async ({ target, maxDistanceM }, deps) => {
      const p = resolvePoint(target, deps);
      const res = await deps.science.roverImagesNear(ll(p), maxDistanceM, 6);
      if (!res || res.images.length === 0) {
        return { images: [], note: 'No verified data available (no rover images within that distance).', provenance: prov('unavailable', 'Perseverance raw images') };
      }
      const images = res.images.map((i) => ({ id: i.id, url: i.url, pageUrl: i.pageUrl, sol: i.sol, earthDate: i.earthDate, camera: i.camera, credit: i.credit }));
      return {
        sol: res.sol,
        distanceM: r0(res.distanceM),
        images,
        display: { kind: 'rover_images', ids: images.map((i) => i.id) },
        provenance: prov('observed', `Perseverance raw images, sol ${res.sol}`),
      };
    },
  }),

  defineTool({
    name: 'analyze_terrain',
    description: 'Slope and relief statistics in a circle around a point, versus the current max-slope limit.',
    schema: z.object({ target: TargetSchema, radiusM: z.number().min(50).max(3000).default(500) }),
    run: async ({ target, radiusM }, deps) => {
      const p = resolvePoint(target, deps);
      const limitDeg = deps.world.snapshot().constraints.maxSlopeDeg;
      const a = await deps.terrain.analyze({ center: ll(p), radiusM, limitDeg });
      return {
        center: { lon: rc(p.lon), lat: rc(p.lat) },
        radiusM,
        elevationM: a.elevationM == null ? null : r0(a.elevationM),
        reliefM: r0(a.reliefM),
        slopeMeanDeg: r1(a.slopeMeanDeg), slopeP90Deg: r1(a.slopeP90Deg), slopeMaxDeg: r1(a.slopeMaxDeg),
        limitDeg: a.limitDeg, pctAboveLimit: r1(a.pctAboveLimit), validPct: r1(a.validPct), demResM: a.demResM,
        note: a.note,
        provenance: prov('computed', `slope statistics from ${SRC_DEM}, ${a.demResM} m posting`),
      };
    },
  }),

  defineTool({
    name: 'set_mission_constraints',
    description: 'Change mission limits (partial update). Follow with plan_route and compare_routes when the user changes a limit.',
    schema: ConstraintsPatchSchema,
    run: (patch, deps) => {
      const before = deps.world.snapshot().constraints;
      const after = deps.world.setConstraints(patch);
      const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => before[k] !== after[k]);
      return {
        constraints: constraintsBrief(after),
        changed: changed.map((k) => ({ field: k, from: before[k], to: after[k] })),
        provenance: prov('assumption', 'user-set limits; other parameters are fixed model assumptions'),
      };
    },
  }),

  defineTool({
    name: 'suggest_science_stops',
    description: 'Candidate science stops for an objective within maxKm of the base, ranked by distance.',
    schema: z.object({ objective: ObjectiveSchema, maxKm: z.number().positive().max(15).default(8), limit: z.number().int().min(1).max(5).default(3) }),
    run: ({ objective, maxKm, limit }, deps) => {
      const base = deps.world.snapshot().base;
      if (!base) throw new ToolError('no_base', 'No base is set.');
      const stops = deps.science.suggestStops(objective, ll(base), maxKm, limit);
      return {
        objective, maxKm,
        stops: stops.map((s) => ({
          label: s.label, lon: rc(s.lon), lat: rc(s.lat), distanceKm: r1(s.distanceKm), why: clip(s.why, 200), unit: s.unit, siteId: s.siteId, sourceUrl: s.sourceUrl,
        })),
        note: stops.length ? undefined : 'No verified data available (no candidate within that range).',
        provenance: stops.length ? prov('observed', 'USGS SIM 3464 units and curated NASA science sites') : prov('unavailable', 'science stops'),
      };
    },
  }),

  defineTool({
    name: 'plan_route',
    description:
      "Plan a walking route with the CURRENT constraints (slope, battery, EVA time). Adds it to the scene and draws it with its elevation profile. 'from' defaults to base; roundTrip defaults to true.",
    schema: PlanRouteSchema,
    run: (args, deps) => planCore(args, deps),
  }),

  defineTool({
    name: 'plan_multi_stop',
    description: 'Plan a route from base through several stops in order (last stop is the destination), optionally returning to base. Draws it.',
    schema: PlanMultiSchema,
    run: (args, deps) => {
      const stops = args.stops;
      return planCore({ from: 'base', to: stops[stops.length - 1], stops: stops.slice(0, -1), roundTrip: args.roundTrip, label: args.label }, deps);
    },
  }),

  defineTool({
    name: 'compare_routes',
    description: 'Compare two routes by id: delta of every total and which one violates the CURRENT limits. Also shows the comparison in the scene.',
    schema: z.object({ routeIds: z.array(z.string()).length(2) }),
    run: ({ routeIds }, deps) => {
      const [aId, bId] = routeIds;
      const a = deps.world.getRoute(aId);
      const b = deps.world.getRoute(bId);
      if (!a || !b) throw new ToolError('route_not_found', `Route not found: ${!a ? aId : bId}.`);
      const A = roundTotals(a.totals);
      const B = roundTotals(b.totals);
      const deltas = Object.fromEntries(
        (Object.keys(A) as (keyof typeof A)[]).map((k) => [k, { [aId]: A[k], [bId]: B[k], delta: r1(B[k] - A[k]) }]),
      );
      const c = deps.world.snapshot().constraints;
      const violations = (r: RouteResult) => {
        const v: string[] = [];
        if (!r.feasible) v.push(`infeasible: ${r.reasons.join(', ') || 'unknown'}`);
        if (r.totals.maxSlopeDeg > c.maxSlopeDeg) v.push(`max slope ${r1(r.totals.maxSlopeDeg)} deg exceeds limit ${c.maxSlopeDeg} deg`);
        if (r.totals.evaMin > c.evaMaxMin) v.push(`EVA ${r0(r.totals.evaMin)} min exceeds limit ${c.evaMaxMin} min`);
        const left = 100 - r.totals.batteryUsedPct;
        if (left < c.batteryReservePct) v.push(`battery left ${r1(left)}% is below reserve ${c.batteryReservePct}%`);
        return v;
      };
      const ca = constraintsBrief(a.constraintsUsed);
      const cb = constraintsBrief(b.constraintsUsed);
      const constraintsChanged = (Object.keys(ca) as (keyof typeof ca)[])
        .filter((k) => ca[k] !== cb[k])
        .map((k) => ({ field: k, [aId]: ca[k], [bId]: cb[k] }));
      const scene = applyScene(deps, [{ type: 'show_comparison', routeIds: [aId, bId] }]);
      return {
        routes: [aId, bId], feasible: { [aId]: a.feasible, [bId]: b.feasible }, deltas, constraintsChanged,
        violatesCurrentLimits: { [aId]: violations(a), [bId]: violations(b) },
        currentLimits: constraintsBrief(c), scene,
        provenance: prov('computed', 'route solver; deltas = second minus first'),
      };
    },
  }),

  defineTool({
    name: 'find_hazard_segments',
    description: 'Steepest or slowest segments of a route (with leg/startIdx/endIdx for highlight_segment).',
    schema: z.object({ routeId: z.string(), k: z.number().int().min(1).max(5).default(3) }),
    run: async ({ routeId, k }, deps) => {
      const route = deps.world.getRoute(routeId);
      if (!route) throw new ToolError('route_not_found', `Route not found: ${routeId}.`);
      const limitDeg = deps.world.snapshot().constraints.maxSlopeDeg;
      const hz = await deps.terrain.hazards({ route, k, limitDeg });
      return {
        routeId, limitDeg,
        segments: hz.map((h) => ({
          leg: h.leg, startIdx: h.startIdx, endIdx: h.endIdx, lengthM: r0(h.lengthM), meanSlopeDeg: r1(h.meanSlopeDeg), maxSlopeDeg: r1(h.maxSlopeDeg),
          kind: h.kind, start: { lon: rc(h.start.lon), lat: rc(h.start.lat) }, end: { lon: rc(h.end.lon), lat: rc(h.end.lat) },
        })),
        note: hz.length ? undefined : 'No verified data available (no hazard segments returned).',
        provenance: prov('computed', `segment slopes from ${SRC_DEM}`),
      };
    },
  }),

  defineTool({
    name: 'issue_scene_commands',
    description:
      'Draw on the 3D scene. Allowed commands: add_pin, draw_route, highlight_segment, show_elevation_profile, focus_camera, set_layer_visibility, remove_annotation, show_comparison, clear_annotations.',
    schema: z.object({ commands: z.array(SceneCommandSchema).min(1).max(12) }),
    run: ({ commands }, deps) => {
      const r = applyScene(deps, commands);
      return { applied: r.applied, errors: r.errors, provenance: prov('computed', 'scene command allowlist') };
    },
  }),

  defineTool({
    name: 'export_mission_plan',
    description: 'Build a GeoJSON mission plan (route legs, stops, constraints, assumptions, totals, sources) for a route. The UI offers it as a download.',
    schema: z.object({ routeId: z.string() }),
    run: ({ routeId }, deps) => {
      const r = deps.world.getRoute(routeId);
      if (!r) throw new ToolError('route_not_found', `Route not found: ${routeId}.`);
      const n = r.legs.length;
      const features: unknown[] = r.legs.map((l, i) => ({
        type: 'Feature',
        properties: {
          kind: 'route_leg', routeId: r.id, leg: i, name: r.roundTrip && i === n - 1 ? 'return' : n > 1 ? `leg ${i + 1} of ${n}` : 'outbound',
          lengthM: r0(l.lengthM), maxSlopeDeg: r1(l.maxSlopeDeg), timeMin: r0(l.timeMin), ascentM: r0(l.ascentM), descentM: r0(l.descentM),
        },
        geometry: { type: 'LineString', coordinates: l.path.map((v) => [Math.round(v.lon * 1e6) / 1e6, Math.round(v.lat * 1e6) / 1e6, r1(v.h)]) },
      }));
      const pt = (p: WorldPoint, kind: string, name: string) => ({
        type: 'Feature',
        properties: { kind, name: p.label ?? name, elevationM: p.elevationM == null ? null : r0(p.elevationM) },
        geometry: { type: 'Point', coordinates: [rc(p.lon), rc(p.lat)] },
      });
      features.push(pt(r.from, 'start', 'Start'));
      (r.stops ?? []).forEach((s, i) => features.push(pt(s, 'stop', `Stop ${i + 1}`)));
      features.push(pt(r.to, 'destination', 'Destination'));
      const c = r.constraintsUsed;
      const geojson = {
        type: 'FeatureCollection',
        features,
        properties: {
          routeId: r.id, label: r.label, feasible: r.feasible, reasons: r.reasons, roundTrip: r.roundTrip,
          constraints: c, totals: roundTotals(r.totals),
          assumptions: [
            `Walking speed = Tobler hiking function x suit speed factor ${c.suitSpeedFactor}`,
            `Suit power ${c.suitPowerW} W, battery ${c.batteryWh} Wh, crew + suit + kit mass ${c.crewMassKg} kg`,
            `Mars gravity ${G_MARS} m/s2 for climb work`,
            `EVA limit ${c.evaMaxMin} min, dwell ${c.dwellMin} min, battery reserve ${c.batteryReservePct}%`,
            `Terrain from ${r.demResM} m DEM, planning grid ${r.gridResM} m`,
            ASSUMPTION_NOTE,
          ],
          sources: [SRC_DEM],
        },
      };
      return {
        geojson, download: true, filename: `marswalk-plan-${r.id}.geojson`,
        provenance: prov('computed', `route solver on ${SRC_DEM}`),
      };
    },
    compact: (res) =>
      res && res.geojson
        ? { ok: true, download: true, filename: res.filename, featureCount: res.geojson.features.length, note: 'Plan file is ready for download in the UI.' }
        : res,
  }),
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/* ------------------------------------------------------------------ OpenAI function specs */

function toParams(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export const TOOL_SPECS = TOOLS.map((t) => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: toParams(t.schema) },
}));

/* ------------------------------------------------------------------ execution */

/** Runs a tool; never throws. Errors come back as { error, message }. */
export async function executeTool(name: string, args: unknown, deps: ToolDeps): Promise<unknown> {
  const def = TOOLS_BY_NAME.get(name);
  if (!def) return { error: 'unknown_tool', message: `Unknown tool "${name}".` };
  let input = args;
  if (typeof input === 'string') {
    try {
      input = input.trim() === '' ? {} : JSON.parse(input);
    } catch {
      return { error: 'invalid_arguments', message: 'Arguments are not valid JSON.' };
    }
  }
  if (input == null) input = {};
  const parsed = def.schema.safeParse(input);
  if (!parsed.success) {
    return {
      error: 'invalid_arguments',
      message: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    };
  }
  try {
    return await def.run(parsed.data, deps);
  } catch (e) {
    if (e instanceof ToolError) return { error: e.code, message: e.message, ...(e.extra ?? {}) };
    return { error: 'tool_failed', message: e instanceof Error ? clip(e.message, 200) : 'Tool failed.' };
  }
}

/** The view of a result that is sent back to the LLM. */
export function compactForModel(name: string, result: unknown): unknown {
  const def = TOOLS_BY_NAME.get(name);
  return def?.compact ? def.compact(result) : result;
}
