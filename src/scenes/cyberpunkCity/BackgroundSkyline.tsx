import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import { CORRIDOR_Z_END } from './layout';

/**
 * A much larger, much cheaper second skyline far behind the main corridor —
 * simple flat silhouettes blended into haze rather than lit facades. This
 * is what sells "a whole city extends into the distance" instead of the
 * player just seeing a couple of rows of buildings floating in fog.
 */
const COUNT = 70;
const BAND_NEAR = -Math.abs(CORRIDOR_Z_END) - 20;
const BAND_FAR = -Math.abs(CORRIDOR_Z_END) - 140;
const BAND_HALF_WIDTH = 90;

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
      const x = (Math.random() - 0.5) * BAND_HALF_WIDTH * 2;
      const z = BAND_NEAR + (BAND_FAR - BAND_NEAR) * Math.random();
      const width = 4 + Math.random() * 9;
      const depth = 4 + Math.random() * 9;
      const height = 12 + Math.random() * 55;

      dummy.position.set(x, height / 2, z);
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
