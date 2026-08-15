import { useFrame, useThree } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { stepMusicEventDirector } from './world/musicEventDirector';

/** Mounted once, before every other reactive component, so
 *  `majorEventState` is up to date before the rest of the scene reads it
 *  this same frame. Owns no rendering of its own. */
export function MusicEventDirector({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const { camera } = useThree();

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    stepMusicEventDirector(dt, featureFrame, camera.position, state.clock.elapsedTime);
  });

  return null;
}
