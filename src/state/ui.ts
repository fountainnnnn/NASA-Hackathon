import { create } from 'zustand';

/** Cursor readout under the pointer (throttled by the scene). */
export const useHover = create<{ hover: { lon: number; lat: number; elev: number | null } | null; set(h: { lon: number; lat: number; elev: number | null } | null): void }>((set) => ({
  hover: null,
  set: (hover) => set({ hover }),
}));

/** Screen position of the selected pin, written by the scene each frame and read imperatively by AskBubble. */
export interface Anchor { x: number; y: number; visible: boolean }
let anchor: Anchor = { x: 0, y: 0, visible: false };
const subs = new Set<(a: Anchor) => void>();
export function setAnchor(a: Anchor) {
  if (a.visible === anchor.visible && Math.abs(a.x - anchor.x) < 1 && Math.abs(a.y - anchor.y) < 1) return;
  anchor = a;
  subs.forEach((f) => f(a));
}
export function getAnchor() { return anchor; }
export function subscribeAnchor(f: (a: Anchor) => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}
