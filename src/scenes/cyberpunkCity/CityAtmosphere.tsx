import * as THREE from 'three';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial, Stars } from '@react-three/drei';
import type { SceneProps } from '../types';
import { FOG_COLOR } from './layout';

const SkyMaterial = shaderMaterial(
  {
    uTopColor: new THREE.Color('#0a0a2a'),
    uBottomColor: new THREE.Color('#2a1440'),
    uGlowColor: new THREE.Color('#ff3fb0'),
    uMoonColor: new THREE.Color('#fff3d6'),
    uMoonDir: new THREE.Vector3(0.35, 0.45, -0.82).normalize(),
    uTime: 0,
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
    uniform vec3 uMoonColor;
    uniform vec3 uMoonDir;
    uniform float uTime;
    uniform float uEnergy;
    varying vec3 vDir;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(uBottomColor, uTopColor, pow(h, 0.6));

      // Slow drifting cloud band — cheap 2-octave value noise scrolled
      // over time, restricted to the upper sky so it reads as haze/cloud
      // rather than a texture wash.
      vec2 cloudUv = vDir.xz / max(0.15, vDir.y + 0.4) * 0.6 + vec2(uTime * 0.006, uTime * 0.003);
      float clouds = noise(cloudUv * 1.6) * 0.6 + noise(cloudUv * 3.3 + 5.0) * 0.4;
      float cloudMask = smoothstep(0.15, 0.85, h) * smoothstep(0.35, 0.7, clouds);
      col = mix(col, uTopColor * 1.3 + uGlowColor * 0.05, cloudMask * 0.35);

      // Moon — a soft emissive disc plus glow, doubling as the scene's
      // single strongest highlight for bloom to catch.
      float moonDot = dot(vDir, uMoonDir);
      float moonDisc = smoothstep(0.9975, 0.9992, moonDot);
      float moonGlow = pow(clamp(moonDot, 0.0, 1.0), 30.0) * 0.5;
      col += uMoonColor * (moonDisc * 1.4 + moonGlow);

      float horizonGlow = pow(1.0 - abs(vDir.y), 6.0);
      col += uGlowColor * horizonGlow * (0.3 + 0.4 * uEnergy);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

/** Sky dome (with moon + drifting cloud haze), starfield, fog and base
 *  lighting — the parts of the scene that set mood but aren't tied to any
 *  one audio band beyond a subtle overall energy tint on the horizon glow. */
export function CityAtmosphere({ featureFrame }: SceneProps) {
  const material = useMemo(() => new SkyMaterial(), []);

  useFrame((state) => {
    material.uniforms.uEnergy.value = featureFrame.energy;
    material.uniforms.uTime.value = state.clock.elapsedTime;
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
