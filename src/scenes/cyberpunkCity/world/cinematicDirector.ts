import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeEvent, createBeatConsumerState } from '../../../audio/beatConsumer';
import { majorEventState } from './musicEventDirector';

/**
 * Directs occasional cinematic camera cuts on top of the stable third-
 * person gameplay camera — a music-video editor, not a second source of
 * constant camera motion. The gameplay camera (CameraRig.tsx) stays the
 * default; this only ever decides WHEN and WHICH short cut happens.
 *
 * Phase 6 Stage 8 (fifth camera pass) — this file's cut is now OFF
 * (`CINEMATIC_CUTS_ENABLED = false`). The project's one cinematic is the
 * major-event *sequence* camera in `cameraShots.ts`: a composed "hero
 * shot" of a signature landmark, fired only when there's genuinely one to
 * frame, otherwise the plain chase cam holds. This file's quick
 * character-only cut added camera motion that framed nothing new — the
 * exact complaint across four prior passes — so it's disabled. Everything
 * below still compiles and runs (the event id is still consumed every
 * frame); `startShot` is just never reached.
 *
 * History: cuts used to fire on landmark-proximity / district-transition /
 * every drop — a cut every few seconds. That narrowed to major-events-only
 * + character framings, then to this: off, with the hero-or-nothing
 * sequence camera as the single source of a deliberate camera move.
 */

export type ShotType =
  | 'gameplay'
  | 'wideEstablishing'
  | 'landmark'
  | 'dramaticClose'
  | 'sideTracking'
  | 'lowAngle'
  | 'overhead'
  | 'frontFacing';

export interface CinematicState {
  shot: ShotType;
  shotTime: number;
  shotDuration: number;
  /** Only meaningful for the 'landmark' shot — the structure being framed. */
  targetPosition: THREE.Vector3;
}

export const cinematicState: CinematicState = {
  shot: 'gameplay',
  shotTime: 0,
  shotDuration: 0,
  targetPosition: new THREE.Vector3(),
};

/** Master switch. `false` = no cinematic cuts from THIS file at all.
 *
 *  Stage 8 "hero shot or nothing": this is now `false`. The single
 *  cinematic in the project is the major-event *sequence* camera in
 *  `cameraShots.ts` — a composed hero shot of a signature landmark, fired
 *  only when there's actually one to frame. This file's quick
 *  character-only cut (`dramaticClose`/`frontFacing`/`lowAngle`) was the
 *  "camera moved but showed nothing" the user kept reporting, so it's
 *  disabled. `stepCinematicDirector` still runs and still consumes the
 *  major-event id every frame (so re-enabling never has to clear a
 *  backlog); it just never calls `startShot`, so `cinematicState.shot`
 *  stays `'gameplay'` and `getCinematicBlend()` is always 0. All the
 *  machinery below is intact and dormant. */
const CINEMATIC_CUTS_ENABLED = false;

/** Minimum seconds between cuts. Major events fire roughly every 13-20s+
 *  in an energetic track; this keeps a cut to at most ~once per 20s so
 *  the camera is behind the character the large majority of the time. */
const MIN_GAP = 20;
/** A landmark within this distance when a major event lands is close
 *  enough to sit as a backdrop behind a character shot — it only nudges
 *  WHICH character shot is picked, never triggers a landmark-only one. */
const LANDMARK_BACKDROP_DIST = 45;

let lastShotEndTime = -999;
/** Which shot type played last — purely for variety (never gates WHETHER
 *  a cut happens, only WHICH shot is picked once one is already
 *  warranted), so consecutive cuts don't repeat the same framing. */
let lastShotType: ShotType | null = null;

const majorConsumer = createBeatConsumerState();

function startShot(shot: ShotType, duration: number, target?: THREE.Vector3): void {
  cinematicState.shot = shot;
  cinematicState.shotTime = 0;
  cinematicState.shotDuration = duration;
  if (target) cinematicState.targetPosition.copy(target);
  lastShotType = shot;
}

/** Returns `preferred` unless it's the same shot type that just played, in
 *  which case it falls through `alternates` (in order) for the first one
 *  that also isn't a repeat. Purely a variety tie-breaker — every
 *  candidate passed in must already be an appropriate choice for the
 *  calling trigger; this never invents a new trigger condition or shot. */
function pickVaried(preferred: ShotType, alternates: ShotType[]): ShotType {
  if (preferred !== lastShotType) return preferred;
  for (const alt of alternates) {
    if (alt !== lastShotType) return alt;
  }
  return preferred;
}

/** Landmark counts are tiny (a handful per lap), so a per-frame linear
 *  scan with small allocations is negligible — not worth the complexity
 *  of a spatial index or reused temp vectors here. Takes a flat list of
 *  landmark positions (any environment's `WorldBase.landmarkPositions`)
 *  rather than a cyberpunk-specific world shape. */
