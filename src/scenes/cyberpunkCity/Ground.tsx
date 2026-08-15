import * as THREE from 'three';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';

const GroundMaterial = shaderMaterial(
  {
    uBass: 0,
    uEnergy: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#05030c'),
    uBaseColor: new THREE.Color('#07061a'),
    uLineColor: new THREE.Color('#7ef9ff'),
  },
  // vertex
  /* glsl */ `
    varying vec3 vWorldPos;
    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // fragment
  /* glsl */ `
    uniform float uBass;
    uniform float uEnergy;
    uniform vec3 uCameraPos;
    uniform vec3 uFogColor;
    uniform vec3 uBaseColor;
    uniform vec3 uLineColor;
    varying vec3 vWorldPos;

    void main() {
      vec2 grid = abs(fract(vWorldPos.xz * 0.08) - 0.5);
      float lineDist = min(grid.x, grid.y);
      float line = 1.0 - smoothstep(0.0, 0.03 + uBass * 0.015, lineDist);

      vec3 col = mix(uBaseColor, uLineColor, line * (0.55 + 0.45 * uEnergy));

      float roadGlow = smoothstep(9.0, 0.0, abs(vWorldPos.x)) * 0.12;
      col += uLineColor * roadGlow;

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(20.0, 130.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function Ground({ featureFrame }: SceneProps) {
  const material = useMemo(() => new GroundMaterial(), []);

  useFrame((state) => {
    const u = material.uniforms;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -40]}>
      <planeGeometry args={[400, 400, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
