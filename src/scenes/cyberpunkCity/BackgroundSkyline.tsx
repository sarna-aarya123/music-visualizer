import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';

/**
 * A much larger, much cheaper second skyline scattered in a ring well
 * outside the route's own bounding circle — simple flat silhouettes
 * blended into haze rather than lit facades. Because the route is now a
 * closed loop rather than a straight corridor, this has to surround the
 * whole loop instead of sitting behind one fixed end, so a distant skyline
 * is always visible no matter where on the circuit the camera is.
 */
const COUNT = 90;
// The route's own bounding radius can reach ~320 (see routeGenerator's
// BASE_RADIUS + jitter), plus building placement extends further still —
// keep this ring safely outside all of that.
const RING_INNER = 380;
const RING_OUTER = 620;

const SilhouetteMaterial = shaderMaterial(
  {
    uTime: 0,
    uHazeColor: new THREE.Color('#2a1c3f'),
    uDarkColor: new THREE.Color('#0a0716'),
  },
  // vertex
  /* glsl */ `
    varying vec2 vUv;
    varying float vSeed;
    attribute float aSeed;
    void main() {
      vUv = uv;
      vSeed = aSeed;
      vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // fragment
  /* glsl */ `
    uniform float uTime;
    uniform vec3 uHazeColor;
    uniform vec3 uDarkColor;
    varying vec2 vUv;
    varying float vSeed;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
    }

    void main() {
      vec3 col = mix(uDarkColor, uHazeColor, pow(vUv.y, 1.4));

      // A handful of faint distant lights — sparse and dim, just enough to
      // read as "occupied city" rather than a dead cutout.
      vec2 cell = floor(vUv * vec2(4.0, 10.0));
      float lightHash = hash(cell + vSeed * 53.0);
      float lit = step(0.988, lightHash);
      col += uHazeColor * lit * 0.9;

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function BackgroundSkyline(_props: SceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const material = useMemo(() => new SilhouetteMaterial(), []);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    return geo;
  }, []);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = RING_INNER + Math.random() * (RING_OUTER - RING_INNER);
      const width = 5 + Math.random() * 11;
      const depth = 5 + Math.random() * 11;
      const height = 14 + Math.random() * 65;

      dummy.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} />;
}
