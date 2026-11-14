/* tslint:disable */
/* eslint-disable */

/**
 * Monte-Carlo touchdown scatter.
 *
 * Returns `[ok_fraction, nodata_fraction, p50, p95, n_kept, (lon, lat, slope) x n_kept]`.
 * * `ok_fraction`: touchdowns with valid slope <= `max_slope_deg`, over all `samples`.
 * * `nodata_fraction`: touchdowns outside the grid or touching NaN cells, over all `samples`.
 * * `p50`/`p95`: slope percentiles over valid samples only (0.1 degree histogram, NaN if none valid).
 * * kept points are the first `min(keep_points, samples)` draws (iid, so unbiased); slope is NaN for nodata.
 * Deterministic for a given `seed` (xoshiro256** seeded by splitmix64).
 */
export function landing_monte_carlo(slope: Float32Array | number[], width: number, height: number, lon_min: number, lat_max: number, dlon: number, dlat: number, center_lon: number, center_lat: number, semi_major_km: number, semi_minor_km: number, azimuth_deg: number, samples: number, max_slope_deg: number, seed: bigint, keep_points: number): Float32Array;

/**
 * Horn slope field; see `slope_field_core`. Matches `computeSlopeField` in src/lib/terrain/slope.ts.
 */
export function slope_field(elev: Float32Array | number[], width: number, height: number, lat_max: number, dlat: number, dlon: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly landing_monte_carlo: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: bigint, q: number) => [number, number];
    readonly slope_field: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
