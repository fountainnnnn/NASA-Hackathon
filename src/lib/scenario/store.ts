import type { LandingScenarioRequest, LandingScenarioResult } from '../globeContracts';

/** Scenario results by id ("S1", "S2", ...). The globe reads them by scenarioId for `globe_scatter`. */
export interface StoredScenario { id: string; request: LandingScenarioRequest; result: LandingScenarioResult; at: number }

const store = new Map<string, StoredScenario>();
const MAX_STORED = 12;
let counter = 0;

export function putScenario(request: LandingScenarioRequest, result: LandingScenarioResult): StoredScenario {
  const id = `S${++counter}`;
  const rec = { id, request, result, at: Date.now() };
  store.set(id, rec);
  while (store.size > MAX_STORED) store.delete(store.keys().next().value as string);
  return rec;
}
export const getScenario = (id: string): StoredScenario | undefined => store.get(id);
export function clearScenarios() { store.clear(); counter = 0; }
