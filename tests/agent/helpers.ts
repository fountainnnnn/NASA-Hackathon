import { vi } from 'vitest';
import { DEFAULT_CONSTRAINTS } from '../../src/lib/contracts';
import type { MissionConstraints, RouteResult, SceneCommand, ToolDeps, WorldPoint } from '../../src/lib/contracts';

export const pt = (lon: number, lat: number, id = 'p'): WorldPoint => ({ id, lon, lat, elevationM: -2500.4, x: 0, z: 0, source: 'pick' });

export function mockDeps(opts: { selected?: WorldPoint | null } = {}) {
  let constraints: MissionConstraints = { ...DEFAULT_CONSTRAINTS };
  const routes: RouteResult[] = [];
  const applied: SceneCommand[][] = [];
  const base = pt(77.45, 18.44, 'base');
  const selected = opts.selected === undefined ? pt(77.5, 18.5, 'sel') : opts.selected;
  const planRoute = vi.fn(async (req: { constraints: MissionConstraints; roundTrip?: boolean }) => ({
    roundTrip: true,
    legs: [{ path: [{ lon: 77.45, lat: 18.44, h: 1 }, { lon: 77.5, lat: 18.5, h: 2 }], lengthM: 7312.4, horizM: 7300, ascentM: 40, descentM: 30, maxSlopeDeg: 11.26, timeMin: 95.4, segSlopeDeg: [11.26] }],
    totals: { lengthM: 7312.4, ascentM: 40, descentM: 30, maxSlopeDeg: 11.26, walkMin: 95.4, evaMin: 125.4, batteryUsedPct: 34.24, climbWorkKJ: 120 },
    feasible: true, reasons: [], minFeasibleSlopeDeg: null, turnBackIndex: null,
    constraintsUsed: req.constraints, gridResM: 40, demResM: 20, computeMs: 5,
  }));
  const world = {
    snapshot: () => ({
      selected, base, constraints, layers: { ctx: true, themisDay: false, themisNight: false, geology: false, slope: false, traverse: true, ellipse: false },
      routes: routes.map((r) => ({ id: r.id, label: r.label, feasible: r.feasible, reasons: r.reasons, totals: r.totals })),
      visibleRouteIds: routes.map((r) => r.id), annotations: [], cameraTarget: null,
      demBounds: { lonMin: 77, lonMax: 78, latMin: 18, latMax: 19 },
    }),
    setSelected: vi.fn(), setBase: vi.fn(),
    setConstraints: vi.fn((c: Partial<MissionConstraints>) => (constraints = { ...constraints, ...c })),
    addRoute: vi.fn((r: Omit<RouteResult, 'id'>) => { const full = { ...r, id: `R${routes.length + 1}` } as RouteResult; routes.push(full); return full; }),
    getRoute: (id: string) => routes.find((r) => r.id === id),
    applyCommands: vi.fn((c: SceneCommand[]) => { applied.push(c); return { applied: c.length, errors: [] }; }),
    makePoint: vi.fn((lon: number, lat: number, source: WorldPoint['source'], label?: string) => ({ ...pt(lon, lat, 'mk'), source, label })),
  };
  const terrain = {
    init: vi.fn(), planRoute, hazards: vi.fn(async () => []), slopeField: vi.fn(),
    analyze: vi.fn(async () => ({ center: { lon: 77.5, lat: 18.5 }, radiusM: 500, elevationM: -2500, reliefM: 80.4, slopeMeanDeg: 6.12, slopeP90Deg: 12, slopeMaxDeg: 20, pctAboveLimit: 4.44, limitDeg: 15, validPct: 100, demResM: 20, note: 'ok' })),
  };
  const science = {
    load: vi.fn(), geologyAt: vi.fn(() => ({ symbol: 'Cf', name: 'Crater floor', description: 'd', interpretation: 'i', source: { title: 'USGS SIM 3464', authors: '', year: 2020, url: '', scale: '' } })),
    namesNear: vi.fn(() => []), nearestTraverse: vi.fn(() => ({ sol: 12, lon: 77.4, lat: 18.4, distanceM: 812.3 })),
    sitesNear: vi.fn(() => []), suggestStops: vi.fn(() => []), roverImagesNear: vi.fn(async () => null), unitList: vi.fn(() => []),
  };
  const deps = { world, terrain, science } as unknown as ToolDeps;
  return { deps, world, terrain, science, applied, routes };
}
