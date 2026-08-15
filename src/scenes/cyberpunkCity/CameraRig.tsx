import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';
import { CORRIDOR_Z_END, CORRIDOR_Z_START, STREET_HALF_WIDTH } from './layout';

const BASE_SPEED = 3.4; // world units/sec at moderate energy & tempo
const BASE_FOV = 50;

/**
 * A cinematographer, not an orbit rig.
 *
 * The camera travels back and forth along the street corridor. Its speed
 * is shaped by a slow "energy envelope" (a heavily-smoothed version of
 * overall energy, standing in for section intensity without needing full
 * section detection) combined with a few independent slow sine waves —
 * deliberately not noise — so pace rises, falls, and occasionally nearly
 * stops, then picks back up, the way a real cut would breathe with a
 * track. Lateral position and the look-at target drift the same way:
 * smooth, low-frequency, and periodically retargeted, rather than a fixed
 * circular path.
 *
 * Beats are handled completely separately from that ambient drift: every
 * new beat (consumed exactly once via consumeBeat) fires a forward punch +
 * shake + FOV pulse that decays exponentially back to the cinematic
 * baseline — impact, then recovery, every time.
 */
export function CameraRig({ featureFrame }: SceneProps) {
  const { camera } = useThree();

  const travelZ = useRef((CORRIDOR_Z_START + CORRIDOR_Z_END) / 2);
  const direction = useRef<1 | -1>(-1);
  const tempoPhase = useRef(0);

  const energyEnvelope = useRef(0.15);

  const lookTarget = useRef(new THREE.Vector3(0, 5, CORRIDOR_Z_END));
  const desiredLookOffset = useRef(new THREE.Vector3(0, 0, 0));
  const nextLookChangeAt = useRef(3);

  const impulseForward = useRef(0);
  const impulseShake = useRef(0);
  const impulseFov = useRef(0);
  const currentFov = useRef(BASE_FOV);

  const beatState = useRef(createBeatConsumerState()).current;

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;
    const t = state.clock.elapsedTime;

    // --- Slow "section energy" envelope --------------------------------
    // A heavily damped follower of overall energy — this is what lets the
    // camera feel like it's responding to a song's arc (intro/build/drop)
    // without doing full section analysis.
    energyEnvelope.current += (f.energy - energyEnvelope.current) * (1 - Math.exp(-0.35 * dt));

    // --- Breathing tempo: sum of slow, independent sine waves ----------
    // Deliberately curves, not randomness — the pace rises and falls
    // smoothly and occasionally dips into a near-pause before recovering.
    tempoPhase.current += dt;
    const breathing =
      0.55 +
      0.3 * Math.sin(tempoPhase.current * 0.11) +
      0.15 * Math.sin(tempoPhase.current * 0.043 + 1.1);
    const pauseWave = Math.sin(tempoPhase.current * 0.037 + 2.4);
    const pauseFactor = pauseWave < -0.55 ? 0.12 : 1;

    const speed = BASE_SPEED * (0.2 + energyEnvelope.current * 1.4) * breathing * pauseFactor;

    travelZ.current += direction.current * speed * dt;
    if (travelZ.current < CORRIDOR_Z_END + 12) direction.current = 1;
    if (travelZ.current > CORRIDOR_Z_START - 4) direction.current = -1;

    // --- Lateral drift: sum of sines at irrational-ish frequency ratios,
    // so it never quite repeats but stays smooth and intentional-feeling.
    const lateralRaw =
      Math.sin(t * 0.13) * 2.4 +
      Math.sin(t * 0.071 + 1.7) * 1.2 +
      Math.sin(t * 0.29 + 0.4) * 0.5;
    const lateral = THREE.MathUtils.clamp(lateralRaw, -(STREET_HALF_WIDTH - 2), STREET_HALF_WIDTH - 2);

    const baseHeight = 5.4 + Math.sin(t * 0.09) * 0.9 + f.mid * 0.7;

    // --- Periodic retargeting: pan toward a different part of the scene
    // every several seconds instead of always looking straight ahead.
    if (t > nextLookChangeAt.current) {
      nextLookChangeAt.current = t + 4 + Math.random() * 5;
      desiredLookOffset.current.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 5,
        -16 - Math.random() * 26
      );
    }

    // --- Beat impulse: consumed exactly once per beat, guaranteed -------
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      impulseForward.current = beatHit * 1.6;
      impulseShake.current = beatHit * 0.24;
      impulseFov.current = beatHit * 7;
    }
    const decay = Math.exp(-dt * 8.5);
    impulseForward.current *= decay;
    impulseShake.current *= decay;
    impulseFov.current *= decay;

    const shakeX = (Math.random() - 0.5) * impulseShake.current;
    const shakeY = (Math.random() - 0.5) * impulseShake.current * 0.6;

    // Continuous, subtle "the world is breathing" jitter from bass — kept
    // clearly smaller than beat shake so it never reads as a hit itself.
    const breatheX = (Math.random() - 0.5) * f.bass * 0.05;
    const breatheY = (Math.random() - 0.5) * f.bass * 0.03;

    const camX = lateral + shakeX + breatheX;
    const camY = baseHeight + shakeY + breatheY;
    const camZ = travelZ.current + impulseForward.current * direction.current;

    camera.position.set(camX, camY, camZ);

    const desiredLook = new THREE.Vector3(
      lateral * 0.3 + desiredLookOffset.current.x,
      baseHeight + desiredLookOffset.current.y,
      travelZ.current + direction.current * 30 + desiredLookOffset.current.z
    );
    lookTarget.current.lerp(desiredLook, 1 - Math.exp(-dt * 1.4));
    camera.lookAt(lookTarget.current);

    const targetFov = BASE_FOV + impulseFov.current;
    currentFov.current += (targetFov - currentFov.current) * (1 - Math.exp(-dt * 10));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = currentFov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
