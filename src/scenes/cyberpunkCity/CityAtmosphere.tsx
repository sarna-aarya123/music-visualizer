import * as THREE from 'three';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial, Stars } from '@react-three/drei';
import type { SceneProps } from '../types';

const SkyMaterial = shaderMaterial(
  {
    uTopColor: new THREE.Color('#0a0a2a'),
    uBottomColor: new THREE.Color('#2a1440'),
    uGlowColor: new THREE.Color('#ff3fb0'),
    uEnergy: 0,
  },
  // vertex
  /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  // fragment
  /* glsl */ `
    uniform vec3 uTopColor;
    uniform vec3 uBottomColor;
    uniform vec3 uGlowColor;
    uniform float uEnergy;
    varying vec3 vDir;

    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uBottomColor, uTopColor, pow(h, 0.6));
      float horizonGlow = pow(1.0 - abs(vDir.y), 6.0);
      col += uGlowColor * horizonGlow * (0.3 + 0.4 * uEnergy);
      gl_FragColor = vec4(col, 1.0);
    }
  `
);

const FOG_COLOR = '#05030c';

/** Sky dome, starfield, fog and base lighting — the parts of the scene that
 *  set mood but aren't tied to any one audio band beyond a subtle overall
 *  energy tint on the horizon glow. */
export function CityAtmosphere({ featureFrame }: SceneProps) {
  const material = useMemo(() => new SkyMaterial(), []);

  useFrame(() => {
    material.uniforms.uEnergy.value = featureFrame.energy;
  });

  return (
    <>
      <fog attach="fog" args={[FOG_COLOR, 20, 150]} />
      <ambientLight intensity={0.35} color="#3a2a6b" />
      <directionalLight position={[20, 30, -10]} intensity={0.35} color="#8fd8ff" />

      <mesh scale={280}>
        <sphereGeometry args={[1, 32, 32]} />
        <primitive object={material} attach="material" side={THREE.BackSide} />
      </mesh>

      <Stars radius={250} depth={60} count={3000} factor={4} saturation={0} fade speed={0.4} />
    </>
  );
}
