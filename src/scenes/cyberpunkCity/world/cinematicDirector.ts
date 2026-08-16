import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import type { District } from './routeGenerator';
import type { WorldLayout } from './worldGenerator';
import { consumeDrop, consumeEvent, createBeatConsumerState } from '../../../audio/beatConsumer';
import { majorEventState } from './musicEventDirector';

/**
 * Directs occasional cinematic camera cuts on top of the stable third-
 * person gameplay camera — a music-video editor, not a second source of
 * constant camera motion. The gameplay camera (CameraRig.tsx) stays the
 * default; this only ever decides WHEN and WHICH short cut happens, gated
 * by real events (never a random timer) and a minimum gap between cuts so
 * shot changes stay special rather than constant.
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

/** District entries that most naturally suggest a specific establishing
 *  shot — everything else falls back to a generic wide shot. */
const DISTRICT_SHOT: Partial<Record<District, ShotType>> = {
  bridge: 'sideTracking',
  tunnel: 'lowAngle',
  canyon: 'overhead',
};

let lastShotEndTime = -999;
let lastDistrict: District | null = null;
let lastLandmarkKey: string | null = null;

const dropConsumer = createBeatConsumerState();
const majorConsumer = createBeatConsumerState();

function startShot(shot: ShotType, duration: number, target?: THREE.Vector3): void {
  cinematicState.shot = shot;
  cinematicState.shotTime = 0;
  cinematicState.shotDuration = duration;
  if (target) cinematicState.targetPosition.copy(target);
}

/** Landmark counts are tiny (a handful per lap), so a per-frame linear
 *  scan with small allocations is negligible — not worth the complexity
 *  of a spatial index or reused temp vectors here. */
function findNearestLandmark(pos: THREE.Vector3, world: WorldLayout, maxDist: number): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestDist = maxDist;
  for (const r of world.reactorRings) {
    const dist = Math.hypot(pos.x - r.x, pos.y - r.y, pos.z - r.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = new THREE.Vector3(r.x, r.y, r.z);
    }
  }
  for (const s of world.giantSpires) {
    const dist = Math.hypot(pos.x - s.x, pos.y - s.y, pos.z - s.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = new THREE.Vector3(s.x, s.y, s.z);
    }
  }
  return best;
}

export function stepCinematicDirector(
  dt: number,
  frame: AudioFeatureFrame,
  elapsed: number,
  characterPos: THREE.Vector3,
  district: District,
  world: WorldLayout
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

  // Priority: major event > drop > landmark proximity > district transition.
  const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorConsumer);
  if (majorHit > 0) {
    const nearest = findNearestLandmark(characterPos, world, LANDMARK_TRIGGER_DIST * 1.5);
    if (nearest) startShot('landmark', 3.2, nearest);
    else startShot('dramaticClose', 3.0);
    lastDistrict = district;
    return;
  }

  const dropHit = consumeDrop(frame, dropConsumer);
  if (dropHit > 0) {
    const nearest = findNearestLandmark(characterPos, world, LANDMARK_TRIGGER_DIST * 1.5);
    startShot(nearest ? 'landmark' : 'wideEstablishing', nearest ? 3.0 : 2.8, nearest ?? undefined);
    lastDistrict = district;
    return;
  }

  const nearestLandmark = findNearestLandmark(characterPos, world, LANDMARK_TRIGGER_DIST);
  if (nearestLandmark) {
    const key = `${nearestLandmark.x.toFixed(0)},${nearestLandmark.z.toFixed(0)}`;
    if (key !== lastLandmarkKey) {
      startShot('landmark', 2.6, nearestLandmark);
      lastLandmarkKey = key;
      lastDistrict = district;
      return;
    }
  } else {
    lastLandmarkKey = null;
  }

  if (lastDistrict !== null && district !== lastDistrict) {
    startShot(DISTRICT_SHOT[district] ?? 'wideEstablishing', 2.2);
  }
  lastDistrict = district;
}

/** A short ease-in/ease-out envelope for how "in" the current cinematic
 *  shot we are — 0 outside a shot, ramping to 1 during it, back to 0 as it
 *  ends. CameraRig blends toward the shot's framing by this amount. */
export function getCinematicBlend(): number {
  const s = cinematicState;
  if (s.shot === 'gameplay') return 0;
  const fadeTime = 0.4;
  if (s.shotTime < fadeTime) return s.shotTime / fadeTime;
  if (s.shotTime > s.shotDuration - fadeTime) return Math.max(0, (s.shotDuration - s.shotTime) / fadeTime);
  return 1;
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
      return {
        position: characterPos.clone().addScaledVector(tangent, -2.4).addScaledVector(up, 1.7),
        look: characterPos.clone().addScaledVector(up, 1.3),
      };
    case 'sideTracking':
      return {
        position: characterPos.clone().addScaledVector(right, 9).addScaledVector(up, 2.2),
        look: characterPos.clone().addScaledVector(up, 1.2),
      };
    case 'lowAngle':
      return {
        position: characterPos.clone().addScaledVector(tangent, -3.5).addScaledVector(up, 0.35),
        look: characterPos.clone().addScaledVector(up, 2.2).addScaledVector(tangent, 2),
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
