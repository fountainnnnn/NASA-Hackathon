import type * as THREE from 'three';
import type { DemMeta, Dem, GeoApi } from '@/lib/contracts';
import { emitClickPoint } from '@/state/companion';
import { useHover } from '@/state/ui';
import { useWorld, world } from '@/state/world';

/** The Ops pointer tools (drag to plan, lasso) set `until` so the click a drag ends on does not also pick a point. */
export const clickGuard = { until: 0 };

/** Label of a selected point that lies on the regional context terrain, outside the 20 m DEM. */
export const OUTSIDE_LABEL = 'Outside high-resolution coverage';
/** Shown when a high-resolution-only action (routing) is asked for such a point. */
export const NEEDS_HIRES_MESSAGE = 'Routes need the high-resolution Jezero area. Pick a point inside it.';

export interface Bounds { lonMin: number; lonMax: number; latMin: number; latMax: number }
export const insideBounds = (b: Bounds, lon: number, lat: number) => lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax;

interface PickRuntime { meta: DemMeta; dem: Dem; geo: Pick<GeoApi, 'toLonLat' | 'sampleElevation'>; context: { dem: Dem } | null }

/** Elevation for a lon/lat: the 20 m DEM inside its bounds, otherwise the ~463 m MOLA context grid (null if neither). */
export function elevationAt(rt: PickRuntime, lon: number, lat: number): { elev: number | null; coarse: boolean } {
  if (insideBounds(useWorld.getState().bounds, lon, lat)) return { elev: rt.geo.sampleElevation(rt.dem, lon, lat), coarse: false };
  return { elev: rt.context ? rt.geo.sampleElevation(rt.context.dem, lon, lat) : null, coarse: true };
}

export function hoverPoint(rt: PickRuntime, p: THREE.Vector3) {
  const { lon, lat } = rt.geo.toLonLat(rt.meta, p.x, p.z);
  useHover.getState().set({ lon, lat, elev: elevationAt(rt, lon, lat).elev });
}

/** Select the clicked ground point. Outside the high-resolution DEM it is still selected, but clearly labelled. */
export function pickPoint(rt: PickRuntime, p: THREE.Vector3) {
  if (performance.now() < clickGuard.until) return;
  const { lon, lat } = rt.geo.toLonLat(rt.meta, p.x, p.z);
  if (insideBounds(useWorld.getState().bounds, lon, lat)) {
    world.setSelected(world.makePoint(lon, lat, 'pick', 'Selected point'));
  } else {
    const pt = world.makePoint(lon, lat, 'pick', OUTSIDE_LABEL); // high-res sample is null out here
    world.setSelected({ ...pt, elevationM: elevationAt(rt, lon, lat).elev });
  }
  emitClickPoint({ lon, lat }); // Scout (orchestrator) answers
}
