import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, consumeEvent, consumeSnareHit, createBeatConsumerState } from '../../audio/beatConsumer';
import {
  applyBeatBurst,
  applyMajorLaunch,
  applySnareBurst,
  createSpeedState,
  MAX_SPEED_CAP,
  stepSpeed,
} from './world/musicController';
import { cameraMotionState } from './world/cameraMotionState';
import { majorEventState } from './world/musicEventDirector';

const EYE_HEIGHT = 3.2;
const BASE_FOV = 52;
const LOOK_AHEAD = 16;

/**
 * The camera is a rider on the route, not a free body. Its only degrees of
 * freedom are: `t` (progress around the closed loop, driven entirely by
 * music-controlled speed) and a small lateral weave clamped well inside
 * the route's guaranteed-clear corridor. Position and base orientation
 * come directly from RouteGenerator.getFrameAt(t) — this is what makes
 * flying through geometry and orientation flips structurally impossible
 * rather than just unlikely.
 *
 * Hierarchy of reactions (matching what should be most visible first):
 * 1) speed — every beat/snare/major-event surges the actual travel speed,
 *    a real trajectory change, not decoration; 2) banking harder into
 *    turns on strong beats; 3) a secondary shake/FOV punch on top.
 */
export function CameraRig({ featureFrame, route }: SceneProps) {
  const { camera } = useThree();

  const t = useRef(Math.random());
  const speed = useRef(createSpeedState()).current;
  const beatState = useRef(createBeatConsumerState()).current;
  const snareState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const smoothedUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevTangent = useRef<THREE.Vector3 | null>(null);
  const lateralOffset = useRef(0);

  const impactShake = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;
    const elapsed = state.clock.elapsedTime;

    // --- Music drives speed FIRST — trajectory before decoration. --------
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      applyBeatBurst(speed, beatHit);
      impactShake.current = Math.max(impactShake.current, beatHit);
      impactFov.current = Math.max(impactFov.current, beatHit * 9);
      beatBank.current += (Math.random() < 0.5 ? -1 : 1) * beatHit * 0.22;
    }

    // Snare/clap: a sharper, quicker camera "snap" distinct from the
    // bass-driven surge — its own smaller speed nudge plus a fast punch.
    const snareHit = consumeSnareHit(f, snareState);
    if (snareHit > 0) {
      applySnareBurst(speed, snareHit);
      impactShake.current = Math.max(impactShake.current, snareHit * 0.7);
      impactFov.current = Math.max(impactFov.current, snareHit * 6);
    }

    // Major event: consumed exactly once at the moment it enters 'impact'
    // — a launch far beyond anything a single beat produces.
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impactShake.current = Math.max(impactShake.current, majorHit * 1.4);
      impactFov.current = Math.max(impactFov.current, majorHit * 18);
    }

    stepSpeed(speed, dt, f.energy);
    cameraMotionState.speed = speed.current;

    // --- Advance along the route (arc-length based: speed is in real
    // world units/sec regardless of route length or curvature). ----------
    t.current = ((t.current + (speed.current * dt) / route.length) % 1 + 1) % 1;

    const frame = route.getFrameAt(t.current);
    const { corridorRadius } = route.getDistrictInfoAt(t.current);

    // Small controlled lateral weave — a racing line, not free navigation.
    // Clamped well inside the corridor regardless of district width.
    const weaveTarget =
      Math.sin(elapsed * 0.35) * Math.min(corridorRadius * 0.3, 3) * (0.3 + f.mid * 0.7);
    lateralOffset.current += (weaveTarget - lateralOffset.current) * (1 - Math.exp(-dt * 1.6));

    const decay = Math.exp(-dt * 8);
    impactShake.current *= decay;
    impactFov.current *= decay;
    beatBank.current *= Math.exp(-dt * 3.5);
    const shakeMag = impactShake.current * 0.32;

    const position = frame.position
      .clone()
      .addScaledVector(frame.right, lateralOffset.current + (Math.random() - 0.5) * shakeMag)
      .addScaledVector(frame.up, EYE_HEIGHT + (Math.random() - 0.5) * shakeMag * 0.5);
    camera.position.copy(position);

    // --- Orientation: stable, world-up-referenced, never a Frenet frame.
    smoothedUp.current.lerp(frame.up, 1 - Math.exp(-dt * 3)).normalize();

    // Bank into actual measured curvature (real turns) plus a beat-driven
    // component so strong beats visibly bank the camera harder — still
    // clamped, still smoothed, never a flip.
    let curvatureBank = 0;
    if (prevTangent.current) {
      const cross = new THREE.Vector3().crossVectors(prevTangent.current, frame.tangent);
      const turnRate = cross.y / Math.max(dt, 1e-4);
      curvatureBank = THREE.MathUtils.clamp(-turnRate * 0.12, -0.32, 0.32);
    }
    prevTangent.current = frame.tangent.clone();

    const bank = THREE.MathUtils.clamp(curvatureBank + beatBank.current, -0.42, 0.42);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);
    camera.lookAt(position.clone().addScaledVector(frame.tangent, LOOK_AHEAD));

    // --- FOV: base + speed-driven widening (a classic speed cue) + beat
    // punch on top.
    const speedFrac = THREE.MathUtils.clamp(speed.current / MAX_SPEED_CAP, 0, 1);
    const targetFov = BASE_FOV + speedFrac * 12 + impactFov.current;
    currentFov.current += (targetFov - currentFov.current) * (1 - Math.exp(-dt * 11));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = currentFov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
