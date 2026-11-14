/**
 * Map labels that give way to others (they hide themselves when covered), so a label with priority ignores them:
 * route time ticks, scene pin labels and rings, and the drag readout (which steers clear of labels on its own).
 */
export const YIELDING_LABELS = '[class*="tick"], [data-flip-label], [class*="pinDot"], [class*="dragLabel"]';

/**
 * True when `r` lands on any HUD block or the Scout bubble (anything marked data-avoid or data-companion) outside `own`.
 * `ignore` (a selector) skips elements that will move or hide for this one.
 */
export function blockedByHud(r: DOMRect, own: Element | null, ignore?: string): boolean {
  const els = document.querySelectorAll('[data-avoid], [data-companion]');
  for (const n of els) {
    if (own && (own === n || own.contains(n) || n.contains(own))) continue;
    if (ignore && n.matches(ignore)) continue;
    const b = n.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0 || getComputedStyle(n).visibility === 'hidden') continue;
    if (r.left < b.right + 2 && r.right > b.left - 2 && r.top < b.bottom + 2 && r.bottom > b.top - 2) return true;
  }
  return false;
}
