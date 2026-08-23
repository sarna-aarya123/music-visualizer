import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

/**
 * An instanced prop family plus its matching ink-line shell, in one
 * component. Every world builds its geometry out of these, so adding a
 * prop type costs a few lines instead of the ~40 of paired mesh/outline
 * boilerplate the first world needed.
 *
 * Takes precomputed matrices so a world's layout stays pure data produced
 * by its generator, and the outline shell copies those exact matrices
 * rather than recomputing them — the line can never drift out of register
 * with its surface.
 */
export function OutlinedInstances({
  geometry,
  material,
  outline,
  matrices,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  outline: THREE.Material;
  matrices: THREE.Matrix4[];
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const outlineRef = useRef<THREE.InstancedMesh>(null!);
  const count = matrices.length;

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    for (let i = 0; i < count; i++) meshRef.current.setMatrixAt(i, matrices[i]);
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (outlineRef.current) {
      outlineRef.current.instanceMatrix.copyArray(meshRef.current.instanceMatrix.array);
      outlineRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices, count]);

  // Keep the camera position current for the rim/fog terms.
  useFrame((state) => {
    const m = material as THREE.ShaderMaterial;
    if (m.uniforms?.uCameraPos) {
      (m.uniforms.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
    }
  });

  if (count === 0) return null;

  return (
    <>
      <instancedMesh ref={outlineRef} args={[geometry, outline, count]} frustumCulled={false} />
      <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
    </>
  );
}
