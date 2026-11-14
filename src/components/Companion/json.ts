/** JSON for display: long arrays and typed arrays are summarised so a result with 10,000 points stays readable. */
export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => {
      if (ArrayBuffer.isView(x)) return `${x.constructor.name}(${(x as unknown as { length: number }).length})`;
      if (Array.isArray(x) && x.length > 16) return [...x.slice(0, 16), `... ${x.length - 16} more`];
      if (typeof x === 'string' && x.length > 400) return `${x.slice(0, 400)}...`;
      return x;
    }, 2) ?? '';
  } catch { return String(v); }
}


