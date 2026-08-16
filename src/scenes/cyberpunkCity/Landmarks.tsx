import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';
import type { AudioFeatureFrame } from '../../audio/types';
import type { ReactorRing, GiantSpire } from './world/worldGenerator';
import { getMajorEventEnvelope } from './world/musicEventDirector';

const spireGeometry = new THREE.ConeGeometry(1, 1, 8);
const NODE_COUNT = 8;
const NODE_ANGLES = Array.from({ length: NODE_COUNT }, (_, i) => (i / NODE_COUNT) * Math.PI * 2);

/**
 * A handful of large, deliberately distinct landmark structures — a torus
 * and a colossal spire, genuinely different shape language from the
 * box-based buildings everywhere else. Reserved for a few memorable
 * moments per lap (see worldGenerator.ts's pickLandmarkKind) rather than
 * scattered everywhere — "5 amazing landmarks" over "50 similar boxes".
 * Normally dormant-idle; on a major event they become the "holy shit"
 * moment: the ring's energy nodes spin up hard and a beam fires upward,
 * the spire's beacon flares.
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

/** A glowing ring with orbiting energy nodes (the nodes are what make the
 *  spin actually visible — a plain torus is rotationally symmetric and
 *  wouldn't show it) — idles continuously, surges with bass/energy, and
 *  spins up dramatically + fires a beam skyward on a major event. */
function ReactorRingMesh({ ring, featureFrame }: { ring: ReactorRing; featureFrame: AudioFeatureFrame }) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null!);
  const nodesGroupRef = useRef<THREE.Group>(null!);
  const beamRef = useRef<THREE.MeshBasicMaterial>(null!);
  const spinSpeed = useRef(0.3);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const majorEnvelope = getMajorEventEnvelope();
    const idle = 0.7 + 0.3 * Math.sin(state.clock.elapsedTime * 1.1);

    if (materialRef.current) {
      materialRef.current.emissiveIntensity =
        idle * (1 + featureFrame.bass * 1.5 + featureFrame.energy * 0.6) + majorEnvelope * 6;
    }

    const targetSpin = 0.3 + featureFrame.bass * 1.5 + majorEnvelope * 14;
    spinSpeed.current += (targetSpin - spinSpeed.current) * (1 - Math.exp(-dt * 3));
    if (nodesGroupRef.current) nodesGroupRef.current.rotation.z += spinSpeed.current * dt;

    if (beamRef.current) beamRef.current.opacity = Math.min(0.85, majorEnvelope * 1.4);
  });

  return (
    <>
      <group position={[ring.x, ring.y, ring.z]} rotation={[Math.PI / 2, ring.rotationY, 0]}>
        <mesh>
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
        <group ref={nodesGroupRef}>
          {NODE_ANGLES.map((a, i) => (
            <mesh key={i} position={[Math.cos(a) * ring.radius, Math.sin(a) * ring.radius, 0]}>
              <sphereGeometry args={[ring.tube * 0.9, 8, 8]} />
              <meshBasicMaterial color="#fff3d6" toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
      {/* A separate, world-aligned beam (not nested in the ring's tilted
          local frame) so "energy shoots upward" actually means world-up. */}
      <mesh position={[ring.x, ring.y, ring.z]}>
        <cylinderGeometry args={[ring.tube * 0.35, ring.tube * 0.35, 260, 8, 1, true]} />
        <meshBasicMaterial
          ref={beamRef}
          color="#ffe3b0"
          toneMapped={false}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/** A colossal freestanding tower with a pulsing beacon tip and a slowly
 *  orbiting tilted accent band — meant to be recognizable from far across
 *  the district. The beacon flares hard on a major event. */
function GiantSpireMesh({ spire, featureFrame }: { spire: GiantSpire; featureFrame: AudioFeatureFrame }) {
  const tipRef = useRef<THREE.MeshBasicMaterial>(null!);
  const bandGroupRef = useRef<THREE.Group>(null!);
  const bandTilt = useMemo(() => 0.3 + (spire.radius % 1) * 0.2, [spire.radius]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const majorEnvelope = getMajorEventEnvelope();
    const idle = 0.6 + 0.4 * Math.sin(state.clock.elapsedTime * 1.6 + spire.x * 0.01);
    if (tipRef.current) {
      tipRef.current.opacity = Math.min(1, idle * (0.7 + featureFrame.high * 1.2) + majorEnvelope * 1.5);
    }
    if (bandGroupRef.current) {
      bandGroupRef.current.rotation.y += dt * (0.25 + majorEnvelope * 2.5);
    }
  });

  return (
    <group position={[spire.x, spire.y, spire.z]} rotation={[0, spire.rotationY, 0]}>
      <mesh position={[0, spire.height / 2, 0]} scale={[spire.radius, spire.height, spire.radius]} geometry={spireGeometry}>
        <meshStandardMaterial color="#141230" roughness={0.6} />
      </mesh>
      {/* A tilted band orbiting around the spire's vertical axis — because
          its plane isn't aligned with the rotation axis, the spin actually
          reads visually instead of being hidden by torus symmetry. */}
      <group ref={bandGroupRef} position={[0, spire.height * 0.55, 0]} rotation={[bandTilt, 0, 0]}>
        <mesh>
          <torusGeometry args={[spire.radius * 1.4, spire.radius * 0.08, 8, 24]} />
          <meshBasicMaterial color="#7ef2ff" toneMapped={false} transparent opacity={0.75} />
        </mesh>
      </group>
      <mesh position={[0, spire.height + spire.radius * 0.3, 0]}>
        <sphereGeometry args={[spire.radius * 0.22, 10, 10]} />
        <meshBasicMaterial ref={tipRef} color="#7ef2ff" toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
