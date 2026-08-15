import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';

const RIPPLE_SPEED = 22; // world units/sec the impact ring expands at
const RIPPLE_LIFETIME = 1.1; // seconds before a ripple fully fades

const GroundMaterial = shaderMaterial(
  {
    uBass: 0,
    uEnergy: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#05030c'),
    uBaseColor: new THREE.Color('#07061a'),
    uLineColor: new THREE.Color('#7ef9ff'),
    uImpactCenter: new THREE.Vector2(0, 0),
    uImpactAge: 999,
    uImpactStrength: 0,
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
    uniform vec2 uImpactCenter;
    uniform float uImpactAge;
    uniform float uImpactStrength;
    varying vec3 vWorldPos;

    void main() {
      vec2 grid = abs(fract(vWorldPos.xz * 0.08) - 0.5);
      float lineDist = min(grid.x, grid.y);
      float line = 1.0 - smoothstep(0.0, 0.03 + uBass * 0.015, lineDist);

      vec3 col = mix(uBaseColor, uLineColor, line * (0.55 + 0.45 * uEnergy));

      float roadGlow = smoothstep(9.0, 0.0, abs(vWorldPos.x)) * 0.12;
      col += uLineColor * roadGlow;

      // Beat impact: a bright ring expanding outward from under the camera,
      // fading with both distance-from-front and age.
      float ringRadius = uImpactAge * ${RIPPLE_SPEED.toFixed(1)};
      float distToImpact = distance(vWorldPos.xz, uImpactCenter);
      float ringBand = 1.0 - smoothstep(0.0, 2.2, abs(distToImpact - ringRadius));
      float ringFade = clamp(1.0 - uImpactAge / ${RIPPLE_LIFETIME.toFixed(2)}, 0.0, 1.0);
      col += uLineColor * ringBand * ringFade * uImpactStrength * 1.4;

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(20.0, 130.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function Ground({ featureFrame }: SceneProps) {
  const material = useMemo(() => new GroundMaterial(), []);
  const beatState = useRef(createBeatConsumerState()).current;
  const impactStartTime = useRef(-999);
  const impactStrength = useRef(0);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Every detected beat starts a brand new ripple, guaranteed — this is
    // the "ground impact" reaction from the beat-interaction spec.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) {
      impactStartTime.current = t;
      impactStrength.current = beatHit;
      (material.uniforms.uImpactCenter.value as THREE.Vector2).set(
        state.camera.position.x,
        state.camera.position.z
      );
    }

    const u = material.uniforms;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uImpactAge.value = t - impactStartTime.current;
    u.uImpactStrength.value = impactStrength.current;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -70]}>
      <planeGeometry args={[400, 400, 1, 1]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
