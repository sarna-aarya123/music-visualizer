import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { consumeBeat, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from '../cyberpunkCity/world/musicEventDirector';
import { cameraMotionState } from '../cyberpunkCity/world/cameraMotionState';
import { speedPerceptionFrac } from '../cyberpunkCity/world/musicController';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';
import type { ParticleConfig } from './types';

/** Ambient particles shared by every world in three motion styles —
 *  falling (petals, snow, ash), rising (embers, bubbles) and drifting
 *  (dust, spores, stars). All react to drums, beats and major events with
 *  the project's established impulse language. */
export function WorldParticles({
  featureFrame,
  config,
}: {
  featureFrame: AudioFeatureFrame;
  config: ParticleConfig;
}) {
  const materialRef = useRef<THREE.PointsMaterial>(null!);
  const phases = useRef<Float32Array>(null!);
  const burst = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const geometry = useMemo(() => {
    const positions = new Float32Array(config.count * 3);
    const ph = new Float32Array(config.count * 2);
    for (let i = 0; i < config.count; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * config.spread;
      positions[i * 3 + 1] = Math.random() * config.height;
      positions[i * 3 + 2] = (Math.random() - 0.5) * config.spread;
      ph[i * 2 + 0] = Math.random() * Math.PI * 2;
      ph[i * 2 + 1] = 0.5 + Math.random() * 1.4;
    }
    phases.current = ph;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [config.count, config.spread, config.height]);

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
    const dir = config.motion === 1 ? 1 : config.motion === 0 ? -1 : 0;

    for (let i = 0; i < config.count; i++) {
      let x = attr.getX(i), y = attr.getY(i), z = attr.getZ(i);
      const phase = ph[i * 2] + elapsed * ph[i * 2 + 1] * swirl;
      y += dir * dt * (1.1 + ph[i * 2 + 1] * 0.7 + burst.current * 1.2);
      if (dir === 0) y += Math.sin(phase * 1.2) * dt * 0.6;
      x += Math.sin(phase) * dt * (1.3 + burst.current * 2.4) * swirl;
      z += Math.cos(phase * 0.75) * dt * (1.3 + speedFrac * 1.8) * swirl;

      if (y < -8) y = config.height;
      if (y > config.height + 4) y = 0;
      if (Math.abs(x - cam.x) > config.spread / 2) x = cam.x + (Math.random() - 0.5) * config.spread;
      if (Math.abs(z - cam.z) > config.spread / 2) z = cam.z + (Math.random() - 0.5) * config.spread;
      attr.setXYZ(i, x, y, z);
    }
    attr.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.opacity = Math.min(1, config.opacity + featureFrame.sectionMood * 0.25 + burst.current * 0.3);
      materialRef.current.size = config.size + burst.current * 0.2 + rhythmState.drumPresence * 0.06;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={materialRef}
        color={config.color}
        transparent
        opacity={config.opacity}
        size={config.size}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
