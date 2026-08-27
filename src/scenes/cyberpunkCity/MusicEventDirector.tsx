import { useFrame, useThree } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { WorldDirector } from './world/worldDirector';
import { audioEngine } from '../../audio/AudioEngine';

/** Mounted once, before every other reactive component, so
 *  `majorEventState` is up to date before the rest of the scene reads it
 *  this same frame. Owns no rendering of its own.
 *
 *  Steps through the `WorldDirector` facade (Phase 6 Stage 2) rather than
 *  calling `stepMusicEventDirector` directly — see `worldDirector.ts` for
 *  what that seam is and isn't yet. Behaviourally identical either way. */
export function MusicEventDirector({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const { camera } = useThree();

  useFrame((state, rawDelta) => {
    // No live audio playing means no new events can genuinely occur — skip
    // stepping so an in-flight major-event phase can't silently finish
    // playing out purely on wall-clock time while the user has paused.
    if (!audioEngine.isPlaying()) return;
    const dt = Math.min(rawDelta, 0.05);
    WorldDirector.step(dt, featureFrame, camera.position, state.clock.elapsedTime);
  });

  return null;
}
