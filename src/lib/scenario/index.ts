/**
 * Landing scenario adapter. `runLandingScenario(req)` tries the Rust/WASM engine (if one was registered by the
 * wasm wrapper in ./wasm) and falls back to the deterministic TypeScript engine. Slope data is registered once
 * by the app: `registerScenarioSources({ jezero20m, global })`.
 */
import type { LandingScenarioRequest, LandingScenarioResult } from '../globeContracts';
import { runScenarioTs } from './engine';
import type { ScenarioOptions, ScenarioWasmEngine, SlopeSource } from './types';

export * from './types';
export { runScenarioTs, sampleOffset, offsetToLonLat, wrapLon, MAX_RENDER_POINTS } from './engine';
export { createRng } from './prng';
export { gridSlopeSource, jezeroSlopeSource } from './sources';
export { enableScenarioWasm } from './wasmAdapter';
export { walkScenario } from './walk';
export type { WalkScenarioResult, DemBounds } from './walk';
export { putScenario, getScenario, clearScenarios } from './store';
export * from './verdict';
export * from './outcome';
export * from './playback';
export * from './drawScale';
export type { StoredScenario } from './store';

const sources: { jezero20m?: SlopeSource; global?: SlopeSource } = {};
let wasm: ScenarioWasmEngine | null = null;
let wasmLoader: (() => Promise<ScenarioWasmEngine>) | null = null;

export function registerScenarioSources(s: { jezero20m?: SlopeSource; global?: SlopeSource }) {
  if (s.jezero20m) sources.jezero20m = s.jezero20m;
  if (s.global) sources.global = s.global;
}
export const hasScenarioSource = (dem: LandingScenarioRequest['dem']) => !!sources[dem === 'jezero20m' ? 'jezero20m' : 'global'];

/** Called by the WASM wrapper once it has initialised: `registerWasmEngine({ run })`. */
export function registerWasmEngine(engine: ScenarioWasmEngine | null) { wasm = engine; }
/** Lazy variant: the loader runs on the first scenario (e.g. `() => import('./wasm').then(m => m.createEngine())`). */
export function setWasmLoader(loader: (() => Promise<ScenarioWasmEngine>) | null) { wasmLoader = loader; wasm = null; }

export async function runLandingScenario(req: LandingScenarioRequest, opts: ScenarioOptions = {}): Promise<LandingScenarioResult> {
  const source = req.dem === 'jezero20m' ? sources.jezero20m : sources.global;
  if (!source) throw new Error(`No slope data registered for dem "${req.dem}".`);
  const full = { distribution: opts.distribution ?? 'gaussian' } as const;
  if (!wasm && wasmLoader) {
    try { wasm = await wasmLoader(); } catch { wasmLoader = null; }
  }
  const grid = wasm ? source.grid?.() ?? null : null;
  if (wasm && grid) {
    try {
      const res = await wasm.run(req, grid, full);
      if (res && Number.isFinite(res.okFraction) && res.points instanceof Float32Array) return { ...res, engine: 'wasm' };
    } catch { /* fall through to the TS engine */ }
  }
  return runScenarioTs(req, source, full);
}
