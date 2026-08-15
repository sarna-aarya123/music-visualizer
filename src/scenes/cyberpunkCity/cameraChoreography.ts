import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../audio/types';
import { CORRIDOR_Z_END, CORRIDOR_Z_START, STREET_HALF_WIDTH } from './layout';

/**
 * The camera "director". This module owns nothing React/Three-render-loop
 * specific — it's a plain state object plus pure step functions, so the
 * choreography logic (what the camera is trying to do) stays cleanly
 * separated from CameraRig.tsx (how that gets applied to the real camera).
 *
 * Model: the camera is a physical body with position + velocity, steering
 * ("seek" behavior) toward a target waypoint. Reaching a waypoint picks the
 * next one. Music controls this at every level:
 *
 *  - `energy` continuously scales max speed/accel — the camera visibly
 *    speeds up and slows down with the music, smoothly.
 *  - A four-state machine (idle/build/high/breakdown), driven by comparing
 *    a fast and a slow energy envelope, approximates song sections without
 *    doing real section detection: a sudden rise = a "drop" into high
 *    energy (one-shot velocity burst), a sudden fall out of high = a
 *    breakdown (one-shot deceleration snap).
 *  - Every beat directly perturbs velocity and (for strong beats) the
 *    current target — beats change *where the camera is going*, not just a
 *    decaying offset layered on top of an unaffected path.
 *  - `beatInterval` (live tempo estimate) tightens how often waypoints are
 *    allowed to be reached/replaced, so a faster song produces visibly more
 *    frequent directional changes.
 *
 * No orbiting, no per-frame random jitter driving the main path — waypoints
 * and the steering toward them are the only source of directional change,
 * beat impulses aside.
 */

export type CameraState = 'idle' | 'build' | 'high' | 'breakdown';

interface StateTuning {
  maxSpeed: number;
  maxAccel: number;
  reachDist: number;
  lateralRange: number;
  verticalRange: number;
  fovBoost: number;
}

const TUNING: Record<CameraState, StateTuning> = {
  idle: { maxSpeed: 1.6, maxAccel: 1.2, reachDist: 6, lateralRange: 3.5, verticalRange: 2.2, fovBoost: 0 },
  build: { maxSpeed: 5.5, maxAccel: 3.6, reachDist: 9, lateralRange: STREET_HALF_WIDTH - 2, verticalRange: 5.5, fovBoost: 4 },
  high: { maxSpeed: 12, maxAccel: 9, reachDist: 11, lateralRange: STREET_HALF_WIDTH - 1, verticalRange: 10, fovBoost: 10 },
  breakdown: { maxSpeed: 2, maxAccel: 2.6, reachDist: 5, lateralRange: 3, verticalRange: 2.5, fovBoost: -3 },
};

const BASE_FOV = 50;

export interface ChoreographyState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  target: THREE.Vector3;
  travelDir: 1 | -1;

  cameraState: CameraState;
  stateDwell: number;
  energyEnvelopeSlow: number;
  energyEnvelopeFast: number;

  bank: number;
  lookTarget: THREE.Vector3;
  fov: number;
}

export function createChoreographyState(): ChoreographyState {
  const startZ = (CORRIDOR_Z_START + CORRIDOR_Z_END) / 2;
  return {
    position: new THREE.Vector3(0, 6, startZ),
    velocity: new THREE.Vector3(0, 0, -1),
    target: new THREE.Vector3(0, 6, startZ - 20),
    travelDir: -1,
    cameraState: 'idle',
    stateDwell: 0,
    energyEnvelopeSlow: 0.1,
    energyEnvelopeFast: 0.1,
    bank: 0,
    lookTarget: new THREE.Vector3(0, 6, startZ - 30),
    fov: BASE_FOV,
  };
}

function pickWaypoint(from: THREE.Vector3, travelDir: 1 | -1, cfg: StateTuning): THREE.Vector3 {
  const forwardStep = 16 + Math.random() * 20;
  const z = THREE.MathUtils.clamp(
    from.z + travelDir * forwardStep,
    CORRIDOR_Z_END + 8,
    CORRIDOR_Z_START - 4
  );
  const x = THREE.MathUtils.clamp(
    from.x + (Math.random() - 0.5) * 2 * cfg.lateralRange,
    -(STREET_HALF_WIDTH - 1),
    STREET_HALF_WIDTH - 1
  );
  const y = THREE.MathUtils.clamp(5 + (Math.random() - 0.5) * 2 * cfg.verticalRange, 2.2, 24);
  return new THREE.Vector3(x, y, z);
}

/** Decide the state for this frame, with hysteresis (a minimum dwell time)
 *  so it doesn't flicker between states on noisy energy readings. */
function decideState(prev: CameraState, dwell: number, slow: number, fast: number): CameraState {
  const trend = fast - slow;
  let desired: CameraState;

  if (slow < 0.14) desired = 'idle';
  else if (trend > 0.14 && slow > 0.3) desired = 'high'; // sudden rise = a "drop"
  else if (trend < -0.12 && prev === 'high') desired = 'breakdown';
  else if (slow > 0.58) desired = 'high';
  else if (trend > 0.05) desired = 'build';
  else if (trend < -0.08) desired = 'breakdown';
  else desired = prev === 'idle' ? 'build' : prev;

  const minDwell = desired === 'high' || desired === 'breakdown' ? 0.7 : 1.3;
  if (desired !== prev && dwell < minDwell) return prev;
  return desired;
}

