import type { LandingScenarioResult } from '../globeContracts';
import { setWasmLoader } from './index';
import type { ScenarioWasmEngine } from './types';

/**
 * Wires the Rust/WASM crate (./wasm/loader.ts) into runLandingScenario. Call once on the client:
 * `enableScenarioWasm()`. The WASM engine only handles non-wrapping grids (Jezero 20 m); anything else, or any
 * failure, makes runLandingScenario fall back to the TypeScript engine. Note: the two engines use different
 * PRNGs, so the same seed gives statistically equivalent but not identical samples across engines.
 */
export function enableScenarioWasm(): void {
  setWasmLoader(async () => {
    const { loadScenarioWasm } = await import('./wasm/loader');
    const w = await loadScenarioWasm();
    if (!w) throw new Error('scenario wasm unavailable');
    const engine: ScenarioWasmEngine = {
      run(req, grid) {
        if (grid.wrapLon) throw new Error('wasm engine does not wrap longitude');
        const t0 = performance.now();
        const raw = w.landingMonteCarlo(req, { slope: grid.slope, width: grid.width, height: grid.height, lonMin: grid.lonMin, latMax: grid.latMax, dLon: grid.dLon, dLat: grid.dLat });
        const res: LandingScenarioResult = {
          samples: req.samples, okFraction: raw.okFraction, slopeP50: raw.slopeP50, slopeP95: raw.slopeP95, nodataFraction: raw.nodataFraction,
          points: raw.points, engine: 'wasm', computeMs: performance.now() - t0, demResM: grid.demResM,
        };
        return res;
      },
    };
    return engine;
  });
}
