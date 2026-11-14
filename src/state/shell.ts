/**
 * App shell state: the MarsAgent panel (open or collapsed, persisted), the active rail tool, the report viewer and the
 * optional narration voice. World and scene data live elsewhere.
 */
import { create } from 'zustand';

export type Tool = 'plan' | 'lasso' | 'landing' | 'walk' | 'helmet' | 'reach';
const PANEL_KEY = 'heymars-panel-open';
const VOICE_KEY = 'heymars-narrate-aloud';

function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
function writeBool(key: string, v: boolean) { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* storage unavailable */ } }

export interface ShellState {
  /** Read from storage by hydrate() on the first client effect. */
  panelOpen: boolean;
  tool: Tool | null;
  reportOpen: boolean;
  narrateAloud: boolean;
  hydrate(): void;
  setPanel(open: boolean): void;
  togglePanel(): void;
  setTool(t: Tool | null): void;
  setReport(open: boolean): void;
  setNarrate(on: boolean): void;
}

export const useShell = create<ShellState>((set, get) => ({
  panelOpen: true,
  tool: null,
  reportOpen: false,
  narrateAloud: false,
  hydrate: () => {
    const wide = typeof window !== 'undefined' && window.innerWidth >= 900;
    set({ panelOpen: readBool(PANEL_KEY, wide), narrateAloud: readBool(VOICE_KEY, false) });
  },
  setPanel: (panelOpen) => { writeBool(PANEL_KEY, panelOpen); set({ panelOpen }); },
  togglePanel: () => get().setPanel(!get().panelOpen),
  setTool: (tool) => set({ tool }),
  setReport: (reportOpen) => set({ reportOpen }),
  setNarrate: (narrateAloud) => {
    writeBool(VOICE_KEY, narrateAloud);
    if (!narrateAloud && typeof window !== 'undefined') try { window.speechSynthesis?.cancel(); } catch { /* unsupported */ }
    set({ narrateAloud });
  },
}));
