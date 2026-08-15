import type { AudioFeatureFrame } from './types';

/**
 * Guarantees every detected beat is consumed exactly once by a given
 * visual system, regardless of frame timing.
 *
 * FeatureExtractor increments `beatId` once per detected onset. Instead of
 * watching a boolean that a slow/busy frame could miss, each consumer
 * (camera, buildings, ground, particles, ...) keeps its own tiny piece of
 * state and compares against the last beatId it has seen. If the frame's
 * beatId has moved on, that consumer fires its reaction — once, no matter
 * how many frames pass between checks.
 */
export interface BeatConsumerState {
  lastBeatId: number;
}

export function createBeatConsumerState(): BeatConsumerState {
  return { lastBeatId: -1 };
}

/** Returns the new beat's intensity (0..1) the first time it's observed,
 *  and 0 on every other frame. Call once per frame per consumer. */
export function consumeBeat(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  if (frame.beatId !== state.lastBeatId) {
    state.lastBeatId = frame.beatId;
    return frame.beatIntensity;
  }
  return 0;
}
