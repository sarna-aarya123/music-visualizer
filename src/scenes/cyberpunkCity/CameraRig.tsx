import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';
import {
  applyBeatImpulse,
  createChoreographyState,
  stepChoreography,
} from './cameraChoreography';

/**
 * Applies the camera choreography (see cameraChoreography.ts) to the real
 * Three.js camera each frame, then layers a short, obvious impact —
 * position shake + FOV punch — on top of every beat. The choreography
 * itself already changed the camera's actual trajectory on that beat; this
 * is the tactile "hit" on top of a path that was already redirected, not a
 * substitute for redirecting it.
 */
export function CameraRig({ featureFrame }: SceneProps) {
  const { camera } = useThree();
  const choreography = useRef(createChoreographyState()).current;
  const beatState = useRef(createBeatConsumerState()).current;

  const impactShake = useRef(0);
  const impactFov = useRef(0);
  const currentFov = useRef(50);

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;

    const beatHit = consumeBeat(f, beatState);
    if (beatHit > 0) {
      applyBeatImpulse(choreography, beatHit);
      impactShake.current = beatHit;
      impactFov.current = beatHit * 10;
    }

    stepChoreography(choreography, dt, f);

    const decay = Math.exp(-dt * 8);
    impactShake.current *= decay;
    impactFov.current *= decay;

    const shakeMag = impactShake.current * 0.35;
    const shakeX = (Math.random() - 0.5) * shakeMag;
    const shakeY = (Math.random() - 0.5) * shakeMag * 0.7;

    camera.position.set(
      choreography.position.x + shakeX,
      choreography.position.y + shakeY,
      choreography.position.z
    );

    const bank = choreography.bank;
    camera.up.set(Math.sin(bank), Math.cos(bank), 0);
    camera.lookAt(choreography.lookTarget);

    const targetFov = choreography.fov + impactFov.current;
    currentFov.current += (targetFov - currentFov.current) * (1 - Math.exp(-dt * 11));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = currentFov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
