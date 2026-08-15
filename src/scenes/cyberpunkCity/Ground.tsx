import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';

const RIPPLE_SPEED = 22; // world units/sec the impact ring expands at
const RIPPLE_LIFETIME = 1.1; // seconds before a ripple fully fades

const RIBBON_SAMPLES = 260;

const GroundMaterial = shaderMaterial(
  {
    uBass: 0,
    uEnergy: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#05030c'),
    uBaseColor: new THREE.Color('#07061a'),
    uLineColor: new THREE.Color('#7ef9ff'),
    uImpactCenter: new THREE.Vector3(0, 0, 0),
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
    uniform vec3 uImpactCenter;
    uniform float uImpactAge;
    uniform float uImpactStrength;
    varying vec3 vWorldPos;

    void main() {
      vec2 grid = abs(fract(vWorldPos.xz * 0.08) - 0.5);
      float lineDist = min(grid.x, grid.y);
      float line = 1.0 - smoothstep(0.0, 0.03 + uBass * 0.015, lineDist);

      vec3 col = mix(uBaseColor, uLineColor, line * (0.55 + 0.45 * uEnergy));

      // Beat impact: a bright ring expanding outward from under the camera
      // (in full 3D so it still reads correctly on elevated/sloped route
      // sections), fading with both distance and age.
      float ringRadius = uImpactAge * ${RIPPLE_SPEED.toFixed(1)};
      float distToImpact = distance(vWorldPos, uImpactCenter);
      float ringBand = 1.0 - smoothstep(0.0, 2.2, abs(distToImpact - ringRadius));
      float ringFade = clamp(1.0 - uImpactAge / ${RIPPLE_LIFETIME.toFixed(2)}, 0.0, 1.0);
      col += uLineColor * ringBand * ringFade * uImpactStrength * 2.4;

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(20.0, 130.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function Ground({ featureFrame, route }: SceneProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const material = useMemo(() => new GroundMaterial(), []);
  const beatState = useRef(createBeatConsumerState()).current;
  const impactStartTime = useRef(-999);
  const impactStrength = useRef(0);

  // A ribbon that follows the route's centerline, width, and elevation —
  // built once from the deterministic route so the ground can never
  // disagree with where the camera (or the buildings) actually are.
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= RIBBON_SAMPLES; i++) {
      const t = (i % RIBBON_SAMPLES) / RIBBON_SAMPLES;
      const frame = route.getFrameAt(t);
      const { corridorRadius } = route.getDistrictInfoAt(t);
      const left = frame.position.clone().addScaledVector(frame.right, -corridorRadius);
      const right = frame.position.clone().addScaledVector(frame.right, corridorRadius);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      if (i < RIBBON_SAMPLES) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = i * 2 + 2;
        const d = i * 2 + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [route]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Every detected beat starts a brand new ripple, guaranteed — this is
    // the "ground impact" reaction from the beat-interaction spec.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) {
      impactStartTime.current = t;
      impactStrength.current = beatHit;
      (material.uniforms.uImpactCenter.value as THREE.Vector3).copy(state.camera.position);
    }

    const u = material.uniforms;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uImpactAge.value = t - impactStartTime.current;
    u.uImpactStrength.value = impactStrength.current;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      {/* DoubleSide: the ribbon's winding direction depends on the route's
          local curvature/right-vector, which flips sign around the loop —
          simpler and cheap (it's one thin strip) to just always draw both
          faces than to hand-derive consistent winding for every segment. */}
      <primitive object={material} attach="material" side={THREE.DoubleSide} />
    </mesh>
  );
}
