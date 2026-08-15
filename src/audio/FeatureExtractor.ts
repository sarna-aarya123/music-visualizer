import type { AudioFeatureFrame } from './types';

type BandRange = [number, number];
type BandName = 'bass' | 'lowMid' | 'mid' | 'high';

const BAND_HZ: Record<BandName, BandRange> = {
  bass: [20, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 9000],
};

// Smoothing: fast attack (feels responsive) but slow release (feels
// cinematic instead of jittery/flickery).
const ATTACK = 0.55;
const RELEASE = 0.08;

// Kick/onset detection tuning.
const KICK_FLUX_THRESHOLD = 0.16;
const KICK_MIN_ENERGY = 0.12;
const KICK_COOLDOWN_FRAMES = 14;
const IMPULSE_DECAY = 0.88;

function smooth(prev: number, next: number): number {
  const rate = next > prev ? ATTACK : RELEASE;
  return prev + (next - prev) * rate;
}

/**
 * Turns raw FFT data from a single AnalyserNode into the semantic
 * AudioFeatureFrame that scenes consume. All buffers are allocated once in
 * the constructor and reused every frame — no per-frame allocation.
 */
export class FeatureExtractor {
  private freqData: Uint8Array<ArrayBuffer>;
  private bins: Record<BandName, [number, number]>;

  private smoothed = { bass: 0, lowMid: 0, mid: 0, high: 0, energy: 0 };
  private kickRollingAverage = 0;
  private kickCooldown = 0;

  constructor(private analyser: AnalyserNode, sampleRate: number) {
    this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

    const nyquist = sampleRate / 2;
    const binCount = this.freqData.length;
    const toBins = ([lo, hi]: BandRange): [number, number] => [
      Math.max(0, Math.floor((lo / nyquist) * binCount)),
      Math.min(binCount - 1, Math.ceil((hi / nyquist) * binCount)),
    ];

    this.bins = {
      bass: toBins(BAND_HZ.bass),
      lowMid: toBins(BAND_HZ.lowMid),
      mid: toBins(BAND_HZ.mid),
      high: toBins(BAND_HZ.high),
    };
  }

  private bandEnergy([lo, hi]: [number, number]): number {
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.freqData[i];
    const count = hi - lo + 1;
    return count > 0 ? sum / count / 255 : 0;
  }

  /** Mutates `frame` in place with this tick's values. */
  update(frame: AudioFeatureFrame, time: number): void {
    this.analyser.getByteFrequencyData(this.freqData);

    const bass = this.bandEnergy(this.bins.bass);
    const lowMid = this.bandEnergy(this.bins.lowMid);
    const mid = this.bandEnergy(this.bins.mid);
    const high = this.bandEnergy(this.bins.high);
    const energy = (bass + lowMid + mid + high) / 4;

    this.smoothed.bass = smooth(this.smoothed.bass, bass);
    this.smoothed.lowMid = smooth(this.smoothed.lowMid, lowMid);
    this.smoothed.mid = smooth(this.smoothed.mid, mid);
    this.smoothed.high = smooth(this.smoothed.high, high);
    this.smoothed.energy = smooth(this.smoothed.energy, energy);

    // Spectral-flux style onset detection on the low end: compare the
    // current bass+lowMid energy against a slow rolling average. A big
    // positive jump above the average = a kick, rather than naive
    // "amplitude above a fixed threshold" which false-triggers constantly.
    const kickBand = bass * 0.7 + lowMid * 0.3;
    this.kickRollingAverage = this.kickRollingAverage * 0.93 + kickBand * 0.07;
    const flux = kickBand - this.kickRollingAverage;

    if (this.kickCooldown > 0) this.kickCooldown--;

    let kick = false;
    if (this.kickCooldown === 0 && flux > KICK_FLUX_THRESHOLD && kickBand > KICK_MIN_ENERGY) {
      kick = true;
      this.kickCooldown = KICK_COOLDOWN_FRAMES;
      frame.kickImpulse = 1;
    } else {
      frame.kickImpulse *= IMPULSE_DECAY;
    }

    frame.bass = this.smoothed.bass;
    frame.lowMid = this.smoothed.lowMid;
    frame.mid = this.smoothed.mid;
    frame.high = this.smoothed.high;
    frame.energy = this.smoothed.energy;
    frame.kick = kick;
    frame.time = time;
  }
}
