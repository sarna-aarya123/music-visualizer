import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
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

/**
 * Opt-in per-frame animation for a subset of a group's instances. The
 * index set is fixed for the group's lifetime (decided by the world's
 * generator, same as everything else about instance membership) — only
 * the *transform* of those indices is recomputed every frame.
 *
 * `sample` must not allocate: write the instance's current transform into
 * `out` and read only from `elapsed`/`dt` and module-level state (per the
 * project's rule that per-frame data never goes through React state).
 */
export interface AnimatedInstances {
  indices: number[];
  sample: (index: number, out: THREE.Matrix4, elapsed: number, dt: number) => void;
}

export function OutlinedInstances({
  geometry,
  material,
  outline,
  matrices,
  animated,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  outline: THREE.Material;
  matrices: THREE.Matrix4[];
  /** Omit for the static write-once path — a group with no `animated`
   *  prop does no per-frame instance work beyond the camera-uniform
   *  update every group already pays. */
  animated?: AnimatedInstances;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const outlineRef = useRef<THREE.InstancedMesh>(null!);
  const count = matrices.length;
  const scratch = useRef<THREE.Matrix4>(null!);
  if (!scratch.current) scratch.current = new THREE.Matrix4();

  useEffect(() => {
    if (!meshRef.current || count === 0) return;
    for (let i = 0; i < count; i++) meshRef.current.setMatrixAt(i, matrices[i]);
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (outlineRef.current) {
      outlineRef.current.instanceMatrix.copyArray(meshRef.current.instanceMatrix.array);
      outlineRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrices, count]);

  // Contiguous runs over `animated.indices`, computed once per animated
  // set (not per frame) — lets the per-frame path submit a handful of
  // `addUpdateRange` calls instead of re-uploading the whole instance
  // buffer for a group that mostly holds static instances.
  const animatedRanges = useMemo(() => {
    if (!animated || animated.indices.length === 0) return [];
    const sorted = [...animated.indices].sort((a, b) => a - b);
    const ranges: { start: number; count: number }[] = [];
    let start = sorted[0];
    let prev = sorted[0];
    for (let k = 1; k < sorted.length; k++) {
      const idx = sorted[k];
      if (idx === prev + 1) {
        prev = idx;
        continue;
      }
      ranges.push({ start, count: prev - start + 1 });
      start = idx;
      prev = idx;
    }
    ranges.push({ start, count: prev - start + 1 });
    return ranges;
  }, [animated]);

  useFrame((state, rawDelta) => {
    // Keep the camera position current for the rim/fog terms.
    const m = material as THREE.ShaderMaterial;
    if (m.uniforms?.uCameraPos) {
      (m.uniforms.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
    }

    // Groups without an animated set take neither branch below — the only
    // per-frame cost they pay is the camera-uniform write above, which
    // already ran for every group before this stage.
    if (!animated || animatedRanges.length === 0 || !meshRef.current) return;

    const dt = Math.min(rawDelta, 0.05);
    const elapsed = state.clock.elapsedTime;
    const surfaceAttr = meshRef.current.instanceMatrix;
    for (const idx of animated.indices) {
      animated.sample(idx, scratch.current, elapsed, dt);
      meshRef.current.setMatrixAt(idx, scratch.current);
    }
    // 16 floats per instance — matrix element count, not instance count.
    for (const r of animatedRanges) surfaceAttr.addUpdateRange(r.start * 16, r.count * 16);
    surfaceAttr.needsUpdate = true;

    // Mirror the touched bytes into the outline shell in the same frame,
    // so the ink line can never lag a frame behind the surface it traces.
    if (outlineRef.current) {
      const outlineAttr = outlineRef.current.instanceMatrix;
      outlineAttr.copyArray(surfaceAttr.array);
      for (const r of animatedRanges) outlineAttr.addUpdateRange(r.start * 16, r.count * 16);
      outlineAttr.needsUpdate = true;
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
