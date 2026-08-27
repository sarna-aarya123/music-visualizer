import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeBreakdown, consumeDrop, createBeatConsumerState, type BeatConsumerState } from '../../../audio/beatConsumer';
import { WorldDirector } from './worldDirector';

/**
 * The speed model: "music controls the ride" — but deliberately NOT
 * "every audio fluctuation maps directly to velocity", which reads as
 * jittery/random and, worse, means the camera is constantly racing so no
 * single musical moment stands out.
 *
 * Three distinct layers, matching the musical hierarchy:
 *  1. Continuous `energy` sets a *subtle* cruise-speed range — the camera
 *     spends most of a song here, floating during quiet parts, a bit
 *     brisker during louder ones, never extreme on its own.
 *  2. A `sectionMultiplier` driven by structural events (`dropId` /
 *     `breakdownId`, not raw energy) is what actually produces the big
 *     speed swings: a drop snaps the multiplier up and holds it for a few
 *     seconds ("fast section") before easing back to cruise; a breakdown
 *     does the opposite. This is the `cruise -> build -> DROP -> fast
 *     section -> settle` curve.
 *  3. Small additive bursts on top for beats — but only strong ones (see
 *     CameraRig, which gates on beatIntensity before calling
 *     applyBeatBurst at all) — and a much larger dedicated launch for a
 *     full major event (musicEventDirector.ts).
 */

// Phase 5: retuned against the route's actual measured length (~2,189
// world units for the current WORLD_SEED) and a 3-4 minute song target —
// not an arbitrary multiplier. At the old MAX_SPEED=15, a full lap took
// ~146s even at peak energy, and MIN_SPEED=4 meant ~550s (nearly 10
// minutes) at calm — the character could go an entire song without
// completing one lap, which is the direct cause of "everything feels
// slow" regardless of how reactive the world was. Retuned so a calm
// section still completes a lap within roughly one song (MIN_SPEED lap
// ≈ 219s) while a sustained high-energy cruise laps in about a minute
// (MAX_SPEED lap ≈ 64s) — genuinely brisk, arcade-paced, without being
// so fast the route/world reads as a blur.
export const MIN_SPEED = 10;
export const MAX_SPEED = 34;
// Raised alongside MAX_SPEED so a full-energy drop (MAX_SPEED *
// DROP_MULTIPLIER ≈ 78) still has headroom below the cap rather than being
// clipped by a ceiling sized for the old, much lower cruise range.
export const MAX_SPEED_CAP = 95;

const BURST_BASE = 2.5;
const BURST_SCALE = 7;
const MAJOR_LAUNCH_BASE = 14;
const MAJOR_LAUNCH_SCALE = 22;

// Slightly sharpened (was 3.2/1.4) — a modest tightening, not a rewrite of
// the acceleration model. Time constants now ~0.26s up / ~0.59s down,
// giving acceleration/deceleration a bit more punch to match the wider
// speed range above.
const SPEED_TRACK_RATE_UP = 3.8;
const SPEED_TRACK_RATE_DOWN = 1.7;

const DROP_MULTIPLIER = 2.3;
const DROP_HOLD_SECONDS = 4.5;
const BREAKDOWN_MULTIPLIER = 0.4;
const BREAKDOWN_HOLD_SECONDS = 5;
const MULTIPLIER_RELAX_RATE = 0.35; // how fast the *target* eases back to 1 once the hold expires
const MULTIPLIER_TRACK_RATE = 1.3; // how fast the *actual* multiplier follows its target

export function computeTargetSpeed(energy: number): number {
  const eased = THREE.MathUtils.smoothstep(energy, 0, 1);
  return THREE.MathUtils.lerp(MIN_SPEED, MAX_SPEED, eased);
}

