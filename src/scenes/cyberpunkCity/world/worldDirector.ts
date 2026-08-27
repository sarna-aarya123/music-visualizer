import type * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { stepMusicEventDirector, resetMusicEventDirector } from './musicEventDirector';

/**
 * Phase 6 Stage 2 — the seam a future `WorldDirector` grows from.
 *
 * `PLAN.md` §3 describes a WorldDirector that owns *decisions* while
 * separate *executors* own rendering: "The director never draws
 * anything." Right now there is exactly one decision system in this
 * codebase — the major-event lifecycle in `musicEventDirector.ts` — so
 * this stage does nothing more than give that system's two control
 * entry points (advance one frame, reset on seek/new-track) a stable,
 * named home that a future stage can extend *without* every executor
 * needing to change again.
 *
 * What this deliberately does NOT do yet:
 *  - No new decision producers (event archetypes, sequences, world
 *    events). `step`/`reset` below delegate to the exact same function
 *    they always called, in the same order, with the same arguments —
 *    zero behavioural change.
 *  - Cinematic shot selection (`cinematicDirector.ts`) and speed-section
 *    decisions (`musicController.ts`) are NOT wrapped here. Both are
 *    genuine "decisions" per PLAN.md §3's eventual scope, but folding
 *    them in now would mean threading their camera/character-specific
 *    inputs (position, tangent, district, landmarks) through this
 *    facade for no behavioural gain — pure churn. They stay exactly
 *    where they are, called directly by `CameraRig`, until a later
 *    stage actually needs to coordinate them alongside a new decision
 *    producer.
 *  - Executors (camera, character, world props, sky, post-processing —
 *    everything that reads `majorEventState/getMajorEventEnvelope`)
 *    keep importing directly from `musicEventDirector.ts`. Rerouting
 *    ~18 read-only consumers through this facade would be a large,
 *    purely mechanical diff with no behavioural upside; it's deferred
 *    until a future stage actually changes what they need to read.
 *
 * When a future stage adds a second decision producer, `step`/`reset`
 * below grow a second delegated call each — the shape callers already
 * use (`WorldDirector.step(dt, frame, cameraPosition, elapsed)`) does
 * not need to change.
 */
export const WorldDirector = {
  /** Advances every decision system for this frame. Currently delegates
   *  to the major-event lifecycle only. */
  step(dt: number, frame: AudioFeatureFrame, cameraPosition: THREE.Vector3, elapsed: number): void {
    stepMusicEventDirector(dt, frame, cameraPosition, elapsed);
  },

  /** Clears every decision system's state — called on new track load or
   *  a seek. Currently delegates to the major-event lifecycle only; see
   *  `FeatureUpdater.tsx` for the sibling `resetCinematicDirector`/
   *  `resetRhythmState` calls this intentionally does not fold in. */
  reset(): void {
    resetMusicEventDirector();
  },
};
