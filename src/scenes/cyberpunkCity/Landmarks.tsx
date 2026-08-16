import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';
import type { AudioFeatureFrame } from '../../audio/types';
import type { ReactorRing, GiantSpire } from './world/worldGenerator';

const spireGeometry = new THREE.ConeGeometry(1, 1, 8);

/**
 * A handful of large, deliberately distinct landmark structures — a torus
 * and a colossal spire, genuinely different shape language from the
 * box-based buildings everywhere else. Reserved for a few memorable
 * moments per lap (see worldGenerator.ts's pickLandmarkKind) rather than
 * scattered everywhere — "5 amazing landmarks" over "50 similar boxes".
 */
export function Landmarks({ featureFrame, world }: SceneProps) {
  return (
    <>
      {world.reactorRings.map((ring, i) => (
        <ReactorRingMesh key={`ring-${i}`} ring={ring} featureFrame={featureFrame} />
      ))}
      {world.giantSpires.map((spire, i) => (
        <GiantSpireMesh key={`spire-${i}`} spire={spire} featureFrame={featureFrame} />
      ))}
    </>
  );
}

/** A glowing ring, upright and roughly facing along the route — pulses
 *  continuously (always alive) and surges harder with bass/energy. */
function ReactorRingMesh({ ring, featureFrame }: { ring: ReactorRing; featureFrame: AudioFeatureFrame }) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null!);

  useFrame((state) => {
    const idle = 0.7 + 0.3 * Math.sin(state.clock.elapsedTime * 1.1);
    if (materialRef.current) {
      materialRef.current.emissiveIntensity = idle * (1 + featureFrame.bass * 1.5 + featureFrame.energy * 0.6);
    }
  });

  return (
    <mesh position={[ring.x, ring.y, ring.z]} rotation={[Math.PI / 2, ring.rotationY, 0]}>
      <torusGeometry args={[ring.radius, ring.tube, 12, 32]} />
      <meshStandardMaterial
        ref={materialRef}
        color="#ffb35c"
        emissive="#ff7a3c"
        emissiveIntensity={1}
        roughness={0.35}
        metalness={0.3}
      />
    </mesh>
  );
}

/** A colossal freestanding tower with a pulsing beacon tip — meant to be
 *  recognizable from far across the district, not just another roof cap. */
function GiantSpireMesh({ spire, featureFrame }: { spire: GiantSpire; featureFrame: AudioFeatureFrame }) {
  const tipRef = useRef<THREE.MeshBasicMaterial>(null!);

  useFrame((state) => {
    const idle = 0.6 + 0.4 * Math.sin(state.clock.elapsedTime * 1.6 + spire.x * 0.01);
    if (tipRef.current) {
      tipRef.current.opacity = Math.min(1, idle * (0.7 + featureFrame.high * 1.2));
    }
  });

  return (
    <group position={[spire.x, spire.y, spire.z]} rotation={[0, spire.rotationY, 0]}>
      <mesh position={[0, spire.height / 2, 0]} scale={[spire.radius, spire.height, spire.radius]} geometry={spireGeometry}>
        <meshStandardMaterial color="#141230" roughness={0.6} />
      </mesh>
      <mesh position={[0, spire.height + spire.radius * 0.3, 0]}>
        <sphereGeometry args={[spire.radius * 0.22, 10, 10]} />
        <meshBasicMaterial ref={tipRef} color="#7ef2ff" toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
