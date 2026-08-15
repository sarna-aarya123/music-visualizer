import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import type { SceneProps } from '../types';
import { CORRIDOR_Z_END, CORRIDOR_Z_START, STREET_HALF_WIDTH } from './layout';

/**
 * Street-level poles/lamps lining the corridor close to where the camera
 * travels — the foreground depth layer: things near the lens that give the
 * environment scale and occasionally drift past close enough to partially
 * frame a shot, rather than everything in view being distant scenery.
 */
const SPACING = 9;

const poleGeometry = new THREE.CylinderGeometry(0.06, 0.09, 1, 6);
const poleMaterial = new THREE.MeshStandardMaterial({ color: '#0c0b1a', roughness: 0.8 });

const lampGeometry = new THREE.SphereGeometry(0.16, 8, 8);
const lampMaterial = new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false });

const POLE_HEIGHT = 3.4;

export function StreetProps(_props: SceneProps) {
  const poleRef = useRef<THREE.InstancedMesh>(null!);
  const lampRef = useRef<THREE.InstancedMesh>(null!);

  const positions = useMemo(() => {
    const list: { x: number; z: number }[] = [];
    let z = CORRIDOR_Z_START - 2;
    while (z > CORRIDOR_Z_END) {
      list.push({ x: -(STREET_HALF_WIDTH - 1.2), z });
      list.push({ x: STREET_HALF_WIDTH - 1.2, z });
      z -= SPACING;
    }
    return list;
  }, []);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, POLE_HEIGHT / 2, p.z);
      dummy.scale.set(1, POLE_HEIGHT, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      poleRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, POLE_HEIGHT + 0.1, p.z);
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
