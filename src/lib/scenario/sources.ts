import type { Dem } from '../contracts';
import type { ScenarioGrid, SlopeSource } from './types';

/** Slope source over a raster slope grid (nearest pixel; NaN / outside = no data). */
export function gridSlopeSource(g: ScenarioGrid): SlopeSource {
  return {
    demResM: g.demResM,
    grid: () => g,
    slopeDegAt(lon, lat) {
      let c = Math.floor((lon - g.lonMin) / g.dLon);
      if (g.wrapLon) c = ((c % g.width) + g.width) % g.width;
      const r = Math.floor((g.latMax - lat) / g.dLat);
      if (c < 0 || c >= g.width || r < 0 || r >= g.height) return null;
      const v = g.slope[r * g.width + c];
      return Number.isNaN(v) ? null : v;
    },
  };
}

/** Jezero 20 m source from the loaded DEM and the terrain engine's slope field (same layout as dem.elev). */
export function jezeroSlopeSource(dem: Dem, slopeField: Float32Array): SlopeSource {
  const m = dem.meta;
  return gridSlopeSource({
    width: m.width, height: m.height, lonMin: m.lonMin, latMax: m.latMax, dLon: m.dLon, dLat: m.dLat,
    wrapLon: false, slope: slopeField, demResM: m.nominalResM,
  });
}
