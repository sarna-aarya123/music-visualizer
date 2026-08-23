import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { consumeBeat, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from '../cyberpunkCity/world/musicEventDirector';
import { cameraMotionState } from '../cyberpunkCity/world/cameraMotionState';
import { speedPerceptionFrac } from '../cyberpunkCity/world/musicController';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';

const COUNT = 280;
const SPREAD = 70;
const HEIGHT = 34;

/** Drifting sakura petals — the reference's "peaceful but alive" signal.
 *  They fall and swirl continuously, swirl harder with drum presence, and
 *  burst outward on a major event. */
export function Petals({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const materialRef = useRef<THREE.PointsMaterial>(null!);
  const phases = useRef<Float32Array>(null!);
  const burst = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const geometry = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const ph = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * SPREAD;
      positions[i * 3 + 1] = Math.random() * HEIGHT;
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD;
      ph[i * 2 + 0] = Math.random() * Math.PI * 2;
      ph[i * 2 + 1] = 0.5 + Math.random() * 1.4;
    }
    phases.current = ph;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const elapsed = state.clock.elapsedTime;
    const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const ph = phases.current;
    const cam = state.camera.position;

    const beat = consumeBeat(featureFrame, beatState);
    if (beat > 0) burst.current = Math.max(burst.current, beat * 0.6);
    const major = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (major > 0) burst.current = Math.max(burst.current, 2.2 + major * 2);
    burst.current *= Math.exp(-dt * 4);

    const swirl = 1 + rhythmState.drumPresence * 1.6;
    const speedFrac = speedPerceptionFrac(cameraMotionState.speed);

    for (let i = 0; i < COUNT; i++) {
      let x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i);
      const phase = ph[i * 2] + elapsed * ph[i * 2 + 1] * swirl;
      // Fall, with a lateral swirl so petals tumble rather than drop
      // straight down.
      y -= dt * (1.1 + ph[i * 2 + 1] * 0.7 + burst.current * 1.2);
      x += Math.sin(phase) * dt * (1.3 + burst.current * 2.4) * swirl;
      z += Math.cos(phase * 0.75) * dt * (1.3 + speedFrac * 1.8) * swirl;

      if (y < -8) y = HEIGHT;
      if (Math.abs(x - cam.x) > SPREAD / 2) x = cam.x + (Math.random() - 0.5) * SPREAD;
      if (Math.abs(z - cam.z) > SPREAD / 2) z = cam.z + (Math.random() - 0.5) * SPREAD;
      attr.setXYZ(i, x, y, z);
    }
    attr.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.opacity = Math.min(1, 0.5 + featureFrame.sectionMood * 0.3 + burst.current * 0.3);
      materialRef.current.size = 0.3 + burst.current * 0.22 + rhythmState.drumPresence * 0.08;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={materialRef}
        color="#ffc2e0"
        transparent
        opacity={0.6}
        size={0.3}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