/** Advances the choreography by `dt` seconds using this frame's audio
 *  features. Call once per render frame. */
export function stepChoreography(ch: ChoreographyState, dt: number, f: AudioFeatureFrame): void {
  ch.energyEnvelopeSlow += (f.energy - ch.energyEnvelopeSlow) * (1 - Math.exp(-0.35 * dt));
  ch.energyEnvelopeFast += (f.energy - ch.energyEnvelopeFast) * (1 - Math.exp(-1.6 * dt));

  ch.stateDwell += dt;
  const nextState = decideState(ch.cameraState, ch.stateDwell, ch.energyEnvelopeSlow, ch.energyEnvelopeFast);

  if (nextState !== ch.cameraState) {
    ch.stateDwell = 0;

    // DROP: entering high energy from anything else is a single loud burst
    // of forward velocity — a visible "and now we go" moment.
    if (nextState === 'high') {
      const dir = ch.velocity.lengthSq() > 1e-4 ? ch.velocity.clone().normalize() : new THREE.Vector3(0, 0, ch.travelDir);
      ch.velocity.addScaledVector(dir, 7);
    }
    // BREAKDOWN: a hard deceleration snap, then the normal steering model
    // takes back over and eases into the slow breakdown pace.
    if (nextState === 'breakdown') {
      ch.velocity.multiplyScalar(0.3);
    }
    ch.cameraState = nextState;
  }

  const cfg = TUNING[ch.cameraState];
  const energyBoost = 0.5 + f.energy * 1.15;
  const maxSpeed = cfg.maxSpeed * energyBoost;
  const maxAccel = cfg.maxAccel * (0.6 + f.energy);

  // Faster songs (smaller beatInterval) reach waypoints "sooner" — the
  // camera changes direction more often, giving the movement a rhythm that
  // visibly relates to the track's tempo, not just its loudness.
  const tempoFactor = THREE.MathUtils.clamp(f.beatInterval / 0.5, 0.55, 1.35);
  const reachDist = cfg.reachDist * tempoFactor;

  const toTarget = ch.target.clone().sub(ch.position);
  if (toTarget.length() < reachDist) {
    if (ch.position.z < CORRIDOR_Z_END + 14) ch.travelDir = 1;
    if (ch.position.z > CORRIDOR_Z_START - 6) ch.travelDir = -1;
    ch.target = pickWaypoint(ch.position, ch.travelDir, cfg);
    toTarget.copy(ch.target).sub(ch.position);
  }

  const desiredDir =
    toTarget.lengthSq() > 1e-4 ? toTarget.clone().normalize() : new THREE.Vector3(0, 0, ch.travelDir);
  const desiredVel = desiredDir.multiplyScalar(maxSpeed);
  const velDiff = desiredVel.sub(ch.velocity);
  const maxDeltaV = maxAccel * dt;
  if (velDiff.length() > maxDeltaV) velDiff.setLength(maxDeltaV);
  ch.velocity.add(velDiff);

  ch.position.addScaledVector(ch.velocity, dt);
  ch.position.x = THREE.MathUtils.clamp(ch.position.x, -(STREET_HALF_WIDTH - 1), STREET_HALF_WIDTH - 1);
  ch.position.y = THREE.MathUtils.clamp(ch.position.y, 2, 24);
  ch.position.z = THREE.MathUtils.clamp(ch.position.z, CORRIDOR_Z_END, CORRIDOR_Z_START + 4);

  // Bank into turns — proportional to how hard we're currently steering.
  const targetBank = THREE.MathUtils.clamp(-velDiff.x * 0.06, -0.35, 0.35);
  ch.bank += (targetBank - ch.bank) * (1 - Math.exp(-dt * 4));

  const aheadDir = ch.velocity.lengthSq() > 0.01 ? ch.velocity.clone().normalize() : desiredDir;
  const desiredLook = ch.position.clone().addScaledVector(aheadDir, 14).lerp(ch.target, 0.35);
  ch.lookTarget.lerp(desiredLook, 1 - Math.exp(-dt * 3.2));

  const speedFrac = THREE.MathUtils.clamp(ch.velocity.length() / (cfg.maxSpeed * 1.4), 0, 1);
  ch.fov = BASE_FOV + cfg.fovBoost * 0.5 + speedFrac * 6;
}

/**
 * Every beat directly perturbs the trajectory: a forward velocity kick
 * scaled by intensity, and — for strong beats — an immediate sideways
 * shift of the current target so the camera visibly changes where it's
 * heading, not just how it's shaking.
 */
export function applyBeatImpulse(ch: ChoreographyState, intensity: number): void {
  const dir = ch.velocity.lengthSq() > 1e-4 ? ch.velocity.clone().normalize() : new THREE.Vector3(0, 0, ch.travelDir);
  ch.velocity.addScaledVector(dir, 2.5 + intensity * 6.5);

  if (intensity > 0.55) {
    const lateralKick = (Math.random() - 0.5) * 2 * (STREET_HALF_WIDTH - 2) * intensity;
    ch.target.x = THREE.MathUtils.clamp(
      ch.target.x + lateralKick,
      -(STREET_HALF_WIDTH - 1),
      STREET_HALF_WIDTH - 1
    );
  }
}
