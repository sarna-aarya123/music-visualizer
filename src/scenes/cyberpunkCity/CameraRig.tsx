import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, consumeDrop, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import {
  applyBeatBurst,
  applyMajorLaunch,
  createSpeedState,
  MAX_SPEED_CAP,
  stepSpeed,
} from './world/musicController';
import { cameraMotionState } from './world/cameraMotionState';
import { characterMotionState } from './world/characterMotionState';
import { getMajorEventEnvelope, majorEventState } from './world/musicEventDirector';
import { cinematicState, computeShotTransform, getCinematicBlend, stepCinematicDirector } from './world/cinematicDirector';
import { useViewModeStore } from '../../state/viewModeStore';

const HEAD_HEIGHT = 1.75; // first-person: the character's own eye height
const FOLLOW_DIST = 5.5; // third-person: how far behind the character
const FOLLOW_HEIGHT = 2.4; // third-person: how far above the character
const BASE_FOV = 52;
const LOOK_AHEAD = 16;
const MODE_BLEND_RATE = 1.6; // per second — the third/first-person transition

/** Below this, a beat produces no camera reaction at all — "almost no
 *  camera movement" for normal bass. Above it, a beat qualifies as a real
 *  808/kick. Above the higher bar, it's a "very strong" hit. */
const REACT_BAR = 0.55;
const STRONG_BEAT_BAR = 0.72;
const VERY_STRONG_BAR = 0.88;

type ImpulseKind = 'forward' | 'vertical' | 'rotational' | 'fov' | 'lateral';

/** Weighted so lateral/banking — the one kind of response that reads as
 *  "side to side" — is deliberately rare. Forward/vertical/rotational/FOV
 *  share the rest, so a strong beat still visibly does *something*, just
 *  not the same angled sideways move every time. */
function pickImpulseKind(): ImpulseKind {
  const r = Math.random();
  if (r < 0.3) return 'forward';
  if (r < 0.56) return 'vertical';
  if (r < 0.8) return 'rotational';
  if (r < 0.92) return 'fov';
  return 'lateral';
}

/**
 * Owns the character's progress along the route (`t`) and the
 * music-driven speed model, publishes the resulting ground frame to
 * characterMotionState (read by Character.tsx), and frames the camera
 * either as a third-person chase shot or a first-person head position —
 * blended smoothly on toggle, never snapping.
 *
 * STRICT RULE unchanged from prior iterations: only the bass/808 detector
 * and the events built on it (`dropId`, a major event) may physically
 * move the camera. Hi-hats, snares, mid-frequency content, and spectral
 * changes are never consumed here — they drive world reactions instead.
 *
 * Every camera movement still has to come from one of three sources:
 *   A. Route choreography — curvature-driven banking, always present but
 *      kept subtle.
 *   B. Music — low-frequency events only, tiered, varied in kind.
 *   C. Cinematic transitions — the altitude dive during a major event, and
 *      the third/first-person blend itself.
 */
