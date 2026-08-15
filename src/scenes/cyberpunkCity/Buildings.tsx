import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';

const ROWS = 7;
const PER_ROW = 9;
const STREET_HALF_WIDTH = 7;
const ROW_SPACING = 13;
const COUNT = ROWS * PER_ROW * 2;

const BuildingMaterial = shaderMaterial(
  {
    uTime: 0,
    uBass: 0,
    uEnergy: 0,
    uHigh: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#05030c'),
    uColorBase: new THREE.Color('#0b0a1f'),
    uColorWindow: new THREE.Color('#7ef9ff'),
  },
  // vertex
  /* glsl */ `
    attribute float aSeed;
    varying vec2 vUv;
    varying float vSeed;
    varying vec3 vWorldPos;
    uniform float uBass;

    void main() {
      vUv = uv;
      vSeed = aSeed;
      vec3 pos = position;
      // Subtle global "breathing" on bass rather than per-instance CPU work.
      pos.y *= 1.0 + uBass * 0.02;
      vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // fragment
  /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uHigh;
    uniform vec3 uCameraPos;
    uniform vec3 uFogColor;
    uniform vec3 uColorBase;
    uniform vec3 uColorWindow;
    varying vec2 vUv;
    varying float vSeed;
    varying vec3 vWorldPos;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
    }

    void main() {
      vec2 grid = vec2(8.0, 22.0);
      vec2 cellF = vUv * grid;
      vec2 cell = floor(cellF);
      vec2 cellUv = fract(cellF);

      // Thin dark mullions between windows so lit cells read as small
      // rectangles rather than a solid checkerboard.
      float pane = step(0.12, cellUv.x) * step(0.12, cellUv.y);

      float base = hash(cell + vSeed * 97.0);
      float lit = step(0.86, base) * pane;

      float flickerSeed = hash(cell + vSeed * 13.0 + floor(uTime * 3.0));
      float flicker = step(0.994, flickerSeed) * uHigh * pane;
      float glow = clamp(lit + flicker, 0.0, 1.0);

      vec3 shade = uColorBase * (0.35 + 0.5 * vUv.y);
      vec3 windowColor = mix(uColorWindow, vec3(1.0, 0.55, 0.75), fract(vSeed * 3.7));
      vec3 col = mix(shade, windowColor, glow * (0.7 + 0.5 * uEnergy));

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(30.0, 120.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function Buildings({ featureFrame }: SceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    return geo;
  }, []);

  const material = useMemo(() => new BuildingMaterial(), []);

  // Lay out the skyline once on mount: two rows of buildings receding into
  // the distance on either side of a central street.
  useEffect(() => {
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let row = 0; row < ROWS; row++) {
      const z = -row * ROW_SPACING - 10;
      for (const side of [-1, 1]) {
        for (let n = 0; n < PER_ROW; n++) {
          const width = 2 + Math.random() * 3;
          const depth = 2 + Math.random() * 3;
          const heightBase = 4 + Math.random() * 10;
          const height = heightBase * (1 + row * 0.22);
          const x = side * (STREET_HALF_WIDTH + n * 3.2 + Math.random() * 1.4);

          dummy.position.set(x, height / 2, z - Math.random() * 4);
          dummy.scale.set(width, height, depth);
          dummy.updateMatrix();
          meshRef.current.setMatrixAt(i, dummy.matrix);
          i++;
        }
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, []);

  useFrame((state) => {
    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uHigh.value = featureFrame.high;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} />;
}
