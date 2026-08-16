import { create } from 'zustand';

export type ViewMode = 'third' | 'first';

interface ViewModeState {
  mode: ViewMode;
  toggle: () => void;
  set: (mode: ViewMode) => void;
}

/** Rare, user-driven state (a couple of toggles per session at most) — a
 *  normal React store is fine here, unlike the 60fps audio/camera state
 *  elsewhere which deliberately bypasses React. */
export const useViewModeStore = create<ViewModeState>((set) => ({
  mode: 'third',
  toggle: () => set((s) => ({ mode: s.mode === 'third' ? 'first' : 'third' })),
  set: (mode) => set({ mode }),
}));
