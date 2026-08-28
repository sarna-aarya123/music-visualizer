import * as THREE from 'three';
import type { CameraObstacle } from './environment';

/**
 * Phase 6 Stage 7 — coarse bounding spheres for the cinematic camera's
 * environment-clearance pass (see `CameraRig`'s clearance block).
 *
 * This is NOT collision and NOT route/corridor-clearance math (both of
 * those stay exactly as they are — the corridor tube around the route is
 * still the single source of truth for where the character and gameplay
 * camera can go). It is a soft, camera-only hint: "these are the world's
 * big solid masses; a moving cinematic shot should not sail straight
 * through one." A missing or empty list simply means a world contributes
 * no correction — the camera falls back to its planned path unchanged.
 *
 * Derived from a world's already-computed instance matrices, so it costs
 * nothing at runtime and can never drift from what's actually drawn.
 */

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

/** Max obstacle radius — keeps a single colossal prop (a floating pyramid,
 *  a whale) from turning into an avoidance field so large it would shove
 *  the camera clean out of every shot meant to frame it. The clearance
 *  margin in `CameraRig` is added on top of this. */
const MAX_OBSTACLE_RADIUS = 20;

/**
 * Bounding spheres from a group's instance matrices. `radius` is dominated
 * by the horizontal footprint (camera avoidance is mostly a horizontal
 * problem) with a small contribution from height so tall thin props still
 * register, then clamped to `[minRadius, MAX_OBSTACLE_RADIUS]`.
 */
export function obstaclesFromMatrices(matrices: THREE.Matrix4[], minRadius = 2): CameraObstacle[] {
  const out: CameraObstacle[] = [];
  for (const m of matrices) {
    m.decompose(_pos, _quat, _scale);
    const horiz = Math.max(_scale.x, _scale.z);
    const radius = THREE.MathUtils.clamp(0.5 * horiz + 0.15 * _scale.y, minRadius, MAX_OBSTACLE_RADIUS);
    out.push({ position: _pos.clone(), radius });
  }
  return out;
}

/** Convenience: collect obstacles from several named groups of a built
 *  world at once. Unknown keys are skipped. */
export function collectObstacles(
  groups: { key: string; matrices: THREE.Matrix4[] }[],
  keys: string[],
  minRadius = 2
): CameraObstacle[] {
  const out: CameraObstacle[] = [];
  for (const g of groups) {
    if (keys.includes(g.key)) out.push(...obstaclesFromMatrices(g.matrices, minRadius));
  }
  return out;
}
