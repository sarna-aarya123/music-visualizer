import type * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import {
  stepMusicEventDirector,
  resetMusicEventDirector,
  majorEventState,
  PHASE_DURATIONS,
  type MajorEventState,
} from './musicEventDirector';

/**
 * Phase 6 Stage 2 established this seam; Stage 3 is the first thing that
 * actually grows it.
 *
 * `PLAN.md` §3 describes a WorldDirector that owns *decisions* while
 * separate *executors* own rendering: "The director never draws
 * anything." Right now there is exactly one decision system in this
 * codebase — the major-event sequence in `musicEventDirector.ts` (Stage 3
 * turned its old ~2.57s flash into a real 10-15s multi-phase sequence —
 * see that file's doc comment) — so `step`/`reset` still just delegate to
 * it, unchanged in shape since Stage 2.
 *
 * **What's new in Stage 3:** `sequence`/`phaseDurations` below. The
 * sequence's raw phase/timing (as opposed to the smoothed
 * `getMajorEventEnvelope()` scalar every other consumer reads) is
 * genuinely sequence-internal state — WorldDirector is where that lives
 * now. The two consumers that need it (`CameraRig`'s pre-drop hold,
 * `musicController`'s pacing dip) read it through here instead of
 * importing `musicEventDirector.ts` directly; both were touched anyway
 * this stage since the phase names themselves changed, so routing them
 * through the facade at the same time costs nothing extra.
 *
 * What this deliberately still does NOT do:
 *  - No new decision producers beyond the one sequence (no event
 *    archetypes, no world-event selection, no character-ability
 *    triggering pulled in here yet).
 *  - Cinematic shot *selection* (`cinematicDirector.ts`) and speed-section
 *    decisions (`musicController.ts`'s drop/breakdown hold-and-relax) are
 *    still not wrapped here — only the one narrow read (`sequence.phase`)
 *    that Stage 3 actually needed. Folding the rest in would be premature;
 *    see PLAN.md §3's eventual scope for what that would look like.
 *  - The ~18 files that only need the smoothed envelope (world props, sky,
 *    post-processing) still import `getMajorEventEnvelope()` directly from
 *    `musicEventDirector.ts`, unchanged from Stage 2 — they never needed
 *    raw phase/timing, so there's nothing to reroute for them.
 *
 * When a future stage adds a second decision producer, `step`/`reset`
 * below grow a second delegated call each — the shape callers already
 * use (`WorldDirector.step(dt, frame, cameraPosition, elapsed)`) does
 * not need to change.
 */
export const WorldDirector = {
  /** Advances every decision system for this frame. Currently delegates
   *  to the major-event sequence only. */
  step(dt: number, frame: AudioFeatureFrame, cameraPosition: THREE.Vector3, elapsed: number): void {
    stepMusicEventDirector(dt, frame, cameraPosition, elapsed);
  },

  /** Clears every decision system's state — called on new track load or
   *  a seek. Currently delegates to the major-event sequence only; see
   *  `FeatureUpdater.tsx` for the sibling `resetCinematicDirector`/
   *  `resetRhythmState` calls this intentionally does not fold in. */
  reset(): void {
    resetMusicEventDirector();
  },

  /** Read-only view of the current major-event sequence's raw
   *  phase/timing/intensity/origin — data, never to be mutated by a
   *  reader. Everything that only needs the smoothed envelope should keep
   *  using `getMajorEventEnvelope()` instead. */
  get sequence(): Readonly<MajorEventState> {
    return majorEventState;
  },

  /** Per-phase durations for the sequence above — same object
   *  `musicEventDirector.ts` exports, re-surfaced here for the two
   *  readers that need it alongside `sequence`. */
  get phaseDurations() {
    return PHASE_DURATIONS;
  },
};
