import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, consumeEvent, consumeSnareHit, createBeatConsumerState } from '../../audio/beatConsumer';
import {
  applyBeatBurst,
  applyMajorLaunch,
  createSpeedState,
  MAX_SPEED_CAP,
  stepSpeed,
} from './world/musicController';
import { cameraMotionState } from './world/cameraMotionState';
import { majorEventState } from './world/musicEventDirector';

const EYE_HEIGHT = 3.2;
const BASE_FOV = 52;
const LOOK_AHEAD = 16;

/** Beat intensity has to cross this bar to count as a "strong 808" worth a
 *  speed burst — most beats should only ever produce camera impact. */
const STRONG_BEAT_BAR = 0.72;

/**
 * The camera is a rider on the route, not a free body. Its only degrees of
 * freedom are: `t` (progress around the closed loop, driven entirely by
 * music-controlled speed) and a small lateral weave clamped well inside
 * the route's guaranteed-clear corridor. Position and base orientation
 * come directly from RouteGenerator.getFrameAt(t) — this is what makes
 * flying through geometry and orientation flips structurally impossible
 * rather than just unlikely.
 *
 * Reaction hierarchy, deliberately NOT "every beat accelerates the
 * camera": most beats only ever produce shake/FOV/bank (camera impact);
 * only a strong beat (a real 808/kick, not just any bass onset) adds a
 * short speed burst; the big speed swings come from section-level drop/
 * breakdown events inside musicController's `sectionMultiplier`, not from
 * individual beats at all. Snare/clap is a distinct sharp lateral snap,
 * not a speed effect — a different musical element should produce a
 * visibly different kind of camera reaction.
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
  const snareSnap = useRef(0);

  const impactShake = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;
    const elapsed = state.clock.elapsedTime;

    // --- Beat: camera impact always; a speed burst only for strong hits.
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      if (beatHit > STRONG_BEAT_BAR) applyBeatBurst(speed, beatHit);
      impactShake.current = Math.max(impactShake.current, beatHit);
      impactFov.current = Math.max(impactFov.current, beatHit * 9);
      beatBank.current += (Math.random() < 0.5 ? -1 : 1) * beatHit * 0.22;
    }

    // --- Snare/clap: a sharp, directional lateral snap — a visibly
    // different kind of reaction from the bass punch, and no speed change
    // at all (this is a maneuver, not a boost).
    const snareHit = consumeSnareHit(f, snareState);
    if (snareHit > 0) {
      snareSnap.current += (Math.random() < 0.5 ? -1 : 1) * snareHit * 2.2;
      impactFov.current = Math.max(impactFov.current, snareHit * 5);
    }

    // --- Major event: the one place a truly large launch happens.
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impactShake.current = Math.max(impactShake.current, majorHit * 1.4);
      impactFov.current = Math.max(impactFov.current, majorHit * 18);
    }

    // Structural drop/breakdown events (consumed inside stepSpeed) are
    // what actually drive the big cruise -> fast-section -> settle curve.
    stepSpeed(speed, dt, f);
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
    snareSnap.current *= Math.exp(-dt * 7);

    const decay = Math.exp(-dt * 8);
    impactShake.current *= decay;
    impactFov.current *= decay;
    beatBank.current *= Math.exp(-dt * 3.5);
    const shakeMag = impactShake.current * 0.32;

    const maxLateral = corridorRadius - 1.5;
    const totalLateral = THREE.MathUtils.clamp(lateralOffset.current + snareSnap.current, -maxLateral, maxLateral);

    const position = frame.position
      .clone()
      .addScaledVector(frame.right, totalLateral + (Math.random() - 0.5) * shakeMag)
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

    const bank = THREE.MathUtils.clamp(curvatureBank + beatBank.current - snareSnap.current * 0.05, -0.42, 0.42);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);
    camera.lookAt(position.clone().addScaledVector(frame.tangent, LOOK_AHEAD));

    // --- FOV: base + speed-driven widening (a classic speed cue) + beat
    // punch on top.
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
