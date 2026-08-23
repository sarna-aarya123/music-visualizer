import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeDrop, consumeEvent, createBeatConsumerState } from '../../../audio/beatConsumer';
import { majorEventState } from './musicEventDirector';

/**
 * Directs occasional cinematic camera cuts on top of the stable third-
 * person gameplay camera — a music-video editor, not a second source of
 * constant camera motion. The gameplay camera (CameraRig.tsx) stays the
 * default; this only ever decides WHEN and WHICH short cut happens, gated
 * by real events (never a random timer) and a minimum gap between cuts so
 * shot changes stay special rather than constant.
 *
 * Multi-environment architecture: this file is genuinely environment-
 * agnostic — it used to take a cyberpunk-specific `WorldLayout` just to dig
 * `reactorRings`/`giantSpires` out of it, and a cyberpunk-specific
 * `District` union for the district-transition shot. Both are now generic
 * (a plain `THREE.Vector3[]` of landmark positions, and a plain `string`
 * district/region name) so any environment's CameraRig call can drive the
 * exact same cinematic system — see scenes/shared/environment.ts's
 * `WorldBase`. Zero change to WHEN/WHICH shots fire, only to what type of
 * value those decisions are keyed off.
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

const MIN_GAP = 4.5;
const LANDMARK_TRIGGER_DIST = 55;

/** District/region name -> the establishing shot that most naturally suits
 *  it — everything else falls back to a generic wide shot. A plain string
 *  key so any environment's own district/region names can be added here
 *  (cyberpunk's below, Fantasy Forest's added alongside them once its
 *  region names exist) without this file needing to know which
 *  environment is currently active. */
const DISTRICT_SHOT: Partial<Record<string, ShotType>> = {
  bridge: 'sideTracking',
  tunnel: 'lowAngle',
  canyon: 'overhead',
};

let lastShotEndTime = -999;
let lastDistrict: string | null = null;
let lastLandmarkKey: string | null = null;
/** Which shot type played last — purely for variety (never gates WHETHER
 *  a cut happens, only WHICH shot is picked once one is already
 *  warranted), so consecutive cuts don't repeat the same framing. */
let lastShotType: ShotType | null = null;

const dropConsumer = createBeatConsumerState();
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
  cinematicState.shotTime += dt;

  if (cinematicState.shot !== 'gameplay' && cinematicState.shotTime > cinematicState.shotDuration) {
    cinematicState.shot = 'gameplay';
    lastShotEndTime = elapsed;
  }

  const cooldownOk = elapsed - lastShotEndTime > MIN_GAP;
  if (cinematicState.shot !== 'gameplay' || !cooldownOk) {
    lastDistrict = district;
    return;
  }

  // Priority: major event > drop > landmark proximity > district transition
  // — unchanged. Variety only decides WHICH shot within whatever tier
  // already fired, via pickVaried, never whether/how often a cut happens.
  const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorConsumer);
  if (majorHit > 0) {
    const nearest = findNearestLandmark(characterPos, landmarks, LANDMARK_TRIGGER_DIST * 1.5);
    const shot = nearest
      ? pickVaried('landmark', ['dramaticClose', 'frontFacing'])
      : pickVaried('dramaticClose', ['frontFacing', 'lowAngle']);
    startShot(shot, shot === 'landmark' ? 3.2 : 3.0, nearest ?? undefined);
    lastDistrict = district;
    return;
  }

  const dropHit = consumeDrop(frame, dropConsumer);
  if (dropHit > 0) {
    const nearest = findNearestLandmark(characterPos, landmarks, LANDMARK_TRIGGER_DIST * 1.5);
    const shot = nearest
      ? pickVaried('landmark', ['sideTracking', 'frontFacing'])
      : pickVaried('wideEstablishing', ['overhead', 'frontFacing']);
    startShot(shot, shot === 'landmark' ? 3.0 : 2.8, nearest ?? undefined);
    lastDistrict = district;
    return;
  }

  const nearestLandmark = findNearestLandmark(characterPos, landmarks, LANDMARK_TRIGGER_DIST);
  if (nearestLandmark) {
    const key = `${nearestLandmark.x.toFixed(0)},${nearestLandmark.z.toFixed(0)}`;
    if (key !== lastLandmarkKey) {
      const shot = pickVaried('landmark', ['frontFacing', 'sideTracking']);
      startShot(shot, 2.6, nearestLandmark);
      lastLandmarkKey = key;
      lastDistrict = district;
      return;
    }
  } else {
    lastLandmarkKey = null;
  }

  if (lastDistrict !== null && district !== lastDistrict) {
    const preferred = DISTRICT_SHOT[district] ?? 'wideEstablishing';
    const shot = pickVaried(preferred, ['frontFacing', 'wideEstablishing']);
    startShot(shot, 2.2);
  }
  lastDistrict = district;
}

/** Clears any in-flight cinematic shot back to gameplay and forgets the
 *  previous track's cut-cooldown/district/landmark memory — called on a
 *  new track load or a seek, so the camera doesn't stay locked into a cut
 *  aimed at wherever the previous playback position was. */
export function resetCinematicDirector(): void {
  cinematicState.shot = 'gameplay';
  cinematicState.shotTime = 0;
  cinematicState.shotDuration = 0;
  cinematicState.targetPosition.set(0, 0, 0);
  lastShotEndTime = -999;
  lastDistrict = null;
  lastLandmarkKey = null;
  lastShotType = null;
  dropConsumer.lastId = -1;
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
