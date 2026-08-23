import type { EnvironmentDefinition } from './shared/environment';
import type { AudioFeatureFrame } from '../audio/types';
import { FloatingIslandsScene } from './floatingIslands/FloatingIslandsScene';
import { WorldScene } from './worlds/WorldScene';
import { WORLD_DEFINITIONS } from './worlds/definitions';

/**
 * Every registered environment, keyed by id. `VisualizerCanvas.tsx` looks
 * up the active id (see `useEnvironmentStore`) and mounts that
 * environment's `SceneComponent`.
 *
 * All nine are the reference worlds, and all use the shared cel-shaded
 * look: Floating Islands is bespoke (built and signed off first), the
 * other eight are data-driven definitions rendered by `WorldScene`. The
 * earlier environments that predated this art direction have been removed
 * along with their render code.
 */
const worldEntries: Record<string, EnvironmentDefinition> = {};
for (const def of WORLD_DEFINITIONS) {
  worldEntries[def.id] = {
    id: def.id,
    name: def.name,
    SceneComponent: ({ featureFrame }: { featureFrame: AudioFeatureFrame }) => (
      <WorldScene featureFrame={featureFrame} def={def} />
    ),
  };
}

export const ENVIRONMENTS: Record<string, EnvironmentDefinition> = {
  floatingIslandsWorld: {
    id: 'floatingIslandsWorld',
    name: 'Floating Islands',
    SceneComponent: FloatingIslandsScene,
  },
  ...worldEntries,
};

export { DEFAULT_ENVIRONMENT_ID } from './defaultEnvironment';
