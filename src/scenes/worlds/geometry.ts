import * as THREE from 'three';

/** Shared low-poly primitives. Deliberately low segment counts — faceted
 *  silhouettes are part of the stylised look, and they keep instanced
 *  draw costs down across nine worlds. */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  cone5: new THREE.ConeGeometry(1, 1, 5),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cylTaper: new THREE.CylinderGeometry(0.65, 1, 1, 8),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  ico2: new THREE.IcosahedronGeometry(1, 2),
  octa: new THREE.OctahedronGeometry(1, 0),
  tetra: new THREE.TetrahedronGeometry(1, 0),
  dome: new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  torus: new THREE.TorusGeometry(1, 0.08, 8, 28),
  torusThick: new THREE.TorusGeometry(1, 0.18, 8, 24),
};

const dummy = new THREE.Object3D();

/** Builds a matrix from a transform, cloned so callers can collect them. */
export function mat(
  position: THREE.Vector3 | [number, number, number],
  rotation: [number, number, number],
  scale: [number, number, number]
): THREE.Matrix4 {
  if (Array.isArray(position)) dummy.position.set(position[0], position[1], position[2]);
  else dummy.position.copy(position);
  dummy.rotation.set(rotation[0], rotation[1], rotation[2]);
  dummy.scale.set(scale[0], scale[1], scale[2]);
  dummy.updateMatrix();
  return dummy.matrix.clone();
}
