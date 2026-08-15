import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import type { SceneProps } from '../types';

/**
 * Street-level poles/lamps along the route's edge — the foreground depth
 * layer: close, fast-moving-past props that make travel speed legible
 * (strong parallax) and give the corridor a sense of being a real,
 * inhabited street rather than an empty flight path.
 */
const SPACING_T = 0.012; // fraction of the loop between lamps — a lot of them

const poleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 1, 6);
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#0c0b1a', roughness: 0.8 });

const lampGeometry = new THREE.SphereGeometry(0.16, 8, 8);
const lampMaterial = new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false });

const POLE_HEIGHT = 3.2;

export function StreetProps({ route }: SceneProps) {
  const poleRef = useRef<THREE.InstancedMesh>(null!);
  const lampRef = useRef<THREE.InstancedMesh>(null!);

  const positions = useMemo(() => {
    const list: { position: THREE.Vector3; right: THREE.Vector3 }[] = [];
    const count = Math.floor(1 / SPACING_T);
    for (let i = 0; i < count; i++) {
      const t = i * SPACING_T;
      const frame = route.getFrameAt(t);
      const { corridorRadius } = route.getDistrictInfoAt(t);
      const edgeOffset = Math.max(2, corridorRadius - 1.4);
      const side = i % 2 === 0 ? -1 : 1;
      list.push({
        position: frame.position.clone().addScaledVector(frame.right, side * edgeOffset),
        right: frame.right,
      });
    }
    return list;
  }, [route]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      dummy.position.set(p.position.x, p.position.y + POLE_HEIGHT / 2, p.position.z);
      dummy.scale.set(1, POLE_HEIGHT, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.position.x, p.position.y + POLE_HEIGHT + 0.1, p.position.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      lampRef.current.setMatrixAt(i, dummy.matrix);
    });
    poleRef.current.instanceMatrix.needsUpdate = true;
    lampRef.current.instanceMatrix.needsUpdate = true;
  }, [positions]);

  return (
    <>
      <instancedMesh ref={poleRef} args={[poleGeometry, poleMaterial, positions.length]} frustumCulled={false} />
      <instancedMesh ref={lampRef} args={[lampGeometry, lampMaterial, positions.length]} frustumCulled={false} />
    </>
  );
}
