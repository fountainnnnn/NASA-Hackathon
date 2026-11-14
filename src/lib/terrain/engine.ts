import type { Dem, HazardSegment, LonLat, PlanningGrid, RouteResult, TerrainAnalysis } from '@/lib/contracts';
import { computeSlopeField } from './slope';
import { buildPlanningGrid } from './grid';
import { nearestReachable, planRoute, type NearestReachable, type PlanRequest } from './route';
import { findHazards } from './hazards';
import { analyzeTerrain } from './analyze';

export interface TerrainEngine {
  readonly grid: PlanningGrid;
  readonly info: { gridWidth: number; gridHeight: number; cellResM: number };
  planRoute(req: PlanRequest): ReturnType<typeof planRoute>;
  nearestReachable(req: { from: LonLat; to: LonLat; maxSlopeDeg: number; maxRadiusM?: number }): NearestReachable;
  analyze(req: { center: LonLat; radiusM: number; limitDeg: number }): TerrainAnalysis;
  hazards(req: { route: RouteResult; k: number; limitDeg: number }): Omit<HazardSegment, 'routeId'>[];
  /** Returns the engine's own array; do not mutate. */
  slopeField(): Float32Array;
}

/** Synchronous in-process terrain engine (used by tests, and as the SSR / no-Worker fallback). */
export function createTerrainEngine(dem: Dem): TerrainEngine {
  const slope = computeSlopeField(dem);
  const grid = buildPlanningGrid(dem, slope);
  return {
    grid,
    info: { gridWidth: grid.width, gridHeight: grid.height, cellResM: grid.cellResM },
    planRoute: (req) => planRoute(grid, req),
    nearestReachable: (req) => nearestReachable(grid, req.from, req.to, req.maxSlopeDeg, req.maxRadiusM),
    analyze: (req) => analyzeTerrain(dem, slope, req),
    hazards: ({ route, k, limitDeg }) => findHazards(route, k, limitDeg),
    slopeField: () => slope,
  };
}
