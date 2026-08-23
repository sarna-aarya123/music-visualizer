import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeBeat, consumeHihat, consumeSnareHit, createBeatConsumerState } from '../../../audio/beatConsumer';

/**
 * Two persistent, heavily-smoothed musical states that nothing else in the
 * codebase currently tracks — both derived entirely from fields
 * `AudioFeatureFrame` already exposes (see Phase 4 investigation), no
 * FeatureExtractor/onset-detection changes involved:
 *
 * - `drumPresence` (0..1): is rhythmic/percussive activity CURRENTLY
 *   happening, as a smooth continuous state — not "did a beat just fire"
 *   (that's `beatId`/the existing exactly-once pattern, still used
 *   verbatim below) but "has kick/snare/hihat activity been arriving
 *   recently, or has it gone quiet". Rises quickly once hits resume,
 *   falls slowly and only after a real silence window — it should read as
 *   "the drums are here" / "the drums dropped out", not flicker with
 *   every individual hit.
 * - `energyTrend` (signed, small range): is the song's energy presently
 *   rising or falling, on a multi-second timescale — a second, even
 *   slower trailing average OF `frame.sectionMood` (itself already a
 *   ~5.5s trailing average from Phase 3), so this is "is the recent past
 *   louder than the more distant past", not a beat-scale ripple.
 *
 * Both are consumed by world systems as a slow BASELINE input, layered
 * underneath (never replacing) the existing beat/drop/major-event accents
 * — exactly the hierarchy the world's other reactive systems already use
 * for `sectionMood`.
 */
export interface RhythmState {
  drumPresence: number;
  energyTrend: number;
}

export const rhythmState: RhythmState = {
  drumPresence: 0,
  energyTrend: 0,
};

// How long since the last kick/snare/hihat before presence starts easing
// back down — a real pause, not "the very next silent frame", but tight
// enough that "drums stopped" reads within a couple of seconds rather than
// four-plus (Phase 4.1: visual tuning pass — the original 1.8s/0.35 combo
// was confirmed too gradual to register as an obvious state change).
const DRUM_SILENCE_WINDOW = 1.0;
// Rising is quicker (drums resuming should read as "waking up" almost
// immediately) than falling (dropping out should still read as a
// deliberate calm-down, not a hard cut) — but both tightened substantially
// from Phase 4's original pass so the drums-in/drums-out contrast is
// unmistakable within ~1-2s each way.
const PRESENCE_RISE_RATE = 8;
const PRESENCE_FALL_RATE = 1.0;

// Deliberately much slower than sectionMood's own 0.18 rate (~5.5s) — this
// is a trailing average OF that trailing average, so comparing the two
// gives a genuine multi-second direction rather than anything beat-scale.
const MOOD_SLOW_RATE = 0.06;
// One more smoothing pass on the trend itself so it eases rather than
// jitters as sectionMood wobbles around its own slow baseline.
const TREND_SMOOTH_RATE = 0.15;
// The raw sectionMood-vs-its-own-trailing-average difference is small by
// construction (sectionMood itself only spans ~0..1) — a gain here so the
// exposed `energyTrend` actually reaches a usable range for world systems,
// rather than consumers each having to re-amplify a nearly-flat signal.
const TREND_GAIN = 2.6;
const TREND_CLAMP = 1.0;

let timeSinceDrumEvent = 999;
let sectionMoodSlow = 0;
let trendSmoothed = 0;

const beatConsumer = createBeatConsumerState();
const snareConsumer = createBeatConsumerState();
const hihatConsumer = createBeatConsumerState();

function expSmooth(prev: number, next: number, ratePerSec: number, dt: number): number {
  const factor = 1 - Math.exp(-ratePerSec * dt);
  return prev + (next - prev) * factor;
}

export function stepRhythmState(dt: number, frame: AudioFeatureFrame): void {
  // Any kick/snare/hihat hit resets the silence clock — same exactly-once
  // consumption pattern every other system in this codebase already uses,
  // just combined from three detectors into one "was there percussive
  // activity this frame" signal instead of driving a visual effect
  // directly.
  const beatHit = consumeBeat(frame, beatConsumer);
  const snareHit = consumeSnareHit(frame, snareConsumer);
  const hihatHit = consumeHihat(frame, hihatConsumer);
  if (beatHit > 0 || snareHit > 0 || hihatHit > 0) {
    timeSinceDrumEvent = 0;
  } else {
    timeSinceDrumEvent += dt;
  }

  const presenceTarget = timeSinceDrumEvent < DRUM_SILENCE_WINDOW ? 1 : 0;
  const presenceRate = presenceTarget > rhythmState.drumPresence ? PRESENCE_RISE_RATE : PRESENCE_FALL_RATE;
  rhythmState.drumPresence = expSmooth(rhythmState.drumPresence, presenceTarget, presenceRate, dt);

  sectionMoodSlow = expSmooth(sectionMoodSlow, frame.sectionMood, MOOD_SLOW_RATE, dt);
  const rawTrend = frame.sectionMood - sectionMoodSlow;
  trendSmoothed = expSmooth(trendSmoothed, rawTrend, TREND_SMOOTH_RATE, dt);
  rhythmState.energyTrend = Math.max(-TREND_CLAMP, Math.min(TREND_CLAMP, trendSmoothed * TREND_GAIN));
}

/** Matches `resetMusicEventDirector`/`resetCinematicDirector`'s exact
 *  shape — called from the same `resetToken` effect on a new track or a
 *  seek, so stale pre-jump drum-silence timing or trend baselines can't
 *  leak into the new playback position. */
export function resetRhythmState(): void {
  rhythmState.drumPresence = 0;
  rhythmState.energyTrend = 0;
  timeSinceDrumEvent = 999;
  sectionMoodSlow = 0;
  trendSmoothed = 0;
  beatConsumer.lastId = -1;
  snareConsumer.lastId = -1;
  hihatConsumer.lastId = -1;
}
