/**
 * The last lasso, kept on the ground after the answer shows: a 1 px dashed bone outline that stays until the map card
 * closes, a new lasso or drag starts, or the shell calls clearLassoOutline(). Set by the pointer tools on release.
 */
import { create } from 'zustand';
import type { LonLat } from '@/lib/contracts';
import { useThread } from '@/state/thread';

interface LassoOutlineState { poly: LonLat[] | null; set(poly: LonLat[] | null): void }
export const useLassoOutline = create<LassoOutlineState>((set) => ({ poly: null, set: (poly) => set({ poly }) }));
export const setLassoOutline = (poly: LonLat[]) => useLassoOutline.getState().set(poly.length >= 3 ? poly : null);
export const clearLassoOutline = () => useLassoOutline.getState().set(null);

// the outline belongs to the lasso's card: it goes when that card is closed (card id set, then cleared)
let seenCard = false;
useThread.subscribe((s, prev) => {
  if (s.cardTurnId === prev.cardTurnId) return;
  if (!useLassoOutline.getState().poly) { seenCard = false; return; }
  if (s.cardTurnId) seenCard = true;
  else if (seenCard) { seenCard = false; clearLassoOutline(); }
});
