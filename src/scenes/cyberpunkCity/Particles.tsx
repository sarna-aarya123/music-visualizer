import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';

const COUNT = 260;
const HEIGHT_RANGE = 40;
const SPREAD = 70;

/** Drifting embers/light motes. Base drift is always present (idle scene
 *  still feels alive); high frequencies add extra upward speed and opacity
 *  — the "hi-hats → small particle activity" mapping. */
export function Particles({ featureFrame }: SceneProps) {
  const materialRef = useRef<THREE.PointsMaterial>(null!);
  const speedsRef = useRef<Float32Array>(null!);

  const geometry = useMemo(() => {
    const positions = new Float32Array(COUNT * 3);
    const speeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * SPREAD;
      positions[i * 3 + 1] = Math.random() * HEIGHT_RANGE;
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD - 20;
      speeds[i] = 0.4 + Math.random() * 1.2;
    }
    speedsRef.current = speeds;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((_, delta) => {
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const speeds = speedsRef.current;
    const activity = featureFrame.high;

    for (let i = 0; i < COUNT; i++) {
      let y = posAttr.getY(i);
      y += delta * (0.6 + speeds[i] * (0.5 + activity * 1.5));
      if (y > HEIGHT_RANGE) y = 0;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.opacity = 0.25 + activity * 0.6 + featureFrame.kickImpulse * 0.2;
      materialRef.current.size = 0.12 + activity * 0.18;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={materialRef}
        color="#9be8ff"
        transparent
        opacity={0.3}
        size={0.15}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
