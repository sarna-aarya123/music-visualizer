import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { AudioFeatureFrame } from '../../audio/types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';
import { getMajorEventEnvelope } from '../cyberpunkCity/world/musicEventDirector';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';

export const ISLAND_FOG_COLOR = '#b06a9e';

/**
 * The sky is what makes this world read as the reference panel: a deep
 * violet zenith falling to hot magenta and warm cream at the horizon, a
 * very large pale-pink moon, and thick banded cloud masses lit from
 * below. Drawn procedurally rather than sampled from the reference image,
 * so it's a real environment the camera lives inside.
 */
const SkyMaterial = shaderMaterial(
  {
    uTime: 0,
    uEnergy: 0,
    uMood: 0,
    uPulse: 0,
    uEvent: 0,
    uZenith: new THREE.Color('#3a1f6e'),
    uMid: new THREE.Color('#c850a4'),
    uHorizon: new THREE.Color('#ffd9a8'),
    uMoonColor: new THREE.Color('#ffd7ea'),
    uCloudLit: new THREE.Color('#ffb3d9'),
    uCloudDark: new THREE.Color('#6b3a7a'),
    uMoonDir: new THREE.Vector3(0.42, 0.30, -0.85).normalize(),
  },
  /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  /* glsl */ `
    uniform float uTime, uEnergy, uMood, uPulse, uEvent;
    uniform vec3 uZenith, uMid, uHorizon, uMoonColor, uCloudLit, uCloudDark, uMoonDir;
    varying vec3 vDir;

    float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float noise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p){
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
      return v;
    }

    void main() {
      float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);

      // Three-stop vertical gradient: cream horizon -> magenta -> violet.
      vec3 col = mix(uHorizon, uMid, smoothstep(0.42, 0.60, h));
      col = mix(col, uZenith, smoothstep(0.58, 0.92, h));

      // The moon: a large soft disc with a wide halo, sitting above the
      // horizon so it backlights the cloud banks.
      float md = dot(vDir, normalize(uMoonDir));
      float disc = smoothstep(0.9955, 0.9975, md);
      float halo = pow(clamp(md, 0.0, 1.0), 90.0) * 0.9 + pow(clamp(md, 0.0, 1.0), 12.0) * 0.28;
      col = mix(col, uMoonColor, disc * 0.96);
      col += uMoonColor * halo * (0.7 + 0.5 * uMood);

      // Banded cloud masses. Compressing y stretches the noise into
      // horizontal strata, which is what gives the reference's stacked
      // cloud-shelf look instead of generic fog.
      vec2 cuv = vec2(atan(vDir.z, vDir.x) * 1.6, vDir.y * 3.2);
      float drift = uTime * 0.012;
      float c1 = fbm(cuv * 1.15 + vec2(drift, 0.0));
      float c2 = fbm(cuv * 2.4 + vec2(-drift * 1.7, 1.7));
      float clouds = c1 * 0.65 + c2 * 0.35;
      float band = smoothstep(0.30, 0.85, h) * (1.0 - smoothstep(0.72, 0.98, h));
      float mask = smoothstep(0.44, 0.78, clouds) * band;

      // Lit from the moon side, dark on the away side.
      float lit = clamp(dot(normalize(vDir), normalize(uMoonDir)) * 0.5 + 0.5, 0.0, 1.0);
      vec3 cloudCol = mix(uCloudDark, uCloudLit, pow(lit, 1.6));
      cloudCol += uMoonColor * pow(lit, 6.0) * 0.5;
      col = mix(col, cloudCol, mask * 0.9);

      // Music: mood sets overall exposure, beats lift it briefly, a major
      // event blows the whole sky toward warm white.
      col *= 0.80 + 0.42 * uMood + uEnergy * 0.14;
      col += uCloudLit * uPulse * 0.05;
      col = mix(col, vec3(1.0, 0.94, 0.98), clamp(uEvent * 0.35, 0.0, 0.35));

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function IslandSky({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const material = useMemo(() => new SkyMaterial(), []);
  const pulse = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;

  useEffect(() => () => material.dispose(), [material]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) pulse.current = Math.max(pulse.current, beatHit);
    pulse.current *= Math.exp(-dt * 6);

    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uEnergy.value = featureFrame.energy;
    u.uMood.value = featureFrame.sectionMood;
    u.uPulse.value = pulse.current + rhythmState.drumPresence * 0.15;
    u.uEvent.value = getMajorEventEnvelope();
  });

  return (
    <mesh scale={600} frustumCulled={false}>
      <sphereGeometry args={[1, 40, 28]} />
      <primitive object={material} attach="material" side={THREE.BackSide} depthWrite={false} />
    </mesh>
  );
}
