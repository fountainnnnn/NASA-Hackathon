/// <reference lib="webworker" />
import type { Dem, DemMeta } from '../lib/contracts';
import { createTerrainEngine, type TerrainEngine } from '../lib/terrain/engine';

type Req = { id: number; method: 'init' | 'planRoute' | 'analyze' | 'hazards' | 'slopeField'; args: unknown[] };
const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

let engine: TerrainEngine | null = null;
const need = (): TerrainEngine => {
  if (!engine) throw new Error('terrain worker not initialised');
  return engine;
};

ctx.onmessage = (e) => {
  const { id, method, args } = e.data;
  try {
    let result: unknown;
    let transfer: Transferable[] = [];
    switch (method) {
      case 'init': {
        const d = args[0] as { meta: DemMeta; elev: Float32Array };
        engine = createTerrainEngine({ meta: d.meta, elev: d.elev } as Dem);
        result = engine.info;
        break;
      }
      case 'planRoute': result = need().planRoute(args[0] as Parameters<TerrainEngine['planRoute']>[0]); break;
      case 'analyze': result = need().analyze(args[0] as Parameters<TerrainEngine['analyze']>[0]); break;
      case 'hazards': result = need().hazards(args[0] as Parameters<TerrainEngine['hazards']>[0]); break;
      case 'slopeField': {
        const copy = need().slopeField().slice();
        result = copy; transfer = [copy.buffer];
        break;
      }
    }
    ctx.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
