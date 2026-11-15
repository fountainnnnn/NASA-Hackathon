/**
 * Scenario objects are drawn larger than life so they read at the default cameras. Positions, times, altitudes reported
 * on screen, battery and every computed number stay true; only the 3D models (and the cords, offsets and dust that keep
 * them in proportion) are enlarged, and the stage legend says by how much.
 */
import { create } from 'zustand';

/** Landing vehicle (capsule, parachute, heat shield, descent stage, rover, cords, dust) during descent and chase views. */
export const LANDING_DRAW_SCALE = 4;
/** Camera distances in the landing close-ups grow by this much, so the 4× vehicle reads 2× larger on screen and never clips. */
export const LANDING_CAM_SCALE = 2;
/** Astronauts and the rover in the walk and rover views (chase camera). The helmet view stays at true size. */
export const CREW_DRAW_SCALE = 3;
/** Chase camera distances grow by this much for the 3× crew, so each figure reads about 1.7× larger than at true size. */
export const CREW_CAM_SCALE = 1.75;
/** Habitat and parked rover at base camp: at least this, more from far away. */
export const BASE_DRAW_SCALE = 3;

export const scaleNote = (k: number) => `Objects shown ${Math.round(k)}× true size`;

type Slot = 'landing' | 'crew' | 'base';
interface DrawScaleState { notes: Partial<Record<Slot, string | null>>; set(slot: Slot, k: number | null): void }

/** The legend note per active simulation (null when nothing is enlarged). */
export const useDrawScale = create<DrawScaleState>((set, get) => ({
  notes: {},
  set: (slot, k) => {
    const note = k != null && Math.round(k) > 1 ? scaleNote(k) : null;
    if ((get().notes[slot] ?? null) === note) return;
    set((s) => ({ notes: { ...s.notes, [slot]: note } }));
  },
}));

/** The one note the legend shows: landing first, then the walk, then base camp. */
export const drawScaleNote = (s: Pick<DrawScaleState, 'notes'>, mode: 'globe' | 'jezero'): string | null =>
  mode === 'globe' ? s.notes.landing ?? null : s.notes.crew ?? s.notes.base ?? null;
