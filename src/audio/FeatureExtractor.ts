import type { AudioFeatureFrame } from './types';

type BandRange = [number, number];
type BandName = 'bass' | 'lowMid' | 'mid' | 'high';

const BAND_HZ: Record<BandName, BandRange> = {
  bass: [20, 150],
  lowMid: [150, 500],
  mid: [500, 2000],
  high: [2000, 9000],
};

// Continuous band smoothing (per second, converted to a frame-independent
// factor via 1 - exp(-rate*dt) each tick).
const ATTACK_RATE = 20;
const RELEASE_RATE = 5;
const FLUX_EXPOSE_RATE = 8; // smoothing for the continuous *Flux fields

const FLUX_MEAN_RATE = 6;
const FLUX_VAR_RATE = 4;

const KICK_SENSITIVITY = 1.5;
const KICK_MIN_VALUE = 0.05;
const KICK_MIN_INTERVAL = 0.11;

const SNARE_SENSITIVITY = 1.6;
const SNARE_MIN_VALUE = 0.035;
const SNARE_MIN_INTERVAL = 0.09;

const HIHAT_SENSITIVITY = 1.7;
const HIHAT_MIN_VALUE = 0.02;
const HIHAT_MIN_INTERVAL = 0.05;

const SHIFT_SENSITIVITY = 2.1;
const SHIFT_MIN_VALUE = 0.05;
const SHIFT_MIN_INTERVAL = 2.5; // beat switches should be rare
const SHIFT_SMOOTH_RATE = 3; // requires the distribution change to persist briefly
const SPECTRAL_BASELINE_RATE = 0.5; // slow — a single hit shouldn't move it much

const ENERGY_ENV_SLOW_RATE = 0.4;
const ENERGY_ENV_FAST_RATE = 2.2;
const SECTION_TREND_THRESHOLD = 0.16;
const SECTION_COOLDOWN = 4;

// A deliberately separate, even slower trailing average of `energy` than
// ENERGY_ENV_SLOW_RATE above — that one is tuned specifically for drop/
// breakdown trend detection and must not be repurposed (touching it would
// risk changing detection behavior). This is purely a "song mood" signal
// for slow visual baselines: ~5.5s time constant, so it genuinely reflects
// the last several seconds of the track, not the last beat.
const SECTION_MOOD_RATE = 0.18;

const IMPULSE_DECAY_RATE = 7;

function expSmooth(prev: number, next: number, ratePerSec: number, dt: number): number {
  const factor = 1 - Math.exp(-ratePerSec * dt);
  return prev + (next - prev) * factor;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Adaptive onset detector for a single flux signal: tracks a rolling
 * mean/variance of the signal itself and fires when it spikes above its
 * own recent baseline by `sensitivity` standard deviations. The same
 * mechanism drives the kick, snare, hi-hat, and spectral-shift detectors —
 * only the input signal, sensitivity, and refractory period differ.
 */
class FluxOnsetDetector {
  private mean = 0;
  private variance = 0;
  private cooldown = 0;

  /** Returns onset intensity (0..1) if this frame crosses threshold, else 0. */
  detect(value: number, dt: number, sensitivity: number, minValue: number, minInterval: number): number {
    this.mean = expSmooth(this.mean, value, FLUX_MEAN_RATE, dt);
    const flux = Math.max(0, value - this.mean);
    this.variance = expSmooth(this.variance, flux * flux, FLUX_VAR_RATE, dt);
    const std = Math.sqrt(Math.max(this.variance, 1e-6));
    const threshold = sensitivity * std;

    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown <= 0 && flux > threshold && value > minValue) {
      this.cooldown = minInterval;
      return clamp01(0.35 + (flux - threshold) / (threshold + 0.05));
    }
    return 0;
  }

  get baseline(): { mean: number; std: number } {
    return { mean: this.mean, std: Math.sqrt(Math.max(this.variance, 1e-6)) };
  }
}

