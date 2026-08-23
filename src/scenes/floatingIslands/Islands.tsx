import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { getMajorEventEnvelope } from '../cyberpunkCity/world/musicEventDirector';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';
import type { FloatingIslandsWorld } from './world/worldGenerator';
import { ToonSurfaceMaterial, ToonOutlineMaterial } from './ToonMaterial';

/**
 * The islands themselves plus everything standing on them. All instanced
 * — one draw call per shape family regardless of count — which is what
 * keeps a densely-populated sky cheap.
 *
 * Shape language follows the reference: islands are inverted rocky cones
 * (broad grassy top, tapering to a point underneath), pagodas are stacked
 * tiers with wide flared roofs, sakura are dark trunks under soft pink
 * canopy clusters.
 */

// Cone with the point DOWN (rotated at instance time) — the classic
// floating-island underside.
const rockGeometry = new THREE.ConeGeometry(1, 1, 9);
const grassGeometry = new THREE.CylinderGeometry(1, 1, 1, 9);
const trunkGeometry = new THREE.CylinderGeometry(0.6, 1, 1, 6);
const canopyGeometry = new THREE.IcosahedronGeometry(1, 1);
const roofGeometry = new THREE.ConeGeometry(1, 1, 4);
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);

export function Islands({
  featureFrame,
  world,
}: {
  featureFrame: AudioFeatureFrame;
  world: FloatingIslandsWorld;
}) {
  const rockRef = useRef<THREE.InstancedMesh>(null!);
  const grassRef = useRef<THREE.InstancedMesh>(null!);
  const trunkRef = useRef<THREE.InstancedMesh>(null!);
  const canopyRef = useRef<THREE.InstancedMesh>(null!);
  const roofRef = useRef<THREE.InstancedMesh>(null!);
  const bodyRef = useRef<THREE.InstancedMesh>(null!);
  const toriiRef = useRef<THREE.InstancedMesh>(null!);
  // Outline shells — same geometry, same instance transforms, drawn
  // back-faces-only behind each real mesh.
  const rockOutRef = useRef<THREE.InstancedMesh>(null!);
  const grassOutRef = useRef<THREE.InstancedMesh>(null!);
  const trunkOutRef = useRef<THREE.InstancedMesh>(null!);
  const canopyOutRef = useRef<THREE.InstancedMesh>(null!);
  const roofOutRef = useRef<THREE.InstancedMesh>(null!);
  const bodyOutRef = useRef<THREE.InstancedMesh>(null!);
  const toriiOutRef = useRef<THREE.InstancedMesh>(null!);

  const nearIslands = useMemo(() => world.islands.filter((i) => i.isNear), [world]);

  // Roof + body counts: each pagoda contributes one roof and one body per
  // tier, so they're sized from the total tier count.
  const totalTiers = useMemo(
    () => world.pagodas.reduce((sum, p) => sum + p.tiers, 0),
    [world]
  );
  // Each torii is 2 posts + 2 beams.
  const toriiParts = world.torii.length * 4;

  // Cel-shaded, high-key, saturated — see ToonMaterial.ts. Every colour is
  // pushed well above what a realistic renderer would use, because the
  // banded lighting darkens the shadow side on its own and a "correct"
  // mid-tone base ends up muddy once shaded.
  const materials = useMemo(() => {
    const make = (color: string, shadow: string, rim: string, opts?: { rimStrength?: number; emissive?: number }) => {
      const m = new ToonSurfaceMaterial();
      (m.uniforms.uColor.value as THREE.Color).set(color);
      (m.uniforms.uShadowTint.value as THREE.Color).set(shadow);
      (m.uniforms.uRimColor.value as THREE.Color).set(rim);
      const rimStrength = opts?.rimStrength ?? 0.5;
      m.uniforms.uRimStrength.value = rimStrength;
      m.uniforms.uEmissive.value = opts?.emissive ?? 0;
      // Remembered so the per-frame major-event rim boost scales from this
      // material's own baseline rather than drifting upward each frame.
      m.userData.baseRim = rimStrength;
      return m;
    };
    return {
      // Violet rock, shadowed toward deep indigo rather than black.
      rock: make('#8a5fb0', '#3a2270', '#ffbfe4', { rimStrength: 0.7 }),
      // Bright, unmistakably green grass caps.
      grass: make('#7ee081', '#2f7a86', '#eaffc0', { rimStrength: 0.55 }),
      trunk: make('#6b4a5e', '#2e1c46', '#ffc9e6', { rimStrength: 0.45 }),
      // Hot sakura pink — the world's signature colour.
      canopy: make('#ffb3dd', '#c25aa8', '#fff0f8', { rimStrength: 0.85, emissive: 0.12 }),
      roof: make('#e8556b', '#7a1f4a', '#ffd0d8', { rimStrength: 0.6 }),
      // Lantern-lit pagoda bodies: strongly emissive so they glow.
      body: make('#ffe9c2', '#d98a4a', '#fff6e0', { rimStrength: 0.4, emissive: 0.5 }),
      torii: make('#ff6a52', '#8a2118', '#ffd2c0', { rimStrength: 0.6 }),
    };
  }, []);

  // One shared outline material for everything — the ink line should be a
  // single consistent weight and colour across the whole world, the way a
  // drawn frame has one pen.
  const outlineMaterial = useMemo(() => {
    const m = new ToonOutlineMaterial();
    m.side = THREE.BackSide;
    m.uniforms.uOutlineWidth.value = 0.16;
    (m.uniforms.uColor.value as THREE.Color).set('#331545');
    return m;
  }, []);

  useEffect(
    () => () => {
      Object.values(materials).forEach((m) => m.dispose());
      outlineMaterial.dispose();
    },
    [materials, outlineMaterial]
  );

  useEffect(() => {
    const d = new THREE.Object3D();

    world.islands.forEach((isl, i) => {
      // Point-down cone: flip X by PI so the cone's apex faces downward.
      d.position.set(isl.x, isl.y - isl.depth / 2, isl.z);
      d.rotation.set(Math.PI, isl.rotationY, 0);
      d.scale.set(isl.radius, isl.depth, isl.radius);
      d.updateMatrix();
      rockRef.current.setMatrixAt(i, d.matrix);
    });
    rockRef.current.instanceMatrix.needsUpdate = true;

    nearIslands.forEach((isl, i) => {
      d.position.set(isl.x, isl.y + 0.15, isl.z);
      d.rotation.set(0, isl.rotationY, 0);
      d.scale.set(isl.radius * 0.99, 0.7, isl.radius * 0.99);
      d.updateMatrix();
      grassRef.current.setMatrixAt(i, d.matrix);
    });
    if (nearIslands.length) grassRef.current.instanceMatrix.needsUpdate = true;

    world.trees.forEach((t, i) => {
      d.position.set(t.x, t.y + t.trunkHeight / 2, t.z);
      d.rotation.set(0, t.seed * 6.28, 0);
      d.scale.set(0.22 + t.seed * 0.14, t.trunkHeight, 0.22 + t.seed * 0.14);
      d.updateMatrix();
      trunkRef.current.setMatrixAt(i, d.matrix);

      d.position.set(t.x, t.y + t.trunkHeight + t.canopyRadius * 0.42, t.z);
      d.rotation.set(t.seed * 2.1, t.seed * 4.4, t.seed * 1.3);
      d.scale.set(t.canopyRadius, t.canopyRadius * 0.72, t.canopyRadius);
      d.updateMatrix();
      canopyRef.current.setMatrixAt(i, d.matrix);
    });
    if (world.trees.length) {
      trunkRef.current.instanceMatrix.needsUpdate = true;
      canopyRef.current.instanceMatrix.needsUpdate = true;
    }

    // Pagodas: stacked shrinking tiers, each a lit body box under a wide
    // flared roof — the reference's most recognisable structure.
    let tierIdx = 0;
    world.pagodas.forEach((p) => {
      let y = p.y;
      for (let tier = 0; tier < p.tiers; tier++) {
        const shrink = 1 - tier * 0.16;
        const bodyW = 3.2 * p.scale * shrink;
        const bodyH = 2.3 * p.scale * (1 - tier * 0.08);

        d.position.set(p.x, y + bodyH / 2, p.z);
        d.rotation.set(0, p.rotationY, 0);
        d.scale.set(bodyW, bodyH, bodyW);
        d.updateMatrix();
        bodyRef.current.setMatrixAt(tierIdx, d.matrix);

        const roofR = bodyW * 1.15;
        const roofH = 1.5 * p.scale * shrink;
        d.position.set(p.x, y + bodyH + roofH / 2, p.z);
        d.rotation.set(0, p.rotationY + Math.PI / 4, 0);
        d.scale.set(roofR, roofH, roofR);
        d.updateMatrix();
        roofRef.current.setMatrixAt(tierIdx, d.matrix);

        y += bodyH + roofH * 0.62;
        tierIdx++;
      }
    });
    if (totalTiers) {
      bodyRef.current.instanceMatrix.needsUpdate = true;
      roofRef.current.instanceMatrix.needsUpdate = true;
    }

    let tp = 0;
    world.torii.forEach((g) => {
      const h = 5 * g.scale;
      const w = 3.4 * g.scale;
      for (const sx of [-1, 1]) {
        d.position.set(
          g.x + Math.cos(g.rotationY) * sx * w * 0.5,
          g.y + h / 2,
          g.z + Math.sin(g.rotationY) * sx * w * 0.5
        );
        d.rotation.set(0, g.rotationY, 0);
        d.scale.set(0.32 * g.scale, h, 0.32 * g.scale);
        d.updateMatrix();
        toriiRef.current.setMatrixAt(tp++, d.matrix);
      }
      // Two crossbeams.
      for (const [oy, ow] of [[h, w * 1.35], [h * 0.78, w * 1.05]] as const) {
        d.position.set(g.x, g.y + oy, g.z);
        d.rotation.set(0, g.rotationY, 0);
        d.scale.set(ow, 0.34 * g.scale, 0.3 * g.scale);
        d.updateMatrix();
        toriiRef.current.setMatrixAt(tp++, d.matrix);
      }
    });
    if (toriiParts) toriiRef.current.instanceMatrix.needsUpdate = true;

    // Outline shells reuse the exact instance transforms — copied, never
    // recomputed, so they can't drift out of alignment with their mesh.
    const pairs: [THREE.InstancedMesh, THREE.InstancedMesh][] = [
      [rockRef.current, rockOutRef.current],
      [grassRef.current, grassOutRef.current],
      [trunkRef.current, trunkOutRef.current],
      [canopyRef.current, canopyOutRef.current],
      [roofRef.current, roofOutRef.current],
      [bodyRef.current, bodyOutRef.current],
      [toriiRef.current, toriiOutRef.current],
    ];
    for (const [src, dst] of pairs) {
      if (!src || !dst) continue;
      dst.instanceMatrix.copyArray(src.instanceMatrix.array);
      dst.instanceMatrix.needsUpdate = true;
    }
  }, [world, nearIslands, totalTiers, toriiParts]);

  useFrame((state) => {
    const env = getMajorEventEnvelope();
    const cam = state.camera.position;

    // Lantern glow and blossom brightness ride the music; the rim light
    // strengthens with a major event so every silhouette flares.
    materials.body.uniforms.uEmissive.value =
      0.4 + featureFrame.sectionMood * 0.35 + featureFrame.energy * 0.25 + env * 1.2;
    materials.canopy.uniforms.uEmissive.value =
      0.08 + rhythmState.drumPresence * 0.22 + featureFrame.sectionMood * 0.15 + env * 0.5;

    for (const m of Object.values(materials)) {
      (m.uniforms.uCameraPos.value as THREE.Vector3).copy(cam);
      m.uniforms.uRimStrength.value = (m.userData.baseRim as number) * (1 + env * 1.1);
    }
  });

  const treeCount = Math.max(1, world.trees.length);
  const tierCount = Math.max(1, totalTiers);
  const toriiCount = Math.max(1, toriiParts);
  const grassCount = Math.max(1, nearIslands.length);

  return (
    <>
      <instancedMesh ref={rockOutRef} args={[rockGeometry, outlineMaterial, world.islands.length]} frustumCulled={false} />
      <instancedMesh ref={grassOutRef} args={[grassGeometry, outlineMaterial, grassCount]} frustumCulled={false} />
      <instancedMesh ref={trunkOutRef} args={[trunkGeometry, outlineMaterial, treeCount]} frustumCulled={false} />
      <instancedMesh ref={canopyOutRef} args={[canopyGeometry, outlineMaterial, treeCount]} frustumCulled={false} />
      <instancedMesh ref={roofOutRef} args={[roofGeometry, outlineMaterial, tierCount]} frustumCulled={false} />
      <instancedMesh ref={bodyOutRef} args={[boxGeometry, outlineMaterial, tierCount]} frustumCulled={false} />
      <instancedMesh ref={toriiOutRef} args={[boxGeometry, outlineMaterial, toriiCount]} frustumCulled={false} />

      <instancedMesh ref={rockRef} args={[rockGeometry, materials.rock, world.islands.length]} frustumCulled={false} />
      <instancedMesh ref={grassRef} args={[grassGeometry, materials.grass, grassCount]} frustumCulled={false} />
      <instancedMesh ref={trunkRef} args={[trunkGeometry, materials.trunk, treeCount]} frustumCulled={false} />
      <instancedMesh ref={canopyRef} args={[canopyGeometry, materials.canopy, treeCount]} frustumCulled={false} />
      <instancedMesh ref={roofRef} args={[roofGeometry, materials.roof, tierCount]} frustumCulled={false} />
      <instancedMesh ref={bodyRef} args={[boxGeometry, materials.body, tierCount]} frustumCulled={false} />
      <instancedMesh ref={toriiRef} args={[boxGeometry, materials.torii, toriiCount]} frustumCulled={false} />
    </>
  );
}
