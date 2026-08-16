import * as THREE from 'three';

/**
 * The character's ground position/orientation along the route, updated
 * once per frame by CameraRig (which already owns the route-progress `t`
 * and music-driven speed model) and read by both CameraRig itself (to
 * frame third/first-person shots) and Character.tsx (to place and animate
 * the humanoid). A shared mutable singleton for the same reason
 * audio/featureFrame.ts and cameraMotionState.ts are: this changes every
 * frame and must never trigger a React re-render to reach its readers.
 */
export interface CharacterMotionState {
  t: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  speed: number;
}

export const characterMotionState: CharacterMotionState = {
  t: 0,
  position: new THREE.Vector3(),
  tangent: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
  speed: 0,
};
