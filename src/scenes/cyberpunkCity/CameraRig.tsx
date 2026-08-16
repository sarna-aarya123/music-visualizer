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
import { getMajorEventEnvelope, majorEventState } from './world/musicEventDirector';

const EYE_HEIGHT = 3.2;
const BASE_FOV = 52;
const LOOK_AHEAD = 16;

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
 * The camera is a rider on the route, not a free body. Its only degrees of
 * freedom are: `t` (progress along the closed loop) and a handful of
 * small, decaying impulses. Position and base orientation come directly
 * from RouteGenerator.getFrameAt(t) — this is what makes flying through
 * geometry and orientation flips structurally impossible rather than just
 * unlikely.
 *
 * STRICT RULE: only the bass/808 detector (`beatId`/`beatIntensity`) and
 * the events built on top of it (`dropId`, a major event) may physically
 * move the camera. Hi-hats, snares, mid-frequency content, and spectral
 * changes are never consumed here at all — they drive world reactions
 * instead (Buildings/Particles/Ground/CityAtmosphere). The major-event
 * trigger itself is separately guarded in musicEventDirector.ts against
 * being set off by high-frequency content alone.
 *
 * Every camera movement has to come from one of three sources — there is
 * deliberately no ambient/idle motion for its own sake:
 *   A. Route choreography — curvature-driven banking, always present but
 *      kept subtle, because the route actually turns.
 *   B. Music — but ONLY low-frequency events, and even then most beats
 *      (below REACT_BAR) produce nothing. When a beat does react, it picks
 *      ONE of several distinct movement types (forward/vertical/
 *      rotational/FOV, rarely lateral) rather than always banking
 *      sideways — see pickImpulseKind.
 *   C. Cinematic transitions — the altitude dive during a major event.
 */
export function CameraRig({ featureFrame, route }: SceneProps) {
  const { camera } = useThree();

  const t = useRef(Math.random());
  const speed = useRef(createSpeedState()).current;
  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const smoothedUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevTangent = useRef<THREE.Vector3 | null>(null);

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
        // A very strong hit combines two distinct movement types rather
        // than just scaling one up.
        const kindA = pickImpulseKind();
        let kindB = pickImpulseKind();
        if (kindB === kindA) kindB = pickImpulseKind();
        applyImpulse(kindA, 1.3);
        applyImpulse(kindB, 0.8);
      } else if (beatHit > STRONG_BEAT_BAR) {
        applyImpulse(pickImpulseKind(), 0.85);
      } else {
        // Between REACT_BAR and STRONG_BEAT_BAR: "almost nothing obvious".
        applyImpulse(pickImpulseKind(), 0.22);
      }
    }

    // Hi-hats, snares/claps, mid content, and spectral changes are
    // deliberately NOT consumed here at all — see the file-level comment.

    // --- Drop: a bigger, combined reaction — still controlled, not
    // sustained shaking.
    const dropHit = consumeDrop(f, dropState);
    if (dropHit > 0) {
      impulseForward.current = Math.max(impulseForward.current, 1.4);
      impulseVertical.current += (Math.random() < 0.5 ? -1 : 1) * 0.6;
      impactFov.current = Math.max(impactFov.current, 15);
    }

    // --- Major event: the one place a truly large, multi-part launch
    // happens, plus a deliberate cinematic dive (a chosen transition, not
    // random altitude wander).
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impulseForward.current = Math.max(impulseForward.current, majorHit * 2.2);
      impulseLookX.current += (Math.random() < 0.5 ? -1 : 1) * majorHit * 1.6;
      impactFov.current = Math.max(impactFov.current, majorHit * 16);
    }
    const majorEnvelope = getMajorEventEnvelope();
    const altitudeDive = -majorEnvelope * 2.4;

    // Structural drop/breakdown events (consumed inside stepSpeed) are
    // what actually drive the big cruise -> fast-section -> settle curve.
    stepSpeed(speed, dt, f);
    cameraMotionState.speed = speed.current;

    // --- Advance along the route (arc-length based: speed is in real
    // world units/sec regardless of route length or curvature). ----------
    t.current = ((t.current + (speed.current * dt) / route.length) % 1 + 1) % 1;

    const frame = route.getFrameAt(t.current);

    const decay = Math.exp(-dt * 7);
    impulseForward.current *= decay;
    impulseVertical.current *= decay;
    impulseLateral.current *= decay;
    impulseLookX.current *= decay;
    impulseLookY.current *= decay;
    impactFov.current *= Math.exp(-dt * 8);
    beatBank.current *= Math.exp(-dt * 3.5);

    const position = frame.position
      .clone()
      .addScaledVector(frame.tangent, impulseForward.current)
      .addScaledVector(frame.right, impulseLateral.current)
      .addScaledVector(frame.up, EYE_HEIGHT + altitudeDive + impulseVertical.current);
    camera.position.copy(position);

    // --- Orientation: stable, world-up-referenced, never a Frenet frame.
    smoothedUp.current.lerp(frame.up, 1 - Math.exp(-dt * 3)).normalize();

    // Bank into actual measured curvature (real turns) — always present
    // because the route genuinely turns, but kept subtle at baseline so it
    // never reads as "constant side-to-side" — plus the rare beat-driven
    // lateral component above, and a stronger scale during a major event.
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

    const bank = THREE.MathUtils.clamp(curvatureBank + beatBank.current, -0.5, 0.5);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);

    // A tiny "glance" — the rotational impulse nudges where we look, not
    // the camera's up vector, so it can never contribute to a flip.
    const lookXClamped = THREE.MathUtils.clamp(impulseLookX.current, -6, 6);
    const lookYClamped = THREE.MathUtils.clamp(impulseLookY.current, -4, 4);
    const lookTarget = position
      .clone()
      .addScaledVector(frame.tangent, LOOK_AHEAD)
      .addScaledVector(frame.right, lookXClamped)
      .addScaledVector(frame.up, lookYClamped);
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
