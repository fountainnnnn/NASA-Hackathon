/** Answer text helpers: number + unit tokens and unverified-number marking. */

export interface Token { text: string; kind: 'text' | 'num' | 'unverified' }

const UNITS = 'km\\/h|m\\/s|km|m|°C|°|%|K|Pa|Wh|W|min|h|s|deg|kg|g|mbar';
const NUM_RE = new RegExp(`(?<![\\p{L}\\d.])(-?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:${UNITS}))?)(?![\\p{L}\\d])`, 'gu');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split `text` into plain text, numbers with their unit (mono font) and unverified numbers (underlined). */
export function tokenizeAnswer(text: string, unverified: string[] = []): Token[] {
  const list = [...new Set(unverified.filter(Boolean))].sort((a, b) => b.length - a.length);
  const parts: { text: string; flagged: boolean }[] = list.length
    ? text.split(new RegExp(`(${list.map(esc).join('|')})`, 'g')).filter((p) => p !== '').map((p) => ({ text: p, flagged: list.includes(p) }))
    : [{ text, flagged: false }];
  const out: Token[] = [];
  for (const p of parts) {
    if (p.flagged) { out.push({ text: p.text, kind: 'unverified' }); continue; }
    let last = 0;
    for (const m of p.text.matchAll(NUM_RE)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ text: p.text.slice(last, i), kind: 'text' });
      out.push({ text: m[0], kind: 'num' });
      last = i + m[0].length;
    }
    if (last < p.text.length) out.push({ text: p.text.slice(last), kind: 'text' });
  }
  return out;
}

/**
 * Numbers in answer prose: a number, optionally with a unit that is a whole word ("10,000 s" in "10,000 simulated" is not
 * seconds). Ordinals ("95th") and bare four-digit years ("2006", "2020") stay plain text.
 */
const NUM = /(?<![\p{L}\d.,])(-?\d(?:[\d,]*\d)?(?:\.\d+)?)(\s?(?:km\/h|m\/s²|m\/s|km²|km|kJ|Wh|W|min|ms|h|m|s|%|°|kg)(?![\p{L}\d]))?(?![\p{L}\d])/gu;
const YEAR = /^(1[89]|20)\d\d$/;
export function richTokens(text: string): { text: string; num: boolean }[] {
  const out: { text: string; num: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM)) {
    const i = m.index ?? 0;
    const tok = m[0];
    if (!m[2] && YEAR.test(m[1])) continue; // a year, not a measurement
    if (i > last) out.push({ text: text.slice(last, i), num: false });
    out.push({ text: tok, num: true });
    last = i + tok.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), num: false });
  return out;
}

export function firstLine(text: string, max = 70): string {
  const line = text.split('\n').find((l) => l.trim())?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function timeAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return 'now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** Headline (the finding), up to three body lines, as the design system fixes the bubble layout. */
export function splitAnswer(text: string): { headline: string; body: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  return { headline: lines[0] ?? '', body: lines.slice(1, 4) };
}

export interface ReadoutSample { lat: number; lon: number; elevM: number | null; slopeDeg?: number | null; unit?: string | null }

/** `18.44N 77.45E  -2540 m`, plus `slope 4.2°  Unit name` on a second line after dwell. */
export function formatReadout(r: ReadoutSample, dwell = false): string[] {
  const lat = `${Math.abs(r.lat).toFixed(2)}${r.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(r.lon).toFixed(2)}${r.lon >= 0 ? 'E' : 'W'}`;
  const first = r.elevM === null ? `${lat} ${lon}` : `${lat} ${lon}  ${Math.round(r.elevM)} m`;
  if (!dwell) return [first];
  const bits = [r.slopeDeg != null ? `slope ${r.slopeDeg.toFixed(1)}°` : '', r.unit ?? ''].filter(Boolean);
  return bits.length ? [first, bits.join('  ')] : [first];
}