function findNearestLandmark(pos: THREE.Vector3, landmarks: THREE.Vector3[], maxDist: number): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestDist = maxDist;
  for (const p of landmarks) {
    const dist = pos.distanceTo(p);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

export function stepCinematicDirector(
  dt: number,
  frame: AudioFeatureFrame,
  elapsed: number,
  characterPos: THREE.Vector3,
  district: string,
  landmarks: THREE.Vector3[]
): void {
  // `frame`/`district` are unused — kept so CameraRig's call site doesn't
  // change.
  void frame;
  void district;

  cinematicState.shotTime += dt;

  if (cinematicState.shot !== 'gameplay' && cinematicState.shotTime > cinematicState.shotDuration) {
    cinematicState.shot = 'gameplay';
    lastShotEndTime = elapsed;
  }

  // Consume the major-event id every frame regardless — keeps `majorHit`
  // correct and prevents a backlog if the flag below is ever re-enabled.
  const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorConsumer);

  if (!CINEMATIC_CUTS_ENABLED) return; // cinematic cuts are OFF — see the file header

  const cooldownOk = elapsed - lastShotEndTime > MIN_GAP;
  if (cinematicState.shot !== 'gameplay' || !cooldownOk) return;

  // On a major event: one tight, character-guaranteed cut (~3s), varied
  // so consecutive cuts aren't the same angle. No landmark/sideTracking —
  // see the file header.
  if (majorHit > 0) {
    void characterPos;
    void landmarks;
    startShot(pickVaried('dramaticClose', ['frontFacing', 'lowAngle']), 3.2);
  }
}

/** Clears any in-flight cinematic shot back to gameplay and forgets the
 *  previous track's cut-cooldown memory — called on a new track load or a
 *  seek, so the camera doesn't stay locked into a cut aimed at wherever
 *  the previous playback position was. */
export function resetCinematicDirector(): void {
  cinematicState.shot = 'gameplay';
  cinematicState.shotTime = 0;
  cinematicState.shotDuration = 0;
  cinematicState.targetPosition.set(0, 0, 0);
  lastShotEndTime = -999;
  lastShotType = null;
  majorConsumer.lastId = -1;
}

/** A short ease-in/ease-out envelope for how "in" the current cinematic
 *  shot we are — 0 outside a shot, ramping to 1 during it, back to 0 as it
 *  ends. CameraRig blends both position AND look-at target toward the
 *  shot's framing by this amount, so this curve's SHAPE is what determines
 *  whether a cut feels like a camera operator smoothly repositioning vs a
 *  snap. A plain linear ramp has a velocity discontinuity at the exact
 *  moment a shot starts/ends (an instant "kick"); smoothstep's derivative
 *  is zero at both ends, so the blend genuinely eases in and out. */
function smoothstep01(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function getCinematicBlend(): number {
  const s = cinematicState;
  if (s.shot === 'gameplay') return 0;
  // Phase 4.1: was 0.4s — the cut/return itself, while smoothstep-shaped,
  // completed quickly enough to still read as a snap rather than a
  // deliberate camera-operator move. Slower fade in/out, same shot
  // durations/trigger conditions/priority (all untouched) — the choreography
  // is unchanged, only how gently each cut is entered and released.
  const fadeTime = 0.85;
  let raw: number;
  if (s.shotTime < fadeTime) raw = s.shotTime / fadeTime;
  else if (s.shotTime > s.shotDuration - fadeTime) raw = Math.max(0, (s.shotDuration - s.shotTime) / fadeTime);
  else raw = 1;
  return smoothstep01(raw);
}

export interface ShotTransform {
  position: THREE.Vector3;
  look: THREE.Vector3;
}

/** Where each shot type points the camera, relative to the character's
 *  current ground frame (and, for 'landmark', the structure it's framing). */
export function computeShotTransform(
  shot: ShotType,
  characterPos: THREE.Vector3,
  tangent: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  target: THREE.Vector3
): ShotTransform {
  switch (shot) {
    case 'wideEstablishing':
      return {
        position: characterPos.clone().addScaledVector(tangent, -32).addScaledVector(up, 20).addScaledVector(right, 6),
        look: characterPos.clone().addScaledVector(up, 2),
      };
    case 'landmark':
      return {
        position: characterPos.clone().addScaledVector(tangent, -18).addScaledVector(right, 14).addScaledVector(up, 9),
        look: target.clone(),
      };
    case 'dramaticClose':
      // A three-quarter angle, not a close shot directly behind the
      // character's back — offset to the side as well as behind/above,
      // so it reads as a deliberate dramatic angle rather than the camera
      // crowding right up against them.
      return {
        position: characterPos
          .clone()
          .addScaledVector(tangent, -3.4)
          .addScaledVector(right, 2.8)
          .addScaledVector(up, 2.1),
        look: characterPos.clone().addScaledVector(up, 1.3),
      };
    case 'sideTracking':
      return {
        position: characterPos.clone().addScaledVector(right, 9).addScaledVector(up, 2.2),
        look: characterPos.clone().addScaledVector(up, 1.2),
      };
    case 'lowAngle':
      // Ground-level, dramatic — but must still look AT the character, not
      // past them into open sky/buildings above. The look target used to
      // aim well above and ahead of the character's own position, which
      // could frame empty space instead of a recognizable subject.
      return {
        position: characterPos.clone().addScaledVector(tangent, -3.5).addScaledVector(up, 0.35),
        look: characterPos.clone().addScaledVector(up, 1.4),
      };
    case 'overhead':
      return {
        position: characterPos.clone().addScaledVector(up, 26).addScaledVector(tangent, -4),
        look: characterPos.clone(),
      };
    case 'frontFacing':
      return {
        position: characterPos.clone().addScaledVector(tangent, 9).addScaledVector(up, 2.4),
        look: characterPos.clone().addScaledVector(up, 1.3),
      };
    default:
      return { position: characterPos.clone(), look: characterPos.clone() };
  }
}
