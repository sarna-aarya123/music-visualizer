import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, consumeDrop, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from './world/musicEventDirector';
import { characterMotionState } from './world/characterMotionState';
import { MIN_SPEED, MAX_SPEED } from './world/musicController';
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

/** Same bar CameraRig uses for "a real 808/kick" — duplicated rather than
 *  imported so each file stays self-contained; keep the two in sync if
 *  ever retuned. */
const STRONG_BEAT_BAR = 0.72;

type MoveState = 'idle' | 'walk' | 'run' | 'sprint';
type JumpPhase = 'none' | 'anticipation' | 'air' | 'land';

/** Target pose parameters per movement state — Character.tsx doesn't have
 *  animation clips, so "transition" means smoothly interpolating these
 *  numbers frame to frame rather than cross-fading clips. */
interface Pose {
  strideFreq: number;
  strideAmp: number;
  armAmp: number;
  lean: number;
  crouch: number;
  breathe: number;
}

const POSES: Record<MoveState, Pose> = {
  idle: { strideFreq: 0, strideAmp: 0, armAmp: 0, lean: 0.02, crouch: 0, breathe: 1 },
  walk: { strideFreq: 2.2, strideAmp: 0.35, armAmp: 0.28, lean: 0.05, crouch: 0, breathe: 0 },
  run: { strideFreq: 4.0, strideAmp: 0.78, armAmp: 0.58, lean: 0.15, crouch: 0.02, breathe: 0 },
  sprint: { strideFreq: 6.4, strideAmp: 1.08, armAmp: 0.9, lean: 0.32, crouch: 0.09, breathe: 0 },
};

function classifyMoveState(speed: number, forcedSprint: boolean): MoveState {
  if (forcedSprint) return 'sprint';
  if (speed < MIN_SPEED + 1.2) return 'idle';
  if (speed < MIN_SPEED + 4.5) return 'walk';
  if (speed < MAX_SPEED * 1.25) return 'run';
  return 'sprint';
}

