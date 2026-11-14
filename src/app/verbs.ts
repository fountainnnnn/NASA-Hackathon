/** The plain verbs MarsAgent offers on the card, the rail and the composer. Typed or clicked, they run deterministic code (no LLM). */
export const V = {
  land: 'Landing check',
  scenario: 'Run landing simulation',
  edl: 'Show EDL timeline',
  jezero: 'Take me to Jezero',
  limits: 'Change limits',
  walkHere: 'Walk here and back',
  walk: 'Walk it',
  helmet: 'Helmet view',
  rover: 'Rover assist',
  reach: 'Base camp reach',
  cuff: 'Cuff card',
  back: 'Back to Mars',
  noon: 'Start at local noon',
  lassoWalk: 'Walk to the stop',
  nearest: 'Pick nearest reachable point',
  plan: 'Plan a route',
  lasso: 'Lasso an area',
  layers: 'Layers',
  sources: 'Sources',
} as const;

/** Older phrasings that still map to a verb. */
const ALIASES: Record<string, string> = {
  'could we land here': V.land,
  'can we land here': V.land,
  'run landing scenario': V.scenario,
  'landing simulation': V.scenario,
  'mission limits': V.limits,
};

export const norm = (t: string) => t.trim().toLowerCase().replace(/[.?!]+$/, '');
const TABLE = new Map<string, string>([...Object.values(V).map((v) => [norm(v), v] as [string, string]), ...Object.entries(ALIASES)]);
/** Exact verb text, or null when the text is a free question for MarsAgent. */
export function matchVerb(text: string): string | null { return TABLE.get(norm(text)) ?? null; }
