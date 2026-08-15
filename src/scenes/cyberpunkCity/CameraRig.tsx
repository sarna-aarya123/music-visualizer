import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { SceneProps } from '../types';

/**
 * Cinematic camera: a slow continuous orbit that never fully stops (so the
 * scene stays alive with no audio), gently nudged by the music instead of
 * being driven by it wholesale.
 *
 *  - energy   → slightly faster orbit speed
 *  - mid      → smooth height bob (melody)
 *  - bass     → tiny handheld-style jitter (environmental "breathing")
 *  - kick     → a short forward dolly punch + fov flare that eases out
 *               via kickImpulse's own decay — this is the one place that
 *               reads as a hit rather than a continuous wobble.
 */
export function CameraRig({ featureFrame }: SceneProps) {
  const { camera } = useThree();
  const angle = useRef(0);

  useFrame((_, delta) => {
    const orbitSpeed = 0.045 + featureFrame.energy * 0.05;
    angle.current += delta * orbitSpeed;

    const radius = 16;
    const baseHeight = 5.5 + Math.sin(angle.current * 0.6) * 0.6 + featureFrame.mid * 0.6;

    const targetX = Math.sin(angle.current) * radius;
    const targetZ = Math.cos(angle.current) * radius - 8;

    const impulse = featureFrame.kickImpulse;
    const shakeX = (Math.random() - 0.5) * featureFrame.bass * 0.15;
    const shakeY = (Math.random() - 0.5) * featureFrame.bass * 0.1;

    camera.position.set(
      targetX + shakeX,
      baseHeight + shakeY - impulse * 0.25,
      targetZ + impulse * 0.6
    );
    camera.lookAt(0, 4, -20);

    if (camera instanceof THREE.PerspectiveCamera) {
      const targetFov = 50 + impulse * 4;
      camera.fov += (targetFov - camera.fov) * 0.2;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