/**
 * A minimal stylized humanoid silhouette that runs along the route,
 * grounded at RouteGenerator's own surface (via characterMotionState,
 * written once per frame by CameraRig).
 *
 * Movement state machine: idle -> walk -> run -> sprint, purely from
 * travel speed, plus a forced-sprint window on strong 808s/drops/major
 * events so the character visibly surges with the music rather than only
 * following speed passively. A separate jump sequence (anticipation crouch
 * -> launch -> air -> land) fires on a major event — a deliberate, rare
 * "special action", not a dance move.
 *
 * Hi-hats/snares intentionally never reach the character, same rule as
 * the camera. Hidden entirely in first-person view, since in that mode
 * the viewer IS the character.
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
  const forceSprintTimer = useRef(0);
  const pose = useRef<Pose>({ ...POSES.idle });

  const jumpPhase = useRef<JumpPhase>('none');
  const jumpTimer = useRef(0);
  const jumpOffsetY = useRef(0);
  const jumpVelY = useRef(0);

  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    if (!groupRef.current) return;

    groupRef.current.visible = mode !== 'first';

    const m = characterMotionState;

    // --- Bass/808/drop/major accents — independent of the camera's own
    // reaction to the same events, same "only low frequencies" rule. -----
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0.55) compression.current = Math.max(compression.current, beatHit - 0.4);
    if (beatHit > STRONG_BEAT_BAR) forceSprintTimer.current = Math.max(forceSprintTimer.current, 1.0);

    const dropHit = consumeDrop(featureFrame, dropState);
    if (dropHit > 0) {
      lean.current = Math.max(lean.current, 0.55);
      forceSprintTimer.current = Math.max(forceSprintTimer.current, 2.5);
    }

    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      lean.current = Math.max(lean.current, majorHit);
      forceSprintTimer.current = Math.max(forceSprintTimer.current, 3.0);
      if (jumpPhase.current === 'none') {
        jumpPhase.current = 'anticipation';
        jumpTimer.current = 0;
      }
    }

    compression.current *= Math.exp(-dt * 6);
    lean.current *= Math.exp(-dt * 2);
    forceSprintTimer.current = Math.max(0, forceSprintTimer.current - dt);

    // --- Jump sequence: anticipation crouch -> launch -> air -> land. ---
    // A deliberate special action, not a platformer — only ever triggered
    // by a major musical event.
    const GRAVITY = 20;
    switch (jumpPhase.current) {
      case 'anticipation':
        jumpTimer.current += dt;
        if (jumpTimer.current > 0.14) {
          jumpVelY.current = 7.2;
          jumpPhase.current = 'air';
        }
        break;
      case 'air':
        jumpVelY.current -= GRAVITY * dt;
        jumpOffsetY.current += jumpVelY.current * dt;
        if (jumpOffsetY.current <= 0 && jumpVelY.current < 0) {
          jumpOffsetY.current = 0;
          jumpVelY.current = 0;
          jumpPhase.current = 'land';
          jumpTimer.current = 0;
          compression.current = Math.max(compression.current, 0.85);
        }
        break;
      case 'land':
        jumpTimer.current += dt;
        if (jumpTimer.current > 0.18) jumpPhase.current = 'none';
        break;
      default:
        break;
    }

    groupRef.current.position.copy(m.position).addScaledVector(m.up, jumpOffsetY.current);
    groupRef.current.up.copy(m.up);
    groupRef.current.lookAt(m.position.clone().add(m.tangent));

    // --- Movement state -> target pose, smoothly interpolated (this IS
    // the transition, since there are no animation clips to cross-fade). -
    const moveState = classifyMoveState(m.speed, forceSprintTimer.current > 0);
    const target = POSES[moveState];
    const poseRate = 1 - Math.exp(-dt * 6);
    pose.current.strideFreq += (target.strideFreq - pose.current.strideFreq) * poseRate;
    pose.current.strideAmp += (target.strideAmp - pose.current.strideAmp) * poseRate;
    pose.current.armAmp += (target.armAmp - pose.current.armAmp) * poseRate;
    pose.current.lean += (target.lean - pose.current.lean) * poseRate;
    pose.current.crouch += (target.crouch - pose.current.crouch) * poseRate;
    pose.current.breathe += (target.breathe - pose.current.breathe) * poseRate;

    stridePhase.current += dt * pose.current.strideFreq;
    const swing = Math.sin(stridePhase.current) * pose.current.strideAmp;
    const idleSway = Math.sin(state.clock.elapsedTime * 1.3) * 0.05 * pose.current.breathe;

    const airTuck = jumpPhase.current === 'air' ? 0.5 : 0;

    if (leftLegRef.current) leftLegRef.current.rotation.x = swing - airTuck;
    if (rightLegRef.current) rightLegRef.current.rotation.x = -swing - airTuck;
    if (leftArmRef.current) leftArmRef.current.rotation.x = -swing * (pose.current.armAmp / Math.max(pose.current.strideAmp, 0.001)) + airTuck * 0.6;
    if (rightArmRef.current) rightArmRef.current.rotation.x = swing * (pose.current.armAmp / Math.max(pose.current.strideAmp, 0.001)) + airTuck * 0.6;

    if (torsoRef.current) {
      const bob = Math.abs(Math.sin(stridePhase.current * 2)) * 0.03 * (pose.current.strideAmp > 0.01 ? 1 : 0);
      const breatheBob = Math.sin(state.clock.elapsedTime * 0.9) * 0.02 * pose.current.breathe;
      torsoRef.current.position.y =
        SHOULDER_Y - compression.current * 0.3 - pose.current.crouch + bob + breatheBob;
      torsoRef.current.rotation.x = pose.current.lean + lean.current * 0.35 + idleSway * 0.3;
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
