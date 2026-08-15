/**
 * The contract every visual scene consumes. Scenes never touch the
 * AnalyserNode or raw FFT data directly — they only ever read this shape,
 * which is what makes audio analysis swappable/upgradeable independently
 * of any scene.
 */
export interface AudioFeatureFrame {
  /** Smoothed 0..1 band energies — continuous values for ambient motion. */
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  /** Smoothed 0..1 overall loudness across all bands. */
  energy: number;

  /** 0..1 value that jumps up on a beat and decays every frame after —
   *  handy for effects that should just "follow" the beat smoothly
   *  without needing to detect the discrete event themselves. */
  kickImpulse: number;

  /**
   * Discrete beat/onset event. `beatId` increments exactly once per
   * detected beat — it is a counter, not a boolean, specifically so a
   * consumer can never "miss" one: compare the id you last saw against
   * this frame's id (see audio/beatConsumer.ts) and you are guaranteed to
   * observe every single beat exactly once, regardless of frame timing.
   */
  beatId: number;
  /** Strength of the most recently detected beat, 0..1. Stronger transients
   *  relative to the track's recent loudness produce a higher value. */
  beatIntensity: number;
  /** Playback time (seconds) at which the most recent beat was detected. */
  beatTime: number;

  /** Current playback time in seconds, mirrored here for convenience. */
  time: number;
}

export function createEmptyFeatureFrame(): AudioFeatureFrame {
  return {
    bass: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    energy: 0,
    kickImpulse: 0,
    beatId: 0,
    beatIntensity: 0,
    beatTime: 0,
    time: 0,
  };
}
