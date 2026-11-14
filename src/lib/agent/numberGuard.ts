/**
 * Number guard: flags numbers in the assistant's final text that cannot be traced to a tool
 * result (or the scene context) from the same turn. Heuristic, not a proof.
 */

type UnitClass = 'km' | 'm' | 'min' | 'h' | 'deg' | 'pct' | 'other' | null;

const UNITS: [string, UnitClass][] = [
  ['kilometers', 'km'], ['kilometres', 'km'], ['kilometer', 'km'], ['kilometre', 'km'],
  ['meters', 'm'], ['metres', 'm'], ['meter', 'm'], ['metre', 'm'],
  ['minutes', 'min'], ['minute', 'min'], ['mins', 'min'], ['min', 'min'],
  ['hours', 'h'], ['hour', 'h'], ['hrs', 'h'], ['hr', 'h'],
  ['degrees', 'deg'], ['degree', 'deg'], ['percent', 'pct'],
  ['km', 'km'], ['kJ', 'other'], ['Wh', 'other'], ['kg', 'other'], ['°C', 'other'],
  ['°', 'deg'], ['%', 'pct'], ['m', 'm'], ['h', 'h'], ['s', 'other'], ['W', 'other'],
];
const UNIT_MAP = new Map(UNITS);
const UNIT_RE = UNITS.map(([u]) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const NUM_RE = new RegExp(
  String.raw`(?<![\w.]|\d-)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?!\d)` +
    String.raw`(?:\s?(${UNIT_RE})(?:(?<=°)[NSEW])?(?![A-Za-z]))?(?![A-Za-z])`,
  'g',
);

/** All numeric values appearing in the sources (absolute values). */
export function collectSourceNumbers(sources: unknown[]): number[] {
  const out = new Set<number>();
  const re = /\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
  for (const s of sources) {
    const str = typeof s === 'string' ? s : JSON.stringify(s) ?? '';
    for (const m of str.matchAll(re)) {
      const v = Number(m[0]);
      if (Number.isFinite(v)) out.add(v);
    }
  }
  return [...out];
}

function matches(text: number, factor: number, halfUnit: number, sources: number[]): boolean {
  for (const s of sources) {
    const tol = Math.max(Math.abs(s) * 0.01, halfUnit * factor + 1e-9);
    if (Math.abs(text - s) <= tol) return true;
  }
  return false;
}

export function findUnverifiedNumbers(text: string, sources: unknown[]): string[] {
  const nums = collectSourceNumbers(sources);
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(NUM_RE)) {
    const raw = m[0].trim();
    const intPart = m[1];
    const frac = m[2] ?? '';
    const unitRaw = m[3];
    const unit: UnitClass = unitRaw ? (UNIT_MAP.get(unitRaw) ?? 'other') : null;
    const value = Number(intPart.replace(/,/g, '') + frac);
    const idx = m.index ?? 0;
    const isInt = frac === '';

    if (!unit) {
      // list numbering: "1." / "2)" at the start of a line
      const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
      const before = text.slice(lineStart, idx);
      const after = text.charAt(idx + m[0].length);
      if (/^\s*[-*•]?\s*$/.test(before) && (after === '.' || after === ')')) continue;
      if (isInt && value >= 1900 && value <= 2100) continue; // years
      if (isInt && value <= 3) continue; // small counts
    }

    const half = 0.5 * Math.pow(10, -frac.replace('.', '').length);
    let ok: boolean;
    switch (unit) {
      case 'km': ok = matches(value, 1, half, nums) || matches(value * 1000, 1000, half, nums); break;
      case 'm': ok = matches(value, 1, half, nums) || matches(value / 1000, 1 / 1000, half, nums); break;
      case 'min': ok = matches(value, 1, half, nums) || matches(value / 60, 1 / 60, half, nums); break;
      case 'h': ok = matches(value, 1, half, nums) || matches(value * 60, 60, half, nums); break;
      default: ok = matches(value, 1, half, nums);
    }
    if (!ok && !seen.has(raw)) {
      seen.add(raw);
      bad.push(raw);
    }
  }
  return bad;
}
