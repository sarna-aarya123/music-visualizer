import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { AudioFeatureFrame } from '../../audio/types';
import type { RouteData } from '../cyberpunkCity/world/routeGenerator';
import { consumeBeat, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from '../cyberpunkCity/world/musicEventDirector';
import { groundImpactState } from '../cyberpunkCity/world/groundImpactState';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';
import { OutlinedInstances } from '../shared/OutlinedInstances';
import { makeToon, makeOutline } from '../shared/toon';
import type { PathConfig } from './types';

/** The traversable ribbon every world runs along, in three surface styles
 *  (planks / smooth / glowing grid) with a shared impact ripple so beats
 *  and jump landings read on the ground in every environment. */
const PathMaterial = shaderMaterial(
  {
    uEnergy: 0,
    uMood: 0,
    uDrums: 0,
    uStyle: 0,
    uColorA: new THREE.Color('#d9955f'),
    uColorB: new THREE.Color('#b06f45'),
    uGlow: new THREE.Color('#ffd08a'),
    uImpactCenter: new THREE.Vector3(),
    uImpactAge: 999,
    uImpactStrength: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#c489b5'),
    uFogNear: 90,
    uFogFar: 340,
    uTime: 0,
  },
  /* glsl */ `
    attribute float aAlong;
    varying float vAlong;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vAlong = aAlong; vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  /* glsl */ `
    uniform float uEnergy, uMood, uDrums, uImpactAge, uImpactStrength, uFogNear, uFogFar, uTime;
    uniform int uStyle;
    uniform vec3 uColorA, uColorB, uGlow, uImpactCenter, uCameraPos, uFogColor;
    varying float vAlong;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    float hash(float x){ return fract(sin(x * 91.3458) * 47453.5453); }

    void main() {
      vec3 col;
      if (uStyle == 0) {
        // Planks: hard seams between boards.
        float id = floor(vAlong * 520.0);
        float p = fract(vAlong * 520.0);
        float seam = step(0.055, p) * step(p, 0.945);
        col = mix(uColorB, uColorA, hash(id));
        col = mix(col * 0.62, col, seam);
        float edge = min(vUv.x, 1.0 - vUv.x);
        col = mix(col * 0.72, col, step(0.07, edge));
      } else if (uStyle == 1) {
        // Smooth surface with a subtle banded variation so it isn't dead
        // flat, plus darker edges for thickness.
        float band = hash(floor(vAlong * 160.0));
        col = mix(uColorB, uColorA, 0.35 + band * 0.5);
        float edge = min(vUv.x, 1.0 - vUv.x);
        col = mix(col * 0.7, col, smoothstep(0.0, 0.12, edge));
      } else {
        // Glowing grid: dark base with bright lines racing along it.
        // Stage 8 brightness pass: the additive grid term used to reach
        // ~uColorA * 3.8 at a grid intersection with a bright cyan/magenta
        // uColorA — far past 1.0 across the whole near field, which bloom
        // then turned into a solid glowing slab. Clamped so the lines stay
        // bright lines on a dark deck, not a light source.
        float lineAlong = smoothstep(0.02, 0.0, abs(fract(vAlong * 220.0) - 0.5) - 0.46);
        float lineAcross = smoothstep(0.03, 0.0, abs(vUv.x - 0.5) - 0.44);
        col = uColorB;
        float travel = fract(vAlong * 60.0 - uTime * (0.3 + uDrums * 1.4));
        float pulse = smoothstep(0.85, 1.0, travel);
        float grid = min((lineAlong + lineAcross) * (0.4 + pulse * 0.5), 0.7);
        col += uColorA * grid;
      }
      col *= 0.92 + 0.26 * uMood + uEnergy * 0.10;

      float ring = uImpactAge * 22.0;
      float d2 = distance(vWorldPos, uImpactCenter);
      float band2 = 1.0 - smoothstep(0.0, 2.4, abs(d2 - ring));
      float fade = clamp(1.0 - uImpactAge / 0.55, 0.0, 1.0);
      col += uGlow * band2 * fade * uImpactStrength * 1.6;

      float d = length(uCameraPos - vWorldPos);
      col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, d));
      gl_FragColor = vec4(col, 1.0);
    }
  `
);

const SAMPLES = 300;
const RAIL_HEIGHT = 1.05;
const POST_EVERY = 6;
const postGeometry = new THREE.BoxGeometry(1, 1, 1);

function halfAt(route: RouteData<string>, t: number, cap: number) {
  return Math.min(route.getDistrictInfoAt(t).corridorRadius, cap);
}

function buildDeck(route: RouteData<string>, cap: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], along: number[] = [], idx: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i % SAMPLES) / SAMPLES;
    const f = route.getFrameAt(t);
    const half = halfAt(route, t, cap);
    const l = f.position.clone().addScaledVector(f.right, -half);
    const r = f.position.clone().addScaledVector(f.right, half);
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    uv.push(0, 0, 1, 0);
    along.push(i / SAMPLES, i / SAMPLES);
    if (i < SAMPLES) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function WorldPath({
  featureFrame,
  route,
  config,
  fog,
  outlineCfg,
}: {
  featureFrame: AudioFeatureFrame;
  route: RouteData<string>;
  config: PathConfig;
  fog: { color: string; near: number; far: number };
  outlineCfg: { width: number; color: string };
}) {
  const material = useMemo(() => new PathMaterial(), []);
  const deck = useMemo(() => buildDeck(route, config.halfWidth), [route, config.halfWidth]);

  const railMat = useMemo(
    () => (config.railings ? makeToon(config.railToon ?? { color: '#c88250', shadow: '#6b3a6e', rim: '#ffe0c0' }, fog) : null),
    [config.railings, config.railToon, fog]
  );
  const railOutline = useMemo(
    () => (config.railings ? makeOutline(outlineCfg.width * 0.5, outlineCfg.color) : null),
    [config.railings, outlineCfg]
  );

  const railMatrices = useMemo(() => {
    if (!config.railings) return [];
    const out: THREE.Matrix4[] = [];
    const d = new THREE.Object3D();
    for (let i = 0; i < SAMPLES; i += POST_EVERY) {
      const t = i / SAMPLES;
      const f = route.getFrameAt(t);
      const half = halfAt(route, t, config.halfWidth);
      const rotY = Math.atan2(f.tangent.x, f.tangent.z);
      const t2 = ((i + POST_EVERY) / SAMPLES) % 1;
      const f2 = route.getFrameAt(t2);
      const half2 = halfAt(route, t2, config.halfWidth);
      for (const side of [-1, 1] as const) {
        d.position.copy(f.position).addScaledVector(f.right, side * half).addScaledVector(f.up, RAIL_HEIGHT / 2);
        d.rotation.set(0, rotY, 0);
        d.scale.set(0.2, RAIL_HEIGHT, 0.2);
        d.updateMatrix();
        out.push(d.matrix.clone());

        const a = f.position.clone().addScaledVector(f.right, side * half).addScaledVector(f.up, RAIL_HEIGHT);
        const b = f2.position.clone().addScaledVector(f2.right, side * half2).addScaledVector(f2.up, RAIL_HEIGHT);
        d.position.copy(a).add(b).multiplyScalar(0.5);
        d.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
        d.scale.set(0.14, 0.16, a.distanceTo(b));
        d.updateMatrix();
        out.push(d.matrix.clone());
      }
    }
    return out;
  }, [route, config.railings, config.halfWidth]);

  const beatState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;
  const landState = useRef(createBeatConsumerState()).current;
  const impactStart = useRef(-999);
  const impactStrength = useRef(0);
  const impactCenter = useRef(new THREE.Vector3());

  useEffect(() => {
    const u = material.uniforms;
    (u.uColorA.value as THREE.Color).set(config.colorA);
    (u.uColorB.value as THREE.Color).set(config.colorB);
    (u.uGlow.value as THREE.Color).set(config.glow);
    u.uStyle.value = config.style;
    (u.uFogColor.value as THREE.Color).set(fog.color);
    u.uFogNear.value = fog.near;
    u.uFogFar.value = fog.far;
  }, [material, config, fog]);

  useEffect(
    () => () => {
      deck.dispose();
      material.dispose();
      railMat?.dispose();
      railOutline?.dispose();
    },
    [deck, material, railMat, railOutline]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;

    const beat = consumeBeat(featureFrame, beatState);
    if (beat > 0) { impactStart.current = t; impactStrength.current = beat; impactCenter.current.copy(cam); }
    // Phase 6 Stage 7 readability pass: major-event ground ripple eased
    // back (was 3.2 + major*2.2) so the sweeping glow band reads as a
    // strong pulse rather than a blinding wall of light across the deck.
    const major = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (major > 0) { impactStart.current = t; impactStrength.current = 2.0 + major * 1.3; impactCenter.current.copy(cam); }
    const land = consumeEvent(groundImpactState.id, groundImpactState.strength, landState);
    if (land > 0) { impactStart.current = t; impactStrength.current = land; impactCenter.current.copy(groundImpactState.position); }

    const u = material.uniforms;
    u.uTime.value = t;
    u.uEnergy.value = featureFrame.energy;
    u.uMood.value = featureFrame.sectionMood;
    u.uDrums.value = rhythmState.drumPresence;
    u.uImpactAge.value = t - impactStart.current;
    u.uImpactStrength.value = impactStrength.current;
    (u.uImpactCenter.value as THREE.Vector3).copy(impactCenter.current);
    (u.uCameraPos.value as THREE.Vector3).copy(cam);
  });

  return (
    <>
      <mesh geometry={deck}>
        <primitive object={material} attach="material" side={THREE.DoubleSide} />
      </mesh>
      {railMat && railOutline && (
        <OutlinedInstances geometry={postGeometry} material={railMat} outline={railOutline} matrices={railMatrices} />
      )}
    </>
  );
}