/**
 * Turns raw FFT data from a single AnalyserNode into the semantic
 * AudioFeatureFrame that scenes consume. All buffers are allocated once in
 * the constructor and reused every frame — no per-frame allocation.
 *
 * Two layers of analysis:
 *  1. Continuous band energies (bass/lowMid/mid/high/energy) — smoothed
 *     amplitude, for ambient/continuous motion.
 *  2. Spectral flux (frame-to-frame positive spectral difference, per
 *     band group) fed into adaptive onset detectors — "did the frequency
 *     content suddenly change", which catches 808s/claps/hi-hats/beat
 *     switches that a pure-amplitude detector can miss.
 */
export class FeatureExtractor {
  private freqData: Uint8Array<ArrayBuffer>;
  private prevFreqData: Uint8Array<ArrayBuffer>;
  private bins: Record<BandName, [number, number]>;

  // All adaptive/stateful fields below are (re)initialized by resetState(),
  // shared between the constructor and the public reset() — see that
  // method's doc comment for why this matters.
  private smoothed = { bass: 0, lowMid: 0, mid: 0, high: 0, energy: 0 };

  private kickDetector = new FluxOnsetDetector();
  private snareDetector = new FluxOnsetDetector();
  private hihatDetector = new FluxOnsetDetector();
  private shiftDetector = new FluxOnsetDetector();

  private beatCounter = 0;
  private snareCounter = 0;
  private hihatCounter = 0;
  private shiftCounter = 0;
  private dropCounter = 0;
  private breakdownCounter = 0;
  private lastBeatTimestamp = -999;

  private specBaseLow = 0.4;
  private specBaseMid = 0.3;
  private specBaseHigh = 0.3;
  private shiftSmoothed = 0;

  private energyEnvSlow = 0;
  private energyEnvFast = 0;
  private dropCooldown = 0;
  private breakdownCooldown = 0;

  private impactSmoothed = 0;

  private sectionMood = 0;

  constructor(private analyser: AnalyserNode, sampleRate: number) {
    this.freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.prevFreqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

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

    this.resetState();
  }

  /** Clears every adaptive baseline/onset-detector/counter back to its
   *  starting value — called on construction, and again whenever playback
   *  has a discontinuity (a new track loaded, or a seek) so stale
   *  baselines from before the jump can't misfire onset detection against
   *  the new audio. Deliberately does NOT touch `freqData`/`prevFreqData`/
   *  `bins`, which depend on the analyser/sample rate, not on playback
   *  position. */
  reset(): void {
    this.resetState();
  }

  private resetState(): void {
    this.smoothed = { bass: 0, lowMid: 0, mid: 0, high: 0, energy: 0 };

    this.kickDetector = new FluxOnsetDetector();
    this.snareDetector = new FluxOnsetDetector();
    this.hihatDetector = new FluxOnsetDetector();
    this.shiftDetector = new FluxOnsetDetector();

    this.beatCounter = 0;
    this.snareCounter = 0;
    this.hihatCounter = 0;
    this.shiftCounter = 0;
    this.dropCounter = 0;
    this.breakdownCounter = 0;
    this.lastBeatTimestamp = -999;

    this.specBaseLow = 0.4;
    this.specBaseMid = 0.3;
    this.specBaseHigh = 0.3;
    this.shiftSmoothed = 0;

    this.energyEnvSlow = 0;
    this.energyEnvFast = 0;
    this.dropCooldown = 0;
    this.breakdownCooldown = 0;

    this.impactSmoothed = 0;

    this.sectionMood = 0;

    if (this.prevFreqData) this.prevFreqData.fill(0);
  }

  private bandEnergy([lo, hi]: [number, number]): number {
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.freqData[i];
    const count = hi - lo + 1;
    return count > 0 ? sum / count / 255 : 0;
  }

  /** Sum of positive frame-to-frame differences over a bin range —
   *  "spectral flux": how much louder this band just got, ignoring how
   *  much quieter (a decaying tail shouldn't register as an event). */
  private fluxOverBins([lo, hi]: [number, number]): number {
    let sum = 0;
    for (let i = lo; i <= hi; i++) {
      const diff = this.freqData[i] - this.prevFreqData[i];
      if (diff > 0) sum += diff;
    }
    const count = hi - lo + 1;
    return count > 0 ? sum / count / 255 : 0;
  }

  /** Mutates `frame` in place with this tick's values. `dt` is the time in
   *  seconds since the previous call — used to make smoothing, decay, and
   *  cooldown timing independent of frame rate. */
  update(frame: AudioFeatureFrame, time: number, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.1);