// Phase 5 step 2: a single shared "how fast does this feel" fraction, used
// by every speed-driven visual cue (camera FOV, particle parallax,
// guardrail pulse, camera follow distance/height) instead of each one
// separately normalizing against MAX_SPEED_CAP. MAX_SPEED_CAP (95) is a
// rarely-reached burst ceiling — normalizing everyday cruise speed against
// it was exactly why those cues stayed nearly flat during normal play (see
// Phase 5 investigation). Anchored instead to the real cruise range
// (MIN_SPEED..MAX_SPEED*1.15): reaching MAX_SPEED during a sustained
// high-energy cruise already reads as ~83% "fast", leaving a modest amount
// of headroom above cruise for drop-driven bursts to still register as
// "even faster" without needing an extreme, rarely-touched top end.
const SPEED_PERCEPTION_CEIL = MAX_SPEED * 1.15;

export function speedPerceptionFrac(speed: number): number {
  return THREE.MathUtils.clamp((speed - MIN_SPEED) / (SPEED_PERCEPTION_CEIL - MIN_SPEED), 0, 1);
}

export interface SpeedState {
  current: number;
  sectionMultiplier: number;
  sectionMultiplierTarget: number;
  sectionHoldTimer: number;
  dropConsumer: BeatConsumerState;
  breakdownConsumer: BeatConsumerState;
}

export function createSpeedState(): SpeedState {
  return {
    current: MIN_SPEED,
    sectionMultiplier: 1,
    sectionMultiplierTarget: 1,
    sectionHoldTimer: 0,
    dropConsumer: createBeatConsumerState(),
    breakdownConsumer: createBeatConsumerState(),
  };
}

/** Reserved for strong beats only — the caller (CameraRig) decides what
 *  counts as "strong" by gating on beatIntensity before calling this. */
export function applyBeatBurst(state: SpeedState, beatIntensity: number): void {
  state.current = Math.min(state.current + BURST_BASE + beatIntensity * BURST_SCALE, MAX_SPEED_CAP);
}

export function applyMajorLaunch(state: SpeedState, intensity: number): void {
  state.current = Math.min(state.current + MAJOR_LAUNCH_BASE + intensity * MAJOR_LAUNCH_SCALE, MAX_SPEED_CAP);
}

export function stepSpeed(state: SpeedState, dt: number, frame: AudioFeatureFrame): void {
  const dropHit = consumeDrop(frame, state.dropConsumer);
  if (dropHit > 0) {
    state.sectionMultiplierTarget = DROP_MULTIPLIER;
    state.sectionHoldTimer = DROP_HOLD_SECONDS;
  }
  const breakdownHit = consumeBreakdown(frame, state.breakdownConsumer);
  if (breakdownHit > 0) {
    state.sectionMultiplierTarget = BREAKDOWN_MULTIPLIER;
    state.sectionHoldTimer = BREAKDOWN_HOLD_SECONDS;
  }

  if (state.sectionHoldTimer > 0) {
    state.sectionHoldTimer -= dt;
  } else {
    // Hold expired — let the target drift back to neutral, so the
    // transition out of a fast/slow section is itself gradual rather than
    // an abrupt snap back to cruise.
    state.sectionMultiplierTarget += (1 - state.sectionMultiplierTarget) * (1 - Math.exp(-MULTIPLIER_RELAX_RATE * dt));
  }
  state.sectionMultiplier += (state.sectionMultiplierTarget - state.sectionMultiplier) * (1 - Math.exp(-MULTIPLIER_TRACK_RATE * dt));

  // A brief "everyone holds their breath" dip right before a major event's
  // release lands — the world (and the character riding it) slows
  // slightly during the sequence's pre-drop hold (Phase 6 Stage 3: now
  // 'buildup'+'tension', was the old single ~0.3s 'anticipation' phase),
  // so the drop itself reads as a release.
  const seq = WorldDirector.sequence;
  const anticipationDamp = seq.phase === 'buildup' || seq.phase === 'tension' ? 0.7 : 1;

  const target = computeTargetSpeed(frame.energy) * state.sectionMultiplier * anticipationDamp;
  const rate = target > state.current ? SPEED_TRACK_RATE_UP : SPEED_TRACK_RATE_DOWN;
  state.current += (target - state.current) * (1 - Math.exp(-rate * dt));
  state.current = Math.max(state.current, 0);
}
