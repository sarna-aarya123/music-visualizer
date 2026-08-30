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
 * Phase 6 Stage 8 — "follow the protagonist, reveal the world only when
 * the music truly earns it." Cuts now fire on ONE thing: a major event
 * (`majorEventState.impactEventId` — the rare, ~13s coordinated
 * drop/transform sequence). The old landmark-proximity and district-
 * transition tiers were removed: they triggered on POSITION alone (every
 * time the character ran past a landmark or crossed a district), with a
 * 4.5s floor, so a cut was firing roughly every few seconds and — because
 * they preferred the `'landmark'` shot — the camera was pointed at the
 * environment instead of the character most of the time. A plain `dropId`
 * that never escalates to a major event no longer cuts either: it still
 * drives every gameplay-camera impulse (FOV punch, forward burst, speed),
 * which is plenty for a beat that isn't a genuine "moment". When a cut
 * does fire it is always a CHARACTER-focused framing; a nearby landmark
 * only nudges which character shot is chosen so it sits as a backdrop,
 * never a landmark-only shot.
 *
 * Multi-environment architecture: still environment-agnostic — landmark
 * positions are a plain `THREE.Vector3[]`, the district is a plain string.
 * The `district`/`frame` params are kept on `stepCinematicDirector` so
 * `CameraRig`'s call site is unchanged, even though only `landmarks` is
 * read now.
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

/** Minimum seconds between cuts. Major events can fire every ~13s in an
 *  energetic track — this holds the cinematic cut to roughly once every
 *  30s so the camera stays behind the character the vast majority of the
 *  time. Matches `cameraShots.ts`'s `CINEMATIC_COOLDOWN` so the cut and
 *  the (brief) sequence camera move engage together on the same major
 *  event and then both go quiet. */
const MIN_GAP = 30;
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
  // `frame`/`district` are unused now (see the file header) — kept so
  // CameraRig's call site doesn't change.
  void frame;
  void district;

  cinematicState.shotTime += dt;

  if (cinematicState.shot !== 'gameplay' && cinematicState.shotTime > cinematicState.shotDuration) {
    cinematicState.shot = 'gameplay';
    lastShotEndTime = elapsed;
  }

  const cooldownOk = elapsed - lastShotEndTime > MIN_GAP;
  if (cinematicState.shot !== 'gameplay' || !cooldownOk) return;

  // The ONLY trigger: a major event. This is the rare, coordinated
  // drop/transform moment — the one time it "really makes sense" to leave
  // the chase camera. The cut is always CHARACTER-focused; a landmark
  // that happens to be right here only picks which character shot so it
  // reads as a backdrop, never a landmark-only shot (that framing, when
  // there's genuinely something to reveal, is the sequence camera's
  // `reveal` phase — see cameraShots.ts).
  const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorConsumer);
  if (majorHit > 0) {
    const backdrop = findNearestLandmark(characterPos, landmarks, LANDMARK_BACKDROP_DIST) !== null;
    const shot = backdrop
      ? pickVaried('sideTracking', ['dramaticClose', 'frontFacing'])
      : pickVaried('dramaticClose', ['frontFacing', 'lowAngle']);
    startShot(shot, 3.0);
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
