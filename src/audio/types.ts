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

  /** Continuous spectral flux per group ("how much did this band's content
   *  just change frame-to-frame", not "how loud is it") — lightly smoothed
   *  for use as an ambient "aliveness" signal, distinct from the discrete
   *  onset events below which are edge-triggered off the same underlying
   *  raw flux. */
  bassFlux: number;
  midFlux: number;
  highFlux: number;
  spectralFlux: number;

  /** 0..1 value that jumps up on a beat and decays every frame after —
   *  handy for effects that should just "follow" the beat smoothly
   *  without needing to detect the discrete event themselves. */
  kickImpulse: number;

  /**
   * Discrete beat/onset event (the bass/808/kick detector). `beatId`
   * increments exactly once per detected beat — it is a counter, not a
   * boolean, specifically so a consumer can never "miss" one: compare the
   * id you last saw against this frame's id (see audio/beatConsumer.ts)
   * and you are guaranteed to observe every single beat exactly once,
   * regardless of frame timing.
   */
  beatId: number;
  /** Strength of the most recently detected beat, 0..1. Stronger transients
   *  relative to the track's recent loudness produce a higher value. */
  beatIntensity: number;
  /** Playback time (seconds) at which the most recent beat was detected. */
  beatTime: number;
  /** Smoothed seconds-between-beats — a rough live tempo estimate systems
   *  can use to make their rhythm perceptibly relate to the track's. */
  beatInterval: number;

  /** Snare/clap detector (mid+high flux transient) — a sharp, separate
   *  event from the bass-driven beat above, for consumers that want a
   *  crisp "hit" distinct from a kick/808. */
  snareHitId: number;
  snareHitIntensity: number;

  /** Hi-hat / high-frequency transient detector — fires often, meant to
   *  drive small/fast details, never large world events. */
  hihatId: number;
  hihatIntensity: number;

  /** Fires when the track's frequency *distribution* (not loudness)
   *  suddenly and persistently shifts — e.g. a beat switch where bass
   *  drops out and mids/highs take over at similar overall loudness. */
  spectralShiftId: number;
  spectralShiftIntensity: number;

  /** One-shot section-level events from comparing a fast vs. slow energy
   *  envelope: a sustained sharp rise fires `dropId`, a sustained sharp
   *  fall (from a high-energy state) fires `breakdownId`. */
  dropId: number;
  breakdownId: number;

  /** Continuous 0..1 composite "something musically significant just
   *  happened" gauge — combines bass/mid/high flux relative to each
   *  band's own adaptive baseline. Used to gate rare major events without
   *  needing a dedicated detector for every possible cause. */
  impactScore: number;

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
    bassFlux: 0,
    midFlux: 0,
    highFlux: 0,
    spectralFlux: 0,
    kickImpulse: 0,
    beatId: 0,
    beatIntensity: 0,
    beatTime: 0,
    beatInterval: 0.5,
    snareHitId: 0,
    snareHitIntensity: 0,
    hihatId: 0,
    hihatIntensity: 0,
    spectralShiftId: 0,
    spectralShiftIntensity: 0,
    dropId: 0,
    breakdownId: 0,
    impactScore: 0,
    time: 0,
  };
}
