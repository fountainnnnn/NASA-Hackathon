import type { Dem, TerrainApi } from '@/lib/contracts';
import { createTerrainEngine, type TerrainEngine } from './engine';

export { createTerrainEngine };
export type { TerrainEngine };

/** TerrainApi backed by an in-process engine (SSR / no-Worker fallback). */
export function createInProcessTerrainApi(): TerrainApi {
  let engine: TerrainEngine | null = null;
  const need = () => { if (!engine) throw new Error('terrain not initialised'); return engine; };
  return {
    async init(dem: Dem) { engine = createTerrainEngine(dem); return engine.info; },
    async planRoute(req) { return need().planRoute(req); },
    async analyze(req) { return need().analyze(req); },
    async hazards(req) { return need().hazards(req); },
    async slopeField() { return need().slopeField().slice(); },
  };
}

/**
 * TerrainApi backed by a module Web Worker (postMessage RPC with request ids). The worker is
 * created lazily on first call in the browser; on the server or if Worker creation fails it
 * falls back to the in-process engine.
 */
export function createTerrainClient(): TerrainApi {
  let worker: Worker | null = null;
  let fallback: TerrainApi | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  const getWorker = (): Worker | null => {
    if (worker) return worker;
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('../../workers/route.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error ?? 'terrain worker error'));
      };
      w.onerror = (ev) => {
        const err = new Error(ev.message || 'terrain worker crashed');
        for (const p of pending.values()) p.reject(err);
        pending.clear();
      };
      worker = w;
      return w;
    } catch {
      return null;
    }
  };

  const call = <T,>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> => {
    const w = getWorker();
    if (!w) return Promise.reject(new Error('NO_WORKER'));
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, method, args }, transfer);
    });
  };

  let lastDem: Dem | null = null;
  const withFallback = async <T,>(run: () => Promise<T>, viaFallback: (f: TerrainApi) => Promise<T>): Promise<T> => {
    if (!fallback && getWorker()) return run();
    if (!fallback) {
      fallback = createInProcessTerrainApi();
      if (lastDem) await fallback.init(lastDem);
    }
    return viaFallback(fallback);
  };

  return {
    init: (dem) => {
      lastDem = dem;
      return withFallback(
        () => {
          const elev = dem.elev.slice(); // keep the caller's DEM intact; transfer the copy
          return call('init', [{ meta: dem.meta, elev }], [elev.buffer]);
        },
        (f) => f.init(dem),
      );
    },
    planRoute: (req) => withFallback(() => call('planRoute', [req]), (f) => f.planRoute(req)),
    analyze: (req) => withFallback(() => call('analyze', [req]), (f) => f.analyze(req)),
    hazards: (req) => withFallback(() => call('hazards', [req]), (f) => f.hazards(req)),
    slopeField: () => withFallback(() => call('slopeField', []), (f) => f.slopeField()),
  };
}
