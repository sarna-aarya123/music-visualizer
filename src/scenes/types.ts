import type { AudioFeatureFrame } from '../audio/types';
import type { RouteData } from './cyberpunkCity/world/routeGenerator';
import type { WorldLayout } from './cyberpunkCity/world/worldGenerator';

/**
 * Every scene (and every sub-component of a scene) receives the audio
 * feature stream through this single prop. It's the same underlying
 * singleton object every frame — components read its fields inside their
 * own useFrame callbacks rather than relying on React re-renders.
 *
 * `route` and `world` are generated once per mount (see
 * CyberpunkCityScene.tsx) and threaded down the same way: plain data, not
 * context, since only a handful of components need them.
 */
export interface SceneProps {
  featureFrame: AudioFeatureFrame;
  route: RouteData;
  world: WorldLayout;
}
