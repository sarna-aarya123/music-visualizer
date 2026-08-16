import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, consumeDrop, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from './world/musicEventDirector';
import { characterMotionState } from './world/characterMotionState';
import { useViewModeStore } from '../../state/viewModeStore';

// A completely flat, unlit black silhouette — deliberately not toon-shaded
// or textured. The environment is the spectacle; the character is a
// minimal, readable shape moving through it.
const BLACK = new THREE.MeshBasicMaterial({ color: '#000000' });

const CHAR_HEIGHT = 2;
const HIP_Y = CHAR_HEIGHT * 0.52;
const SHOULDER_Y = CHAR_HEIGHT * 0.82;
const LEG_LENGTH = HIP_Y * 0.92;
const ARM_LENGTH = CHAR_HEIGHT * 0.36;

/**
 * A minimal stylized humanoid silhouette that runs along the route,
 * grounded at RouteGenerator's own surface (via characterMotionState,
 * written once per frame by CameraRig). Limb swing is driven purely by
 * travel speed (a natural running cadence); bass/808/drop/major events add
 * small accents (compression, forward lean, a brief sprint) independently
 * of whatever the camera itself is doing — hi-hats/snares intentionally
 * never reach the character, same rule as the camera.
 *
 * Hidden entirely in first-person view, since in that mode the viewer IS
 * the character.
 */
export function Character({ featureFrame }: SceneProps) {
  const mode = useViewModeStore((s) => s.mode);

  const groupRef = useRef<THREE.Group>(null!);
  const torsoRef = useRef<THREE.Group>(null!);
  const leftLegRef = useRef<THREE.Group>(null!);
  const rightLegRef = useRef<THREE.Group>(null!);
  const leftArmRef = useRef<THREE.Group>(null!);
  const rightArmRef = useRef<THREE.Group>(null!);

  const stridePhase = useRef(0);
  const compression = useRef(0);
  const lean = useRef(0);

  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    if (!groupRef.current) return;

    groupRef.current.visible = mode !== 'first';

    const m = characterMotionState;
    groupRef.current.position.copy(m.position);
    groupRef.current.up.copy(m.up);
    groupRef.current.lookAt(m.position.clone().add(m.tangent));

    // Bass/808/drop/major accents — independent of the camera's own
    // reaction to the same events, same "only low frequencies" rule.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0.55) compression.current = Math.max(compression.current, beatHit - 0.4);
    const dropHit = consumeDrop(featureFrame, dropState);
    if (dropHit > 0) lean.current = Math.max(lean.current, 0.55);
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) lean.current = Math.max(lean.current, majorHit);

    compression.current *= Math.exp(-dt * 6);
    lean.current *= Math.exp(-dt * 2);

    const strideFreq = 1.3 + m.speed * 0.32;
    stridePhase.current += dt * strideFreq;
    const strideAmp = 0.45 + Math.min(1, m.speed / 12) * 0.6;
    const swing = Math.sin(stridePhase.current) * strideAmp;

    if (leftLegRef.current) leftLegRef.current.rotation.x = swing;
    if (rightLegRef.current) rightLegRef.current.rotation.x = -swing;
    if (leftArmRef.current) leftArmRef.current.rotation.x = -swing * 0.7;
    if (rightArmRef.current) rightArmRef.current.rotation.x = swing * 0.7;

    if (torsoRef.current) {
      const bob = Math.abs(Math.sin(stridePhase.current * 2)) * 0.03;
      torsoRef.current.position.y = SHOULDER_Y - compression.current * 0.3 + bob;
      // A small constant forward-running lean, plus a bigger accent lean
      // on drops/major events.
      torsoRef.current.rotation.x = 0.1 + lean.current * 0.35;
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={leftLegRef} position={[-0.14, HIP_Y, 0]}>
        <mesh position={[0, -LEG_LENGTH / 2, 0]} material={BLACK}>
          <boxGeometry args={[0.15, LEG_LENGTH, 0.15]} />
        </mesh>
      </group>
      <group ref={rightLegRef} position={[0.14, HIP_Y, 0]}>
        <mesh position={[0, -LEG_LENGTH / 2, 0]} material={BLACK}>
          <boxGeometry args={[0.15, LEG_LENGTH, 0.15]} />
        </mesh>
      </group>

      <group ref={torsoRef} position={[0, SHOULDER_Y, 0]}>
        <mesh material={BLACK}>
          <boxGeometry args={[0.42, 0.6, 0.24]} />
        </mesh>
        <mesh position={[0, 0.48, 0]} material={BLACK}>
          <sphereGeometry args={[0.19, 10, 10]} />
        </mesh>
        <group ref={leftArmRef} position={[-0.28, 0.16, 0]}>
          <mesh position={[0, -ARM_LENGTH / 2, 0]} material={BLACK}>
            <boxGeometry args={[0.12, ARM_LENGTH, 0.12]} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.28, 0.16, 0]}>
          <mesh position={[0, -ARM_LENGTH / 2, 0]} material={BLACK}>
            <boxGeometry args={[0.12, ARM_LENGTH, 0.12]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
