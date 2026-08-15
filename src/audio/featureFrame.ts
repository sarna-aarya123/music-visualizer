import { createEmptyFeatureFrame } from './types';

/**
 * Singleton mutable feature frame, updated ~60x/sec by FeatureExtractor
 * (see core/FeatureUpdater.tsx). Scenes import this directly and read it
 * inside their own useFrame callbacks.
 *
 * This deliberately bypasses React state/props: putting 60fps audio data
 * into React state would re-render the component tree every frame. A
 * single shared mutable object is the standard R3F pattern for this.
 */
export const featureFrame = createEmptyFeatureFrame();
