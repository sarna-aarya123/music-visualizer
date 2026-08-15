import type { AudioFeatureFrame } from '../audio/types';

/**
 * Every scene (and every sub-component of a scene) receives the audio
 * feature stream through this single prop. It's the same underlying
 * singleton object every frame — components read its fields inside their
 * own useFrame callbacks rather than relying on React re-renders.
 */
export interface SceneProps {
  featureFrame: AudioFeatureFrame;
}
