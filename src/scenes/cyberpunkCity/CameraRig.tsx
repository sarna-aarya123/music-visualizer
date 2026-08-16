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

/** Beat intensity has to cross this bar to count as a "strong 808" — only
 *  then does a beat get a speed burst or a real camera punch. Below it, a
 *  beat is barely felt on purpose (Level 1 in the reaction hierarchy). */
const STRONG_BEAT_BAR = 0.72;

/**
 * The camera is a rider on the route, not a free body. Its only degrees of
 * freedom are: `t` (progress around the closed loop, driven entirely by
 * music-controlled speed) and its base orientation from
 * RouteGenerator.getFrameAt(t) — this is what makes flying through
 * geometry and orientation flips structurally impossible rather than just
 * unlikely.
 *
 * Every camera movement has to come from one of three sources — there is
 * deliberately no ambient/idle motion for its own sake:
 *   A. Route choreography — curvature-driven banking, always present,
 *      because the route actually turns.
 *   B. Music — but ONLY strong 808s, drops, and major events physically
 *      move the camera. Hi-hats and snares/claps never do — see
 *      world/musicEventDirector.ts for how the major-event trigger itself
 *      is guarded against being set off by high-frequency content alone.
 *      Regular beats get only a hint of FOV/banking. This hierarchy is a
 *      deliberate, repeated product decision, not an oversight: the world
 *      (buildings/ground/particles/atmosphere) is where hi-hat/snare
 *      reactions live instead.
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

  const impactShake = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;

    // --- Level 1: a regular beat is almost silent — a hint of FOV and
    // banking, no shake, no speed change. Level 2: a strong beat (a real
    // 808/kick) gets a short forward burst plus a controlled, still-modest
    // punch — "potentially subtle FOV change", not a big hit.
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      if (beatHit > STRONG_BEAT_BAR) {
        applyBeatBurst(speed, beatHit);
        impactShake.current = Math.max(impactShake.current, 0.35 + (beatHit - STRONG_BEAT_BAR) * 1.1);
        impactFov.current = Math.max(impactFov.current, 4 + beatHit * 6);
        beatBank.current += (Math.random() < 0.5 ? -1 : 1) * (0.08 + beatHit * 0.12);
      } else {
        impactFov.current = Math.max(impactFov.current, beatHit * 1.5);
        beatBank.current += (Math.random() < 0.5 ? -1 : 1) * beatHit * 0.025;
      }
    }

    // Hi-hats and snares/claps are deliberately NOT consumed here at all —
    // they drive world reactions (Buildings/Particles/Ground/CityAtmosphere)
    // but must never touch camera position, rotation, banking, FOV, or
    // shake. See the file-level comment above.

    // --- Drop: its own explicit camera punch on top of the speed surge
    // musicController already applies — noticeably more than a strong
    // beat, but still one controlled event, not sustained shaking.
    const dropHit = consumeDrop(f, dropState);
    if (dropHit > 0) {
      impactShake.current = Math.max(impactShake.current, 0.75);
      impactFov.current = Math.max(impactFov.current, 18);
      beatBank.current += (Math.random() < 0.5 ? -1 : 1) * 0.24;
    }

    // --- Major event: the one place a truly large launch happens, plus a
    // deliberate cinematic dive (a chosen transition, not random altitude
    // wander). Gated in musicEventDirector.ts to require real bass/energy
    // involvement, not just a burst of high-frequency content.
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

    const decay = Math.exp(-dt * 8);
    impactShake.current *= decay;
    impactFov.current *= decay;
    beatBank.current *= Math.exp(-dt * 3.5);
    const shakeMag = impactShake.current * 0.3;

    const position = frame.position
      .clone()
      .addScaledVector(frame.right, (Math.random() - 0.5) * shakeMag)
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

    const bank = THREE.MathUtils.clamp(curvatureBank + beatBank.current, -0.55, 0.55);
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
