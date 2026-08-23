import { useFrame } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { stepRhythmState } from './world/rhythmState';
import { audioEngine } from '../../audio/AudioEngine';

/** Mounted once alongside `MusicEventDirector` — steps the `rhythmState`
 *  singleton (drumPresence/energyTrend) so it's current before the rest of
 *  the scene reads it this same frame. Owns no rendering of its own. */
export function RhythmState({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  useFrame((_, rawDelta) => {
    // Same pause semantics as every other music-derived singleton: no live
    // audio means nothing genuinely changes, so freeze in place rather
    // than letting drumPresence decay toward 0 purely on wall-clock time
    // while paused.
    if (!audioEngine.isPlaying()) return;
    const dt = Math.min(rawDelta, 0.05);
    stepRhythmState(dt, featureFrame);
  });

  return null;
}
