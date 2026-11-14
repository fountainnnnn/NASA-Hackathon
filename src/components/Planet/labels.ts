/**
 * DOM label layer for the planet view. Labels are plain elements in the design system's mono chip style, moved each frame
 * to the projected anchor, hidden behind the limb, and decluttered against each other and the HUD (same rule as the old globe).
 */
import type * as CesiumNS from 'cesium';

type C = typeof CesiumNS;

export interface LabelHandle {
  setWorld(p: CesiumNS.Cartesian3): void;
  remove(): void;
}

interface Rec { el: HTMLDivElement; prio: number; dy: number; world: CesiumNS.Cartesian3 | null }

const style = (color: string): string =>
  `position:absolute;left:0;top:0;white-space:nowrap;pointer-events:none;user-select:none;will-change:transform;visibility:hidden;` +
  `font:400 11px/1.2 var(--font-mono,"Martian Mono",ui-monospace,monospace);font-variant-numeric:tabular-nums;color:#ece7e1;` +
  `background:#0d0b0b;border:1px solid rgba(236,231,225,0.10);border-left:2px solid ${color};border-radius:2px;padding:2px 6px;`;

export class LabelLayer {
  private recs = new Set<Rec>();
  private frame = 0;
  private occluder: CesiumNS.EllipsoidalOccluder;
  /** Hide every label (a simulation camera owns the view). */
  muted = false;
  constructor(private C: C, private host: HTMLElement, ellipsoid: CesiumNS.Ellipsoid) {
    this.occluder = new C.EllipsoidalOccluder(ellipsoid, C.Cartesian3.ZERO);
  }

  add(text: string, color: string, opts: { prio?: number; dy?: number } = {}): LabelHandle {
    const el = document.createElement('div');
    el.setAttribute('data-gl-label', '');
    el.style.cssText = style(color);
    el.textContent = text;
    this.host.appendChild(el);
    const rec: Rec = { el, prio: opts.prio ?? 1, dy: opts.dy ?? 0, world: null };
    this.recs.add(rec);
    return {
      setWorld: (p) => { rec.world = p; },
      remove: () => { this.recs.delete(rec); el.remove(); },
    };
  }

  /** Call once per rendered frame. */
  update(scene: CesiumNS.Scene) {
    const { C } = this;
    const cam = scene.camera;
    this.occluder.cameraPosition = cam.positionWC;
    const canvas = scene.canvas;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const out = new C.Cartesian2();
    for (const r of this.recs) {
      let ok = false;
      if (!this.muted && r.world && this.occluder.isPointVisible(r.world)) {
        const s = scene.cartesianToCanvasCoordinates(r.world, out);
        if (s && s.x > -40 && s.y > -20 && s.x < w + 40 && s.y < h + 20) {
          r.el.style.transform = `translate(${Math.round(s.x + 12)}px,${Math.round(s.y - 9 + r.dy)}px)`;
          ok = true;
        }
      }
      r.el.dataset.off = ok ? '0' : '1';
      if (!ok) r.el.style.visibility = 'hidden';
    }
    if (this.frame++ % 6 === 0) this.declutter();
  }

  private declutter() {
    const hud: DOMRect[] = [];
    document.querySelectorAll('[data-avoid], [data-companion]').forEach((n) => hud.push(n.getBoundingClientRect()));
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right + 3 && a.right > b.left - 3 && a.top < b.bottom + 3 && a.bottom > b.top - 3;
    const placed: DOMRect[] = [];
    for (const l of [...this.recs].sort((a, b) => b.prio - a.prio)) {
      if (l.el.dataset.off === '1') continue;
      l.el.style.visibility = 'visible';
      const r = l.el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (placed.some((p) => hit(p, r)) || hud.some((x) => hit(x, r))) l.el.style.visibility = 'hidden';
      else placed.push(r);
    }
  }

  destroy() { for (const r of this.recs) r.el.remove(); this.recs.clear(); }
}
