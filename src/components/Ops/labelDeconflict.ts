'use client';
/**
 * Map labels never print over each other or under the MarsAgent card. Crew tags move every frame, so they win; a scene pin label or a route time
 * tick that would sit under a crew tag (or a second crew tag under the first) fades out until the tag has passed.
 * Uses opacity so it never fights the labels' own visibility logic (edge flip, HUD avoidance).
 */
import { useEffect } from 'react';

const isTag = (el: Element) => /(^|_|-)tag__/.test(typeof el.className === 'string' ? el.className : '');
const hit = (a: DOMRect, b: DOMRect, pad = 2) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

export function useMapLabelDeconflict() {
  useEffect(() => {
    const id = window.setInterval(() => {
      const stage = document.querySelector('[data-stage]'); if (!stage) return;
      const tags = [...stage.querySelectorAll<HTMLElement>('div')].filter(isTag);
      const others = [...stage.querySelectorAll<HTMLElement>('[data-flip-label], [class*="tick"], [data-gl-label]')].filter((e) => !isTag(e));
      // the MarsAgent card (a bottom sheet on phones) and the panel sit over the map: labels under them fade too
      // (and so do the cuff card sheet and the drag readout, marked data-over-map)
      const shown: DOMRect[] = [...document.querySelectorAll<HTMLElement>('section[data-companion], #marsagent-panel, [data-over-map]')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      for (const t of tags) {
        const r = t.getBoundingClientRect();
        const clash = r.width > 0 && shown.some((s) => hit(r, s));
        t.style.opacity = clash ? '0' : '';
        if (!clash && r.width > 0) shown.push(r);
      }
      for (const o of others) {
        const r = o.getBoundingClientRect();
        o.style.opacity = r.width > 0 && shown.some((s) => hit(r, s)) ? '0' : '';
      }
    }, 120);
    return () => window.clearInterval(id);
  }, []);
}
