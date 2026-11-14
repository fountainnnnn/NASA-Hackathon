import type { LonLat } from '../contracts';
import type { LandingScenarioRequest, LandingScenarioResult } from '../globeContracts';

/** A source of touchdown slope (deg) at a point. `null` = no valid data (outside coverage / nodata). */
export interface SlopeSource {
  /** Posting of the underlying DEM in metres (reported as demResM). */
  demResM: number;
  slopeDegAt(lon: number, lat: number): number | null;
  /** Optional raster form, for the WASM engine. Row 0 = north, NaN = nodata. */
  grid?(): ScenarioGrid | null;
}

/** Slope raster in an equirectangular lon/lat grid; pixel-edge aligned (lonMin/latMax are outer edges). */
export interface ScenarioGrid {
  width: number; height: number;
  lonMin: number; latMax: number; dLon: number; dLat: number;
  /** true when the grid spans the full globe in longitude (wraps) */
  wrapLon: boolean;
  slope: Float32Array;
  demResM: number;
}

export interface ScenarioOptions {
  /** 'gaussian' (default): 2-D Gaussian with 3 sigma = ellipse semi-axes, truncated at the ellipse.
   *  'uniform': uniform over the ellipse area. */
  distribution?: 'gaussian' | 'uniform';
}

/** Contract implemented by the Rust/WASM crate wrapper (src/lib/scenario/wasm/). */
export interface ScenarioWasmEngine {
  run(req: LandingScenarioRequest, grid: ScenarioGrid, opts: Required<ScenarioOptions>): LandingScenarioResult | Promise<LandingScenarioResult>;
}

export type { LonLat };