export function CameraRig({ featureFrame, route, world }: SceneProps) {
  const { camera } = useThree();
  const mode = useViewModeStore((s) => s.mode);

  const t = useRef(Math.random());
  const speed = useRef(createSpeedState()).current;
  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const smoothedUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevTangent = useRef<THREE.Vector3 | null>(null);
  const modeBlend = useRef(mode === 'first' ? 1 : 0);
  const chaseLag = useRef<THREE.Vector3 | null>(null);

  // Decaying impulses — each a distinct kind of movement, so a reaction
  // doesn't always look like "tilt sideways".
  const impulseForward = useRef(0);
  const impulseVertical = useRef(0);
  const impulseLateral = useRef(0);
  const impulseLookX = useRef(0);
  const impulseLookY = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;

    const applyImpulse = (kind: ImpulseKind, magnitude: number) => {
      switch (kind) {
        case 'forward':
          impulseForward.current = Math.max(impulseForward.current, magnitude * 0.9);
          break;
        case 'vertical':
          impulseVertical.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.7;
          break;
        case 'rotational':
          impulseLookX.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 1.4;
          impulseLookY.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.7;
          break;
        case 'fov':
          impactFov.current = Math.max(impactFov.current, magnitude * 9);
          break;
        case 'lateral':
          impulseLateral.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 1.1;
          beatBank.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.1;
          break;
      }
    };

    // --- Only bass/808 may physically move the camera, and only above
    // REACT_BAR — most beats are felt nowhere near the camera at all.
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > REACT_BAR) {
      if (beatHit > STRONG_BEAT_BAR) applyBeatBurst(speed, beatHit);

      if (beatHit > VERY_STRONG_BAR) {
        const kindA = pickImpulseKind();
        let kindB = pickImpulseKind();
        if (kindB === kindA) kindB = pickImpulseKind();
        applyImpulse(kindA, 1.3);
        applyImpulse(kindB, 0.8);
      } else if (beatHit > STRONG_BEAT_BAR) {
        applyImpulse(pickImpulseKind(), 0.85);
      } else {
        applyImpulse(pickImpulseKind(), 0.22);
      }
    }

    // Hi-hats, snares/claps, mid content, and spectral changes are
    // deliberately NOT consumed here at all — see the file-level comment.

    const dropHit = consumeDrop(f, dropState);
    if (dropHit > 0) {
      impulseForward.current = Math.max(impulseForward.current, 1.4);
      impulseVertical.current += (Math.random() < 0.5 ? -1 : 1) * 0.6;
      impactFov.current = Math.max(impactFov.current, 15);
    }

    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impulseForward.current = Math.max(impulseForward.current, majorHit * 2.2);
      impulseLookX.current += (Math.random() < 0.5 ? -1 : 1) * majorHit * 1.6;
      impactFov.current = Math.max(impactFov.current, majorHit * 16);
    }
    const majorEnvelope = getMajorEventEnvelope();
    const altitudeDive = -majorEnvelope * 2.4;

    stepSpeed(speed, dt, f);
    cameraMotionState.speed = speed.current;

    t.current = ((t.current + (speed.current * dt) / route.length) % 1 + 1) % 1;
    const frame = route.getFrameAt(t.current);

    // Publish the character's ground frame for Character.tsx to read.
    characterMotionState.t = t.current;
    characterMotionState.position.copy(frame.position);
    characterMotionState.tangent.copy(frame.tangent);
    characterMotionState.right.copy(frame.right);
    characterMotionState.up.copy(frame.up);
    characterMotionState.speed = speed.current;

    // The cinematic director decides WHEN a shot change is warranted
    // (drop / major event / landmark proximity / district transition,
    // never a timer) — the gameplay chase camera below stays the default
    // and this only ever blends briefly toward an alternate framing.
    const district = route.getDistrictInfoAt(t.current).district;
    stepCinematicDirector(dt, f, state.clock.elapsedTime, frame.position, district, world);

    const decay = Math.exp(-dt * 7);
    impulseForward.current *= decay;
    impulseVertical.current *= decay;
    impulseLateral.current *= decay;
    impulseLookX.current *= decay;
    impulseLookY.current *= decay;
    impactFov.current *= Math.exp(-dt * 8);
    beatBank.current *= Math.exp(-dt * 3.5);

    // --- Third-person chase position: behind and above the character,
    // smoothed so it lags slightly rather than rigidly tracking — a chase
    // camera, not a rigidly-attached one.
    const thirdPersonTarget = frame.position
      .clone()
      .addScaledVector(frame.tangent, -FOLLOW_DIST)
      .addScaledVector(frame.right, impulseLateral.current * 0.5)
      .addScaledVector(frame.up, FOLLOW_HEIGHT + altitudeDive * 0.5 + impulseVertical.current * 0.5);
    if (!chaseLag.current) chaseLag.current = thirdPersonTarget.clone();
    chaseLag.current.lerp(thirdPersonTarget, 1 - Math.exp(-dt * 5));
    const thirdPersonPos = chaseLag.current
      .clone()
      .addScaledVector(frame.tangent, impulseForward.current * 0.6);

    // --- First-person head position: exactly at the character's eyes.
    const firstPersonPos = frame.position
      .clone()
      .addScaledVector(frame.tangent, impulseForward.current)
      .addScaledVector(frame.right, impulseLateral.current)
      .addScaledVector(frame.up, HEAD_HEIGHT + altitudeDive + impulseVertical.current);

    const modeTarget = mode === 'first' ? 1 : 0;
    modeBlend.current += (modeTarget - modeBlend.current) * (1 - Math.exp(-MODE_BLEND_RATE * dt));

    let position = thirdPersonPos.clone().lerp(firstPersonPos, modeBlend.current);

    // Cinematic shots only ever apply on top of third-person — first-person
    // stays exactly as stable as before (this iteration deliberately
    // doesn't touch it).
    const cineBlend = getCinematicBlend() * (1 - modeBlend.current);
    let cinematicLook: THREE.Vector3 | null = null;
    if (cineBlend > 0) {
      const shot = computeShotTransform(
        cinematicState.shot,
        frame.position,
        frame.tangent,
        frame.right,
        frame.up,
        cinematicState.targetPosition
      );
      position = position.clone().lerp(shot.position, cineBlend);
      cinematicLook = shot.look;
    }
    camera.position.copy(position);

    // --- Orientation: stable, world-up-referenced, never a Frenet frame.
    smoothedUp.current.lerp(frame.up, 1 - Math.exp(-dt * 3)).normalize();

    let curvatureBank = 0;
    if (prevTangent.current) {
      const cross = new THREE.Vector3().crossVectors(prevTangent.current, frame.tangent);
      const turnRate = cross.y / Math.max(dt, 1e-4);
      const energyScale = 0.45 + 0.3 * f.energy;
      const majorScale = 1 + majorEnvelope * 1.6;
      const bankLimit = 0.18 * majorScale;
      curvatureBank = THREE.MathUtils.clamp(-turnRate * 0.07 * energyScale * majorScale, -bankLimit, bankLimit);
    }
    prevTangent.current = frame.tangent.clone();

    // Third-person stays level (a chase cam banking with the road reads as
    // nauseating); only first-person inherits the route's bank.
    const bank = THREE.MathUtils.clamp((curvatureBank + beatBank.current) * modeBlend.current, -0.5, 0.5);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);

    const lookXClamped = THREE.MathUtils.clamp(impulseLookX.current, -6, 6);
    const lookYClamped = THREE.MathUtils.clamp(impulseLookY.current, -4, 4);

    // Third-person looks toward the character (slightly ahead, roughly
    // torso height) so they stay framed; first-person looks straight
    // ahead down the route, nudged by the rotational "glance" impulse.
    const thirdPersonLook = frame.position
      .clone()
      .addScaledVector(frame.tangent, 5)
      .addScaledVector(frame.up, 1.5);
    const firstPersonLook = position
      .clone()
      .addScaledVector(frame.tangent, LOOK_AHEAD)
      .addScaledVector(frame.right, lookXClamped)
      .addScaledVector(frame.up, lookYClamped);
    let lookTarget = thirdPersonLook.clone().lerp(firstPersonLook, modeBlend.current);
    if (cinematicLook) lookTarget = lookTarget.clone().lerp(cinematicLook, cineBlend);
    camera.lookAt(lookTarget);

    // --- FOV: base + speed-driven widening (a classic speed cue, tied to
    // actual travel speed) + the FOV impulse on top.
    const speedFrac = THREE.MathUtils.clamp(speed.current / MAX_SPEED_CAP, 0, 1);
    const targetFov = BASE_FOV + speedFrac * 14 + impactFov.current;
    currentFov.current += (targetFov - currentFov.current) * (1 - Math.exp(-dt * 11));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = currentFov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
