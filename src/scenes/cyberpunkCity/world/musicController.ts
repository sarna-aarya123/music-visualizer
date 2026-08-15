import * as THREE from 'three';

/**
 * The speed model: "music controls the ride." Deliberately 1-dimensional
 * (a single forward speed along the route) rather than a 3D velocity —
 * direction and turning are entirely the route's job (see routeGenerator),
 * so this only ever has to answer "how fast are we going right now."
 *
 *  - Continuous `energy` sets a cruise target speed (quiet = slow floating
 *    travel, high-energy = a genuine blast) that speed tracks toward
 *    *asymmetrically* — fast attack when the target rises (acceleration
 *    reads as sudden, a racing-game boost) and a slower release when it
 *    falls (deceleration stays cinematic instead of feeling like braking).
 *  - Every beat adds an instantaneous, additive burst directly to the
 *    current speed — a real surge, not a decaying offset layered on top
 *    of an unaffected cruise speed. The burst then bleeds off through the
 *    same continuous tracking every other frame uses.
 *  - A major event (see musicEventDirector.ts) applies a much larger
 *    dedicated launch on top of all of this.
 */

export const MIN_SPEED = 3;
export const MAX_SPEED = 55;
export const MAX_SPEED_CAP = 130;

const BURST_BASE = 5;
const BURST_SCALE = 26;
const SNARE_BURST_BASE = 2;
const SNARE_BURST_SCALE = 9;
const MAJOR_LAUNCH_BASE = 30;
const MAJOR_LAUNCH_SCALE = 55;

const SPEED_TRACK_RATE_UP = 4.5; // fast — energy rising feels immediate
const SPEED_TRACK_RATE_DOWN = 1.6; // slower — settling down stays cinematic

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

export function applySnareBurst(state: SpeedState, snareIntensity: number): void {
  state.current = Math.min(state.current + SNARE_BURST_BASE + snareIntensity * SNARE_BURST_SCALE, MAX_SPEED_CAP);
}

export function applyMajorLaunch(state: SpeedState, intensity: number): void {
  state.current = Math.min(state.current + MAJOR_LAUNCH_BASE + intensity * MAJOR_LAUNCH_SCALE, MAX_SPEED_CAP);
}

export function stepSpeed(state: SpeedState, dt: number, energy: number): void {
  const target = computeTargetSpeed(energy);
  const rate = target > state.current ? SPEED_TRACK_RATE_UP : SPEED_TRACK_RATE_DOWN;
  state.current += (target - state.current) * (1 - Math.exp(-rate * dt));
  state.current = Math.max(state.current, 0);
}
