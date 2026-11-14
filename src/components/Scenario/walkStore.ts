import { create } from 'zustand';
import { ROVER_SPEED_KMH } from './model';

/** UI state shared between the DOM controls and the in-canvas components (they live in different React roots). */
export interface WalkUi {
  helmet: boolean;
  /** 0..1 fraction of the outbound distance carried by the rover. */
  roverFraction: number;
  setHelmet(on: boolean): void;
  setRoverFraction(f: number): void;
  /** Rover speed in use (ASSUMPTION, see model.ts). Exposed so labels cannot drift from the maths. */
  roverKmh: number;
}

export const useWalkUi = create<WalkUi>((set) => ({
  helmet: false,
  roverFraction: 0,
  roverKmh: ROVER_SPEED_KMH,
  setHelmet: (helmet) => set({ helmet }),
  setRoverFraction: (f) => set({ roverFraction: Math.min(1, Math.max(0, f)) }),
}));
