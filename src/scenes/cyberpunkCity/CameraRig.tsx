import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import {
  consumeBeat,
  consumeDrop,
  consumeEvent,
  consumeSnareHit,
  createBeatConsumerState,
} from '../../audio/beatConsumer';
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

/** Beat intensity has to cross this bar to count as a "strong 808" — only
 *  then does a beat get a speed burst or a real camera punch. Below it, a
 *  beat is barely felt on purpose (Level 1 in the reaction hierarchy). */
const STRONG_BEAT_BAR = 0.72;

/**
 * The camera is a rider on the route, not a free body. Its only degrees of
 * freedom are: `t` (progress around the closed loop, driven entirely by
 * music-controlled speed) and a small, event-driven lateral snap clamped
 * well inside the route's guaranteed-clear corridor. Position and base
 * orientation come directly from RouteGenerator.getFrameAt(t) — this is
 * what makes flying through geometry and orientation flips structurally
 * impossible rather than just unlikely.
 *
 * Every camera movement has to come from one of three sources — there is
 * deliberately no ambient/idle motion for its own sake:
 *   A. Route choreography — curvature-driven banking, always present,
 *      because the route actually turns.
 *   B. Music — tiered reactions to beat/808/snare/drop/major-event, each
 *      tier visibly bigger than the last, with Level 0/1 nearly silent so
 *      normal sections stay calm and comfortable to watch.
 *   C. Cinematic transitions — the altitude dive during a major event.
 */
export function CameraRig({ featureFrame, route }: SceneProps) {
  const { camera } = useThree();

  const t = useRef(Math.random());
  const speed = useRef(createSpeedState()).current;
  const beatState = useRef(createBeatConsumerState()).current;
  const snareState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const smoothedUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevTangent = useRef<THREE.Vector3 | null>(null);
  const snareSnap = useRef(0);

  const impactShake = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;

    // --- Level 0/1: a regular beat is almost silent — a hint of FOV and
    // banking, no shake, no speed change. Level 2: a strong beat (a real
    // 808/kick) gets a short forward burst plus a real, brief punch.
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      if (beatHit > STRONG_BEAT_BAR) {
        applyBeatBurst(speed, beatHit);
        impactShake.current = Math.max(impactShake.current, 0.5 + (beatHit - STRONG_BEAT_BAR) * 1.6);
        impactFov.current = Math.max(impactFov.current, 6 + beatHit * 10);
        beatBank.current += (Math.random() < 0.5 ? -1 : 1) * (0.12 + beatHit * 0.18);
      } else {
        impactFov.current = Math.max(impactFov.current, beatHit * 2.5);
        beatBank.current += (Math.random() < 0.5 ? -1 : 1) * beatHit * 0.045;
      }
    }

    // --- Snare/clap: a sharp, directional lateral snap — a visibly
    // different kind of reaction from the bass punch, and no speed change
    // at all (this is a maneuver, not a boost).
    const snareHit = consumeSnareHit(f, snareState);
    if (snareHit > 0) {
      snareSnap.current += (Math.random() < 0.5 ? -1 : 1) * snareHit * 1.7;
      impactFov.current = Math.max(impactFov.current, snareHit * 5);
    }

    // --- Level 3: a drop gets its own explicit camera punch on top of the
    // speed surge musicController already applies — aggressive but still
    // a single controlled event, not sustained shaking.
    const dropHit = consumeDrop(f, dropState);
    if (dropHit > 0) {
      impactShake.current = Math.max(impactShake.current, 0.9);
      impactFov.current = Math.max(impactFov.current, 22);
      beatBank.current += (Math.random() < 0.5 ? -1 : 1) * 0.3;
    }

    // --- Level 4: a full major event — the one place a truly large launch
    // happens, plus a deliberate cinematic dive (a chosen transition, not
    // random altitude wander).
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impactShake.current = Math.max(impactShake.current, majorHit * 1.3);
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
    const { corridorRadius } = route.getDistrictInfoAt(t.current);

    snareSnap.current *= Math.exp(-dt * 7);

    const decay = Math.exp(-dt * 8);
    impactShake.current *= decay;
    impactFov.current *= decay;
    beatBank.current *= Math.exp(-dt * 3.5);
    const shakeMag = impactShake.current * 0.3;

    const maxLateral = corridorRadius - 1.5;
    const totalLateral = THREE.MathUtils.clamp(snareSnap.current, -maxLateral, maxLateral);

    const position = frame.position
      .clone()
      .addScaledVector(frame.right, totalLateral + (Math.random() - 0.5) * shakeMag)
      .addScaledVector(frame.up, EYE_HEIGHT + altitudeDive + (Math.random() - 0.5) * shakeMag * 0.5);
    camera.position.copy(position);

    // --- Orientation: stable, world-up-referenced, never a Frenet frame.
    smoothedUp.current.lerp(frame.up, 1 - Math.exp(-dt * 3)).normalize();

    // Bank into actual measured curvature (real turns) — always present
    // because the route genuinely turns, scaled up with energy and hard
    // during a major event — plus the beat-driven component above. Still
    // clamped, still smoothed, never a flip.
    let curvatureBank = 0;
    if (prevTangent.current) {
      const cross = new THREE.Vector3().crossVectors(prevTangent.current, frame.tangent);
      const turnRate = cross.y / Math.max(dt, 1e-4);
      const energyScale = 0.55 + 0.45 * f.energy;
      const majorScale = 1 + majorEnvelope * 1.6;
      const bankLimit = 0.3 * majorScale;
      curvatureBank = THREE.MathUtils.clamp(-turnRate * 0.11 * energyScale * majorScale, -bankLimit, bankLimit);
    }
    prevTangent.current = frame.tangent.clone();

    const bank = THREE.MathUtils.clamp(curvatureBank + beatBank.current - snareSnap.current * 0.05, -0.55, 0.55);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);
    camera.lookAt(position.clone().addScaledVector(frame.tangent, LOOK_AHEAD));

    // --- FOV: base + speed-driven widening (a classic speed cue, tied to
    // actual travel speed) + tiered beat punch on top.
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
