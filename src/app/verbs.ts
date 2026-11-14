/** The plain verbs Scout offers. Typed or clicked, they run deterministic code (no LLM). */
export const V = {
  land: 'Could we land here?',
  scenario: 'Run landing scenario',
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
  more: 'More',
  less: 'Previous',
} as const;

export const norm = (t: string) => t.trim().toLowerCase().replace(/[.?!]+$/, '');
const TABLE = new Map<string, string>(Object.values(V).map((v) => [norm(v), v]));
/** Exact verb text, or null when the text is a free question for the copilot. */
export function matchVerb(text: string): string | null { return TABLE.get(norm(text)) ?? null; }
