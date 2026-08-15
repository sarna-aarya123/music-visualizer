import type { AudioFeatureFrame } from './types';

type BandRange = [number, number];
type BandName = 'bass' | 'lowMid' | 'mid' | 'high';

const BAND_HZ: Record<BandName, BandRange> = {
  bass: [20, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 9000],
};

// Smoothing rates are in "per second", not "per frame" — converted to a
// frame-independent factor via 1 - exp(-rate * dt) each tick, so behavior
// stays consistent regardless of the display's refresh rate.
const ATTACK_RATE = 20; // fast rise
const RELEASE_RATE = 5; // slower fall — reads as cinematic, not flickery

// Beat/onset detection is adaptive rather than a fixed threshold: it
// compares each frame's low-end "flux" (how much louder the low end just
// got) against a rolling mean + standard deviation of recent flux. That
// makes it self-normalize to a track's own loudness/mastering instead of
// only working on tracks that happen to match a hardcoded number — the fix
// for "sometimes reacts, sometimes doesn't".
const FLUX_BASELINE_RATE = 6; // how fast the rolling mean adapts (per sec)
const FLUX_VARIANCE_RATE = 4;
const SENSITIVITY = 1.5; // multiples of stddev above the mean to count as a beat
const MIN_ENERGY_FLOOR = 0.05; // ignore near-silence so noise doesn't "beat"
const MIN_STD = 0.01; // floor for stddev so dead-quiet sections don't over-trigger
const MIN_BEAT_INTERVAL = 0.11; // seconds — caps detection at ~9/sec, tempo-independent
const IMPULSE_DECAY_RATE = 7; // per second, exponential

function expSmooth(prev: number, next: number, ratePerSec: number, dt: number): number {
  const factor = 1 - Math.exp(-ratePerSec * dt);
  return prev + (next - prev) * factor;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
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

  private fluxMean = 0;
  private fluxVariance = 0;
  private timeSinceLastBeat = 10;
  private beatCounter = 0;

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

  /** Mutates `frame` in place with this tick's values. `dt` is the time in
   *  seconds since the previous call — used to make smoothing, decay, and
   *  cooldown timing independent of frame rate. */
  update(frame: AudioFeatureFrame, time: number, dt: number): void {
    // Guard against huge dt spikes (tab backgrounded, debugger pause, etc.)
    const safeDt = Math.min(Math.max(dt, 0), 0.1);

    this.analyser.getByteFrequencyData(this.freqData);

    const bass = this.bandEnergy(this.bins.bass);
    const lowMid = this.bandEnergy(this.bins.lowMid);
    const mid = this.bandEnergy(this.bins.mid);
    const high = this.bandEnergy(this.bins.high);
    const energy = (bass + lowMid + mid + high) / 4;

    this.smoothed.bass = this.smoothTowards(this.smoothed.bass, bass, safeDt);
    this.smoothed.lowMid = this.smoothTowards(this.smoothed.lowMid, lowMid, safeDt);
    this.smoothed.mid = this.smoothTowards(this.smoothed.mid, mid, safeDt);
    this.smoothed.high = this.smoothTowards(this.smoothed.high, high, safeDt);
    this.smoothed.energy = this.smoothTowards(this.smoothed.energy, energy, safeDt);

    // --- Adaptive onset/beat detection -------------------------------
    // Raw (unsmoothed) low-end energy this frame vs. a slow-moving
    // baseline gives us "flux": a positive spike means the low end just
    // got a lot louder than it recently has been — a kick/onset.
    const kickBand = bass * 0.65 + lowMid * 0.35;
    this.fluxMean = expSmooth(this.fluxMean, kickBand, FLUX_BASELINE_RATE, safeDt);
    const flux = Math.max(0, kickBand - this.fluxMean);
    const varianceSample = (flux - this.fluxMean) * (flux - this.fluxMean);
    this.fluxVariance = expSmooth(this.fluxVariance, varianceSample, FLUX_VARIANCE_RATE, safeDt);
    const fluxStd = Math.max(Math.sqrt(this.fluxVariance), MIN_STD);
    const adaptiveThreshold = SENSITIVITY * fluxStd;

    this.timeSinceLastBeat += safeDt;

    const isBeat =
      this.timeSinceLastBeat >= MIN_BEAT_INTERVAL &&
      flux > adaptiveThreshold &&
      kickBand > MIN_ENERGY_FLOOR;

    if (isBeat) {
      this.beatCounter += 1;
      this.timeSinceLastBeat = 0;
      frame.beatId = this.beatCounter;
      frame.beatIntensity = clamp01(0.35 + (flux - adaptiveThreshold) / (adaptiveThreshold + 0.05));
      frame.beatTime = time;
      frame.kickImpulse = 1;
    } else {
      frame.kickImpulse *= Math.exp(-IMPULSE_DECAY_RATE * safeDt);
    }

    frame.bass = this.smoothed.bass;
    frame.lowMid = this.smoothed.lowMid;
    frame.mid = this.smoothed.mid;
    frame.high = this.smoothed.high;
    frame.energy = this.smoothed.energy;
    frame.time = time;
  }

  private smoothTowards(prev: number, next: number, dt: number): number {
    const rate = next > prev ? ATTACK_RATE : RELEASE_RATE;
    return expSmooth(prev, next, rate, dt);
  }
}