    this.analyser.getByteFrequencyData(this.freqData);

    const bass = this.bandEnergy(this.bins.bass);
    const lowMid = this.bandEnergy(this.bins.lowMid);
    const mid = this.bandEnergy(this.bins.mid);
    const high = this.bandEnergy(this.bins.high);
    const energy = (bass + lowMid + mid + high) / 4;

    // Spectral flux per group, computed against last frame's raw data
    // BEFORE we overwrite it.
    const bassFlux = this.fluxOverBins(this.bins.bass);
    const midFlux = this.fluxOverBins(this.bins.lowMid) * 0.4 + this.fluxOverBins(this.bins.mid) * 0.6;
    const highFlux = this.fluxOverBins(this.bins.high);
    const spectralFlux = bassFlux + midFlux + highFlux;
    this.prevFreqData.set(this.freqData);

    this.smoothed.bass = this.smoothTowards(this.smoothed.bass, bass, safeDt);
    this.smoothed.lowMid = this.smoothTowards(this.smoothed.lowMid, lowMid, safeDt);
    this.smoothed.mid = this.smoothTowards(this.smoothed.mid, mid, safeDt);
    this.smoothed.high = this.smoothTowards(this.smoothed.high, high, safeDt);
    this.smoothed.energy = this.smoothTowards(this.smoothed.energy, energy, safeDt);

    frame.bassFlux = expSmooth(frame.bassFlux, bassFlux, FLUX_EXPOSE_RATE, safeDt);
    frame.midFlux = expSmooth(frame.midFlux, midFlux, FLUX_EXPOSE_RATE, safeDt);
    frame.highFlux = expSmooth(frame.highFlux, highFlux, FLUX_EXPOSE_RATE, safeDt);
    frame.spectralFlux = expSmooth(frame.spectralFlux, spectralFlux, FLUX_EXPOSE_RATE, safeDt);

    // --- Beat/808/kick: bass-band flux, adaptive threshold. -------------
    const beatIntensity = this.kickDetector.detect(bassFlux, safeDt, KICK_SENSITIVITY, KICK_MIN_VALUE, KICK_MIN_INTERVAL);
    if (beatIntensity > 0) {
      this.beatCounter += 1;
      frame.beatId = this.beatCounter;
      frame.beatIntensity = beatIntensity;
      frame.beatTime = time;
      frame.kickImpulse = 1;

      const rawInterval = time - this.lastBeatTimestamp;
      if (rawInterval > 0.15 && rawInterval < 2.5) {
        frame.beatInterval = expSmooth(frame.beatInterval, rawInterval, 3, rawInterval);
      }
      this.lastBeatTimestamp = time;
    } else {
      frame.kickImpulse *= Math.exp(-IMPULSE_DECAY_RATE * safeDt);
    }

    // --- Snare/clap: combined mid+high flux, its own adaptive baseline. -
    const snareIntensity = this.snareDetector.detect(midFlux + highFlux, safeDt, SNARE_SENSITIVITY, SNARE_MIN_VALUE, SNARE_MIN_INTERVAL);
    if (snareIntensity > 0) {
      this.snareCounter += 1;
      frame.snareHitId = this.snareCounter;
      frame.snareHitIntensity = snareIntensity;
    }

    // --- Hi-hat: high-band flux alone, fast refractory. ------------------
    const hihatIntensity = this.hihatDetector.detect(highFlux, safeDt, HIHAT_SENSITIVITY, HIHAT_MIN_VALUE, HIHAT_MIN_INTERVAL);
    if (hihatIntensity > 0) {
      this.hihatCounter += 1;
      frame.hihatId = this.hihatCounter;
      frame.hihatIntensity = hihatIntensity;
    }

