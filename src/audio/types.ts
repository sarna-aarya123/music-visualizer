/**
 * The contract every visual scene consumes. Scenes never touch the
 * AnalyserNode or raw FFT data directly — they only ever read this shape,
 * which is what makes audio analysis swappable/upgradeable independently
 * of any scene.
 */
export interface AudioFeatureFrame {
  /** Smoothed 0..1 band energies. */
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  /** Smoothed 0..1 overall loudness across all bands. */
  energy: number;
  /** True for exactly one frame when a kick/onset is detected. */
  kick: boolean;
  /** 0..1 value that jumps to 1 on a kick and decays each frame after —
   *  the thing scenes read for a "cinematic impact" that eases out, rather
   *  than reacting to the instantaneous `kick` boolean directly. */
  kickImpulse: number;
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
    kick: false,
    kickImpulse: 0,
    time: 0,
  };
}
