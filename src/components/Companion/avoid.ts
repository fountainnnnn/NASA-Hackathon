/** Rects of everything Scout and its bubble must stand beside, not on: HUD blocks and scene labels that are on screen right now. */
import type { Rect } from './motion';

export function collectAvoid(): Rect[] {
  const out: Rect[] = [];
  // crew and rover tags (drei Html, class scenario_tag__*) carry no data-avoid of their own; the reticle must not sit on them either
  document.querySelectorAll('[data-avoid], [data-gl-label], [data-stage] [class*="_tag__"], [data-stage] [class*="__tag"]').forEach((n) => {
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (getComputedStyle(n).visibility === 'hidden') return;
    const rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    out.push(rect);
    if (n.hasAttribute('data-log')) out.push(rect, rect, rect); // the log cannot move: overlapping it costs four times as much

  });
  return out;
}

/** Width of the mission log column (or rail) that the map must not use, from the --log-w variable on <main>. */
export function logWidth(from: Element | null): number {
  return parseFloat(getComputedStyle(from?.closest('main') ?? document.body).getPropertyValue('--log-w')) || 0;
}
