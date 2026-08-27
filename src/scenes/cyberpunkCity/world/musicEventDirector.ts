import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeDrop, consumeSpectralShift, createBeatConsumerState } from '../../../audio/beatConsumer';

/**
 * The system that decides when something musically big enough has
 * happened to warrant a rare, major, coordinated world event — not every
 * beat, not even every strong beat, but genuine drops/beat-switches/huge
 * transients. Every reactive system (camera, buildings, ground, particles,
 * atmosphere, post-processing) reads the same `majorEventState` singleton
 * and renders its own piece of the event, scaled by the same lifecycle
 * envelope, so the whole world moves together for that moment.
 *
 * Phase 6 Stage 3: this is a genuine 10-15s cinematic sequence now, not a
 * ~2.57s flash — see `PHASE_DURATIONS` below.
 *
 * Lifecycle: idle -> buildup -> tension -> drop -> transform -> reveal ->
 * aftermath -> idle. `impactEventId` increments exactly once per event,
 * right as it enters 'drop' (the release moment — same semantics as the
 * old 'impact' phase it replaces) — consumers use the same exactly-once
 * beatConsumer mechanism against it for one-shot reactions (a velocity
 * launch, a ripple, a particle burst, the character's jump), while
 * `getMajorEventEnvelope()` gives a continuous 0..1 value any consumer can
 * read every frame for a smooth surge-and-fade across the whole sequence.
 *
 * WHEN a sequence starts is completely unchanged from before this stage:
 * same three trigger sources (`dropId`, a spectral shift over
 * `SPECTRAL_SHIFT_BAR`, or an impact-score spike), same `MIN_EVENT_GAP`
 * cooldown, same thresholds. Only what happens AFTER a trigger fires got
 * bigger. See the "known limitation" note below — this is deliberate.
 *
 * **Known limitation (by design, not an oversight):** `dropId` fires AT
 * the detected drop, not before it — there is no offline pre-analysis of
 * the track (that's the separately-flagged, not-yet-built "Stage A" in
 * `PLAN.md`). So `buildup`/`tension` below are NOT genuine pre-drop
 * anticipation; they are a brief, deliberately-short POST-trigger hold
 * (same technique the old 0.3s 'anticipation' phase already used and the
 * project had already approved — see CameraRig's "Phase 4.1" comment)
 * stretched a bit further and staged more dramatically, not a prediction
 * of the future. Keeping this pre-release hold short (≈1.9s combined,
 * versus the ~9.1s combined for transform/reveal/aftermath after the
 * release) is intentional: delaying the visual release much further would
 * put the camera/world release noticeably out of sync with the audio,
 * which has already dropped by the time `stepMusicEventDirector` sees it.
 * The genuinely long, cinematic part of this sequence is everything AFTER
 * the release, where there's no sync constraint against a single instant.
 */

export type MajorEventPhase = 'idle' | 'buildup' | 'tension' | 'drop' | 'transform' | 'reveal' | 'aftermath';

export interface MajorEventState {
  phase: MajorEventPhase;
  phaseTime: number;
  intensity: number;
  impactEventId: number;
  originPosition: THREE.Vector3;
}

export const majorEventState: MajorEventState = {
  phase: 'idle',
  phaseTime: 0,
  intensity: 0,
  impactEventId: 0,
  originPosition: new THREE.Vector3(),
};

/** Total ≈13s — mid-range of the requested 10-15s. Fixed constants, same
 *  style as the phase durations they replace (no intensity-based scaling
 *  yet — a reasonable future refinement, not needed to prove the sequence
 *  system itself). See the file-level comment for why buildup/tension stay
 *  short while transform/reveal/aftermath carry most of the duration. */
export const PHASE_DURATIONS: Record<Exclude<MajorEventPhase, 'idle'>, number> = {
  buildup: 1.0,
  tension: 0.9,
  drop: 0.5,
  transform: 3.0,
  reveal: 3.6,
  aftermath: 4.0,
};

const PHASE_ORDER: MajorEventPhase[] = ['buildup', 'tension', 'drop', 'transform', 'reveal', 'aftermath', 'idle'];

/** Major events must stay rare to feel special — this is the single
 *  biggest lever for "obvious but not exhausting". Unchanged from before
 *  Stage 3: a new trigger is only even considered while `phase === 'idle'`
 *  (see below), and since one full sequence now runs ≈13s — already
 *  longer than this 7s gap — sequences can never overlap; the gap is
 *  effectively `max(MIN_EVENT_GAP, sequence duration)` without needing to
 *  change this constant at all. */
const MIN_EVENT_GAP = 7;
const IMPACT_SCORE_BAR = 0.86;
const SPECTRAL_SHIFT_BAR = 0.55;
/** impactScore weights bass/mid/high flux together, so a burst of pure
 *  hi-hats or snares alone can spike it — but a major event physically
 *  moves the camera (see CameraRig), and hi-hats/snares must never do
 *  that. Requiring real overall loudness alongside the impact spike is a
 *  cheap, effective guard against that indirect path: a hi-hat flurry
 *  with everything else quiet won't have high `energy`, but a genuine
 *  drop or 808-heavy passage will. */
const IMPACT_SPIKE_MIN_ENERGY = 0.4;

let impactCounter = 0;
let lastMajorEventTime = -999;
const dropConsumer = createBeatConsumerState();
const shiftConsumer = createBeatConsumerState();

