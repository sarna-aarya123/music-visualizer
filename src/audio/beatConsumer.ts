import type { AudioFeatureFrame } from './types';

/**
 * Guarantees every detected audio event is consumed exactly once by a
 * given visual system, regardless of frame timing.
 *
 * FeatureExtractor increments an id counter once per detected event.
 * Instead of watching a boolean that a slow/busy frame could miss, each
 * consumer (camera, buildings, ground, particles, ...) keeps its own tiny
 * piece of state and compares against the last id it has seen. If the
 * frame's id has moved on, that consumer fires its reaction — once, no
 * matter how many frames pass between checks.
 *
 * One generic `consumeEvent` plus a typed wrapper per event type — every
 * wrapper needs its own `BeatConsumerState` instance per consuming
 * component (the same pattern the original beat-only version used).
 */
export interface BeatConsumerState {
  lastId: number;
}

export function createBeatConsumerState(): BeatConsumerState {
  return { lastId: -1 };
}

/** Returns `intensity` the first time this `id` is observed, 0 otherwise.
 *  Call once per frame per consumer. */
export function consumeEvent(id: number, intensity: number, state: BeatConsumerState): number {
  if (id !== state.lastId) {
    state.lastId = id;
    return intensity;
  }
  return 0;
}

export function consumeBeat(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.beatId, frame.beatIntensity, state);
}

export function consumeSnareHit(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.snareHitId, frame.snareHitIntensity, state);
}

export function consumeHihat(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.hihatId, frame.hihatIntensity, state);
}

export function consumeSpectralShift(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.spectralShiftId, frame.spectralShiftIntensity, state);
}

/** Drop/breakdown carry no separate intensity field — they're binary
 *  section-level events — so consuming one just yields a fixed magnitude. */
export function consumeDrop(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.dropId, 1, state);
}

export function consumeBreakdown(frame: AudioFeatureFrame, state: BeatConsumerState): number {
  return consumeEvent(frame.breakdownId, 1, state);
}
