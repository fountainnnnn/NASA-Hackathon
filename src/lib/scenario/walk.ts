import type { LonLat, MissionConstraints, RouteResult, TerrainApi } from '../contracts';

export type WalkScenarioResult =
  | { status: 'out_of_bounds'; reason: string }
  | { status: 'ok'; route: Awaited<ReturnType<TerrainApi['planRoute']>> };

export interface DemBounds { lonMin: number; lonMax: number; latMin: number; latMax: number }

/** Walk scenario = the existing Jezero route planner (20 m DEM). Anywhere else: out_of_bounds. */
export async function walkScenario(
  args: { from: LonLat; to: LonLat; constraints: MissionConstraints; roundTrip?: boolean; stops?: LonLat[] },
  terrain: Pick<TerrainApi, 'planRoute'>,
  bounds: DemBounds,
): Promise<WalkScenarioResult> {
  const inside = (p: LonLat) => p.lon >= bounds.lonMin && p.lon <= bounds.lonMax && p.lat >= bounds.latMin && p.lat <= bounds.latMax;
  if (![args.from, args.to, ...(args.stops ?? [])].every(inside)) {
    return { status: 'out_of_bounds', reason: 'Walking routes are only available inside the 20 m Jezero terrain tile.' };
  }
  const route = await terrain.planRoute({
    from: args.from, to: args.to, stops: args.stops, roundTrip: args.roundTrip ?? true, constraints: args.constraints,
  });
  return { status: 'ok', route };
}
export type { RouteResult };
