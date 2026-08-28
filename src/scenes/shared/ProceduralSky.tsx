import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { AudioFeatureFrame } from '../../audio/types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';
import { getMajorEventEnvelope } from '../cyberpunkCity/world/musicEventDirector';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';

/**
 * One configurable sky covering every world: a three-stop gradient, an
 * optional celestial body (sun / moon / planet), and one of a few
 * atmospheric band modes. Written procedurally rather than sampled from
 * the reference art, so each is a real environment the camera sits inside.
 *
 * Band modes:
 *  0 none · 1 cloud shelves · 2 god rays from the celestial body
 *  3 stars + galaxy wash · 4 horizontal caustic ripple (underwater)
 */
export interface SkyConfig {
  zenith: string;
  mid: string;
  horizon: string;
  celestialColor?: string;
  /** Direction to the sun/moon/planet. */
  celestialDir?: [number, number, number];
  /** Angular radius of the disc; 0 disables it. */
  celestialSize?: number;
  celestialHalo?: number;
  bandMode?: 0 | 1 | 2 | 3 | 4;
  bandLit?: string;
  bandDark?: string;
  bandStrength?: number;
  /** Overall exposure floor — dark worlds want a lower base. */
  exposure?: number;
}

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
    uCelColor: new THREE.Color('#ffd7ea'),
    uCelDir: new THREE.Vector3(0.42, 0.3, -0.85).normalize(),
    uCelSize: 0.0035,
    uCelHalo: 1,
    uBandMode: 1,
    uBandLit: new THREE.Color('#ffb3d9'),
    uBandDark: new THREE.Color('#6b3a7a'),
    uBandStrength: 0.9,
    uExposure: 1,
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
    uniform vec3 uZenith, uMid, uHorizon, uCelColor, uCelDir, uBandLit, uBandDark;
    uniform float uCelSize, uCelHalo, uBandStrength, uExposure;
    uniform int uBandMode;
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
      vec3 col = mix(uHorizon, uMid, smoothstep(0.40, 0.60, h));
      col = mix(col, uZenith, smoothstep(0.58, 0.94, h));

      vec3 cd = normalize(uCelDir);
      float md = dot(vDir, cd);

      // --- Atmospheric bands -------------------------------------------
      if (uBandMode == 1) {
        // Cloud shelves: y compressed so noise stratifies horizontally.
        vec2 cuv = vec2(atan(vDir.z, vDir.x) * 1.6, vDir.y * 3.2);
        float drift = uTime * 0.012;
        float clouds = fbm(cuv * 1.15 + vec2(drift, 0.0)) * 0.65
                     + fbm(cuv * 2.4 + vec2(-drift * 1.7, 1.7)) * 0.35;
        float band = smoothstep(0.30, 0.85, h) * (1.0 - smoothstep(0.72, 0.99, h));
        float mask = smoothstep(0.44, 0.78, clouds) * band;
        float lit = clamp(md * 0.5 + 0.5, 0.0, 1.0);
        vec3 cc = mix(uBandDark, uBandLit, pow(lit, 1.6)) + uCelColor * pow(lit, 6.0) * 0.5;
        col = mix(col, cc, mask * uBandStrength);
      } else if (uBandMode == 2) {
        // God rays fanning out from the celestial body.
        float ang = atan(vDir.z - cd.z, vDir.x - cd.x);
        float rays = fbm(vec2(ang * 3.5, uTime * 0.05)) ;
        float cone = pow(clamp(md, 0.0, 1.0), 3.0);
        col += uBandLit * rays * cone * uBandStrength;
      } else if (uBandMode == 3) {
        // Stars plus a soft galaxy wash.
        vec2 sc = vDir.xz / max(0.12, abs(vDir.y) + 0.25);
        float star = step(0.9975, hash21(floor(sc * 220.0)));
        float twinkle = 0.6 + 0.4 * sin(uTime * 2.2 + hash21(floor(sc * 220.0)) * 40.0);
        col += vec3(1.0) * star * twinkle * 0.9;
        float galaxy = fbm(sc * 0.9 + vec2(uTime * 0.004, 0.0));
        col = mix(col, uBandLit, smoothstep(0.52, 0.9, galaxy) * uBandStrength * 0.5);
      } else if (uBandMode == 4) {
        // Underwater caustics rippling across the upper hemisphere.
        vec2 cu = vDir.xz / max(0.15, vDir.y + 0.35) * 2.2;
        float caustic = fbm(cu + vec2(uTime * 0.05, uTime * 0.03));
        caustic = pow(smoothstep(0.45, 0.85, caustic), 1.6);
        col += uBandLit * caustic * smoothstep(0.35, 1.0, h) * uBandStrength;
      }

      // --- Celestial body ----------------------------------------------
      if (uCelSize > 0.0) {
        float disc = smoothstep(1.0 - uCelSize, 1.0 - uCelSize * 0.55, md);
        float halo = pow(clamp(md, 0.0, 1.0), 90.0) * 0.9 + pow(clamp(md, 0.0, 1.0), 12.0) * 0.28;
        col = mix(col, uCelColor, disc * 0.96);
        col += uCelColor * halo * uCelHalo * (0.7 + 0.5 * uMood);
      }

      // --- Music grade ---------------------------------------------------
      col *= uExposure * (0.80 + 0.42 * uMood + uEnergy * 0.14);
      col += uBandLit * uPulse * 0.05;
      // Phase 6 Stage 7 readability pass: the sky's push toward white on a
      // major event was a big part of the "whole frame washes out" — eased
      // from 0.32 to 0.16 so it still brightens/warms noticeably but the
      // gradient and bands stay legible behind the event.
      col = mix(col, vec3(1.0, 0.96, 0.98), clamp(uEvent * 0.16, 0.0, 0.16));

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

export function ProceduralSky({
  featureFrame,
  config,
}: {
  featureFrame: AudioFeatureFrame;
  config: SkyConfig;
}) {
  const material = useMemo(() => new SkyMaterial(), []);
  const pulse = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    const u = material.uniforms;
    (u.uZenith.value as THREE.Color).set(config.zenith);
    (u.uMid.value as THREE.Color).set(config.mid);
    (u.uHorizon.value as THREE.Color).set(config.horizon);
    (u.uCelColor.value as THREE.Color).set(config.celestialColor ?? '#ffffff');
    const d = config.celestialDir ?? [0.42, 0.3, -0.85];
    (u.uCelDir.value as THREE.Vector3).set(d[0], d[1], d[2]).normalize();
    u.uCelSize.value = config.celestialSize ?? 0;
    u.uCelHalo.value = config.celestialHalo ?? 1;
    u.uBandMode.value = config.bandMode ?? 0;
    (u.uBandLit.value as THREE.Color).set(config.bandLit ?? '#ffffff');
    (u.uBandDark.value as THREE.Color).set(config.bandDark ?? '#000000');
    u.uBandStrength.value = config.bandStrength ?? 0.9;
    u.uExposure.value = config.exposure ?? 1;
  }, [material, config]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const beat = consumeBeat(featureFrame, beatState);
    if (beat > 0) pulse.current = Math.max(pulse.current, beat);
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
