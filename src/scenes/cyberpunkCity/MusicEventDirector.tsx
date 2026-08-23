import { useFrame, useThree } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { stepMusicEventDirector } from './world/musicEventDirector';
import { audioEngine } from '../../audio/AudioEngine';

/** Mounted once, before every other reactive component, so
 *  `majorEventState` is up to date before the rest of the scene reads it
 *  this same frame. Owns no rendering of its own. */
export function MusicEventDirector({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const { camera } = useThree();

  useFrame((state, rawDelta) => {
    // No live audio playing means no new events can genuinely occur — skip
    // stepping so an in-flight major-event phase can't silently finish
    // playing out purely on wall-clock time while the user has paused.
    if (!audioEngine.isPlaying()) return;
    const dt = Math.min(rawDelta, 0.05);
    stepMusicEventDirector(dt, featureFrame, camera.position, state.clock.elapsedTime);
  });

  return null;
}
