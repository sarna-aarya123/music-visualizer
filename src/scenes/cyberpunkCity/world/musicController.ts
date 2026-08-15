import * as THREE from 'three';

/**
 * The speed model: "music controls the ride." Deliberately 1-dimensional
 * (a single forward speed along the route) rather than a 3D velocity —
 * direction and turning are entirely the route's job (see routeGenerator),
 * so this only ever has to answer "how fast are we going right now."
 *
 *  - Continuous `energy` sets a cruise target speed (quiet = slow,
 *    high-energy = fast) that speed tracks toward at a fast-but-smooth
 *    rate — quick enough that energy changes are clearly felt within
 *    under a second, not a slow multi-second drift.
 *  - Every beat adds an instantaneous, additive burst directly to the
 *    current speed — a real surge, not a decaying offset layered on top
 *    of an unaffected cruise speed. The burst then bleeds off through the
 *    same continuous tracking every other frame uses, so "settle back
 *    toward the current target" falls out for free instead of needing its
 *    own decay timer.
 */

export const MIN_SPEED = 4.5;
export const MAX_SPEED = 30;
export const MAX_SPEED_CAP = 46;

const BURST_BASE = 3.5;
const BURST_SCALE = 16;
const SPEED_TRACK_RATE = 2.6; // per second — fast enough to feel sudden

export function computeTargetSpeed(energy: number): number {
  const eased = THREE.MathUtils.smoothstep(energy, 0, 1);
  return THREE.MathUtils.lerp(MIN_SPEED, MAX_SPEED, eased);
}

export interface SpeedState {
  current: number;
}

export function createSpeedState(): SpeedState {
  return { current: MIN_SPEED };
}

export function applyBeatBurst(state: SpeedState, beatIntensity: number): void {
  state.current = Math.min(state.current + BURST_BASE + beatIntensity * BURST_SCALE, MAX_SPEED_CAP);
}

export function stepSpeed(state: SpeedState, dt: number, energy: number): void {
  const target = computeTargetSpeed(energy);
  state.current += (target - state.current) * (1 - Math.exp(-SPEED_TRACK_RATE * dt));
  state.current = Math.max(state.current, 0);
}