    // --- Spectral shift: has the frequency *distribution* changed, not
    // just the loudness? Track slow-moving baseline proportions and
    // measure how far the current frame's proportions have drifted. -----
    const total = bass + lowMid + mid + high + 1e-5;
    const propLow = (bass + lowMid) / total;
    const propMid = mid / total;
    const propHigh = high / total;
    this.specBaseLow = expSmooth(this.specBaseLow, propLow, SPECTRAL_BASELINE_RATE, safeDt);
    this.specBaseMid = expSmooth(this.specBaseMid, propMid, SPECTRAL_BASELINE_RATE, safeDt);
    this.specBaseHigh = expSmooth(this.specBaseHigh, propHigh, SPECTRAL_BASELINE_RATE, safeDt);
    const distance =
      Math.abs(propLow - this.specBaseLow) + Math.abs(propMid - this.specBaseMid) + Math.abs(propHigh - this.specBaseHigh);
    // Smoothing the distance itself (rather than firing on raw per-frame
    // distance) approximates "persisted for a few frames" without needing
    // explicit frame counting — a single transient hit decays away too
    // fast to build up here, while a genuine distribution change doesn't.
    this.shiftSmoothed = expSmooth(this.shiftSmoothed, distance, SHIFT_SMOOTH_RATE, safeDt);
    const shiftIntensity = this.shiftDetector.detect(this.shiftSmoothed, safeDt, SHIFT_SENSITIVITY, SHIFT_MIN_VALUE, SHIFT_MIN_INTERVAL);
    if (shiftIntensity > 0) {
      this.shiftCounter += 1;
      frame.spectralShiftId = this.shiftCounter;
      frame.spectralShiftIntensity = shiftIntensity;
    }

    // --- Drop / breakdown: fast-vs-slow energy envelope trend. -----------
    this.energyEnvSlow = expSmooth(this.energyEnvSlow, energy, ENERGY_ENV_SLOW_RATE, safeDt);
    this.energyEnvFast = expSmooth(this.energyEnvFast, energy, ENERGY_ENV_FAST_RATE, safeDt);
    const trend = this.energyEnvFast - this.energyEnvSlow;
    this.dropCooldown = Math.max(0, this.dropCooldown - safeDt);
    this.breakdownCooldown = Math.max(0, this.breakdownCooldown - safeDt);
    if (this.dropCooldown <= 0 && trend > SECTION_TREND_THRESHOLD && this.energyEnvSlow > 0.22) {
      this.dropCounter += 1;
      frame.dropId = this.dropCounter;
      this.dropCooldown = SECTION_COOLDOWN;
    }
    if (this.breakdownCooldown <= 0 && trend < -SECTION_TREND_THRESHOLD && this.energyEnvSlow > 0.28) {
      this.breakdownCounter += 1;
      frame.breakdownId = this.breakdownCounter;
      this.breakdownCooldown = SECTION_COOLDOWN;
    }

    // --- Composite impact score: each flux normalized against its own
    // detector's adaptive baseline, so a signal well above ITS OWN typical
    // noise floor counts even if the others are quiet. --------------------
    const kb = this.kickDetector.baseline;
    const sb = this.snareDetector.baseline;
    const hb = this.hihatDetector.baseline;
    const bassNorm = clamp01(bassFlux / (kb.mean + kb.std * 2 + 1e-4));
    const midNorm = clamp01((midFlux + highFlux) / (sb.mean + sb.std * 2 + 1e-4));
    const highNorm = clamp01(highFlux / (hb.mean + hb.std * 2 + 1e-4));
    const rawImpact = clamp01(bassNorm * 0.4 + midNorm * 0.35 + highNorm * 0.25);
    this.impactSmoothed = expSmooth(this.impactSmoothed, rawImpact, rawImpact > this.impactSmoothed ? 15 : 4, safeDt);
    frame.impactScore = this.impactSmoothed;

    frame.bass = this.smoothed.bass;
    frame.lowMid = this.smoothed.lowMid;
    frame.mid = this.smoothed.mid;
    frame.high = this.smoothed.high;
    frame.energy = this.smoothed.energy;
    frame.time = time;

    // Section mood: a completely independent, much slower trailing average
    // of energy than anything the detectors above use — see the constant's
    // comment. Read by slow visual baselines only, never by anything that
    // should react quickly.
    this.sectionMood = expSmooth(this.sectionMood, energy, SECTION_MOOD_RATE, safeDt);
    frame.sectionMood = this.sectionMood;
  }

  private smoothTowards(prev: number, next: number, dt: number): number {
    const rate = next > prev ? ATTACK_RATE : RELEASE_RATE;
    return expSmooth(prev, next, rate, dt);
  }
}
