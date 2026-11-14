import { create } from 'zustand';
import { ROVER_SPEED_KMH } from './model';

/** UI state shared between the DOM controls and the in-canvas components (they live in different React roots). */
export interface WalkUi {
  helmet: boolean;
  /** 0..1 fraction of the outbound distance carried by the rover. */
  roverFraction: number;
  /**
   * Chase camera: while a walk is shown the camera follows the pair from about 32 m behind and 7 m up, at true scale.
   * A right or middle drag, or the wheel, on the canvas breaks out (followCrew becomes false); the shell's
   * "Follow crew" toggle (FollowCrewToggle) re-engages it. Turning it off with the toggle restores the wide view.
   */
  followCrew: boolean;
  /**
   * True while the camera is close enough to the ground that the CTX ortho (6 m per pixel) is visibly soft.
   * The shell shows "Imagery: CTX 6 m per pixel" beside the legend while this is true.
   */
  closeRange: boolean;
  /** True while the HiRISE orthoimage (about 1.3 m per pixel) is draped under the view; the legend then names it instead of CTX. */
  hirise: boolean;
  setHelmet(on: boolean): void;
  setRoverFraction(f: number): void;
  setFollowCrew(on: boolean): void;
  setCloseRange(on: boolean): void;
  setHirise(on: boolean): void;
  /** Rover speed in use (ASSUMPTION, see model.ts). Exposed so labels cannot drift from the maths. */
  roverKmh: number;
}

export const useWalkUi = create<WalkUi>((set) => ({
  helmet: false,
  roverFraction: 0,
  followCrew: true,
  closeRange: false,
  hirise: false,
  roverKmh: ROVER_SPEED_KMH,
  setHelmet: (helmet) => set({ helmet }),
  setRoverFraction: (f) => set({ roverFraction: Math.min(1, Math.max(0, f)) }),
  setFollowCrew: (followCrew) => set({ followCrew }),
  setCloseRange: (closeRange) => set((s) => (s.closeRange === closeRange ? s : { closeRange })),
  setHirise: (hirise) => set((s) => (s.hirise === hirise ? s : { hirise })),
}));

/** Hook for the shell: `const [follow, setFollow] = useFollowCrew()`. */
export function useFollowCrew(): [boolean, (on: boolean) => void] {
  return [useWalkUi((s) => s.followCrew), useWalkUi((s) => s.setFollowCrew)];
}
