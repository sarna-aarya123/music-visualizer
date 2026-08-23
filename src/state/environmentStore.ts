import { create } from 'zustand';
import { DEFAULT_ENVIRONMENT_ID } from '../scenes/defaultEnvironment';

interface EnvironmentState {
  activeId: string;
  setActive: (id: string) => void;
}

/** Rare, user-driven state (picking an environment) — same pattern as
 *  viewModeStore, a normal React store rather than the 60fps audio/camera
 *  singletons elsewhere. */
export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  activeId: DEFAULT_ENVIRONMENT_ID,
  setActive: (id) => set({ activeId: id }),
}));