export function stepMusicEventDirector(
  dt: number,
  frame: AudioFeatureFrame,
  cameraPosition: THREE.Vector3,
  elapsed: number
): void {
  majorEventState.phaseTime += dt;

  if (majorEventState.phase !== 'idle') {
    const duration = PHASE_DURATIONS[majorEventState.phase];
    if (majorEventState.phaseTime > duration) {
      const next = PHASE_ORDER[PHASE_ORDER.indexOf(majorEventState.phase) + 1] ?? 'idle';
      majorEventState.phase = next;
      majorEventState.phaseTime = 0;
      if (next === 'drop') {
        impactCounter += 1;
        majorEventState.impactEventId = impactCounter;
      }
    }
  }

  // Trigger conditions are byte-for-byte unchanged from before Stage 3 —
  // same sources, same thresholds, same cooldown. Only entered while idle,
  // so a sequence already in flight can never be interrupted or restarted
  // by a second trigger (the "ignore" policy from PLAN.md §9.8) — the next
  // trigger simply waits for this sequence to reach 'idle' again.
  if (majorEventState.phase === 'idle') {
    const dropHit = consumeDrop(frame, dropConsumer);
    const shiftHit = consumeSpectralShift(frame, shiftConsumer);
    const impactSpike = frame.impactScore > IMPACT_SCORE_BAR && frame.energy > IMPACT_SPIKE_MIN_ENERGY;
    const cooldownOk = elapsed - lastMajorEventTime > MIN_EVENT_GAP;

    if (cooldownOk && (dropHit > 0 || shiftHit > SPECTRAL_SHIFT_BAR || impactSpike)) {
      majorEventState.phase = 'buildup';
      majorEventState.phaseTime = 0;
      majorEventState.intensity = Math.max(dropHit > 0 ? 0.85 : 0, shiftHit, frame.impactScore);
      majorEventState.originPosition.copy(cameraPosition);
      lastMajorEventTime = elapsed;
    }
  }
}

/** Clears the major-event lifecycle back to idle and forgets the previous
 *  track's cooldown timer — called on a new track load or a seek (see
 *  audioStore's `resetToken`), so a stale mid-sequence phase or a
 *  wall-clock-anchored `lastMajorEventTime` from before the jump can't
 *  leak into the new playback position. A seek mid-sequence simply drops
 *  the in-flight sequence entirely rather than trying to resume or
 *  fast-forward it — consistent with every other stateful system's reset
 *  behavior in this project. */
export function resetMusicEventDirector(): void {
  majorEventState.phase = 'idle';
  majorEventState.phaseTime = 0;
  majorEventState.intensity = 0;
  majorEventState.impactEventId = 0;
  majorEventState.originPosition.set(0, 0, 0);
  impactCounter = 0;
  lastMajorEventTime = -999;
  dropConsumer.lastId = -1;
  shiftConsumer.lastId = -1;
}

/** A continuous 0..1 envelope (scaled by the triggering event's own
 *  `intensity`) for the current point in the sequence — every existing
 *  reactive system (camera altitude/FOV/banking, prop emissive/rim,
 *  post-processing bloom/vignette/chromatic aberration, sky uniforms)
 *  already reads this every frame, so reshaping this one curve is what
 *  extends ALL of them across the new, longer sequence — no changes
 *  needed in any of those consumers. Safe to read every frame from
 *  anywhere.
 *
 *  Shape, phase by phase:
 *  - `buildup`: ramps 0 -> 0.35 — a gathering lead-in.
 *  - `tension`: HOLDS near a plateau (≈0.4-0.5) with a slight pulse rather
 *    than continuing to climb — the "hold your breath" beat has to read as
 *    a hold, not a second buildup ramp.
 *  - `drop`: jumps straight to the full intensity and holds there for the
 *    (brief) phase — the release. This is the one deliberately abrupt step
 *    in the whole curve; every other transition below is a continuous
 *    ease into the next phase's starting value.
 *  - `transform`: eases 0.85 -> 0.65 — the immediate aftermath of the
 *    release, still very much "in the moment".
 *  - `reveal`: eases 0.65 -> 0.32 — continues settling, still clearly
 *    elevated, long enough to actually register.
 *  - `aftermath`: an eased (smoothstep, not linear) fade from 0.32 -> 0 —
 *    breathes back to baseline rather than snapping. */
export function getMajorEventEnvelope(): number {
  const s = majorEventState;
  const i = s.intensity;
  switch (s.phase) {
    case 'buildup': {
      const t = THREE.MathUtils.clamp(s.phaseTime / PHASE_DURATIONS.buildup, 0, 1);
      return i * 0.35 * t;
    }
    case 'tension': {
      const t = THREE.MathUtils.clamp(s.phaseTime / PHASE_DURATIONS.tension, 0, 1);
      const pulse = 0.04 * Math.sin(s.phaseTime * 7 * Math.PI);
      return i * (0.4 + 0.1 * t + pulse);
    }
    case 'drop':
      return i;
    case 'transform': {
      const t = THREE.MathUtils.clamp(s.phaseTime / PHASE_DURATIONS.transform, 0, 1);
      return i * THREE.MathUtils.lerp(0.85, 0.65, t);
    }
    case 'reveal': {
      const t = THREE.MathUtils.clamp(s.phaseTime / PHASE_DURATIONS.reveal, 0, 1);
      return i * THREE.MathUtils.lerp(0.65, 0.32, t);
    }
    case 'aftermath': {
      const t = THREE.MathUtils.clamp(s.phaseTime / PHASE_DURATIONS.aftermath, 0, 1);
      const eased = 1 - t * t * (3 - 2 * t); // smoothstep-shaped decay, not linear
      return i * 0.32 * eased;
    }
    default:
      return 0;
  }
}
