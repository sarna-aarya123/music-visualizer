import * as THREE from 'three';

/**
 * A tiny exactly-once trigger singleton (same pattern as beatConsumer's
 * id/intensity events) letting Character.tsx ask Ground.tsx's existing
 * impact-ripple shader to fire at the character's own landing position —
 * ties a jump landing into the same world-reactivity language as a beat,
 * without Ground needing to import or know anything about Character.
 */
export interface GroundImpactState {
  id: number;
  position: THREE.Vector3;
  strength: number;
}

export const groundImpactState: GroundImpactState = {
  id: 0,
  position: new THREE.Vector3(),
  strength: 0,
};

let counter = 0;

export function triggerGroundImpact(position: THREE.Vector3, strength: number): void {
  counter += 1;
  groundImpactState.id = counter;
  groundImpactState.position.copy(position);
  groundImpactState.strength = strength;
}
