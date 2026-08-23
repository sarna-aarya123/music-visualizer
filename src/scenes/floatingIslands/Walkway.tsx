import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { AudioFeatureFrame } from '../../audio/types';
import type { RouteData } from '../cyberpunkCity/world/routeGenerator';
import { consumeBeat, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from '../cyberpunkCity/world/musicEventDirector';
import { groundImpactState } from '../cyberpunkCity/world/groundImpactState';
import { cameraMotionState } from '../cyberpunkCity/world/cameraMotionState';
import { speedPerceptionFrac } from '../cyberpunkCity/world/musicController';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';
import { ToonSurfaceMaterial } from './ToonMaterial';

/**
 * The wooden walkway the character runs along — the reference's bridge
 * threading between islands, and the thing that makes this a world you
 * travel THROUGH rather than look at. Built as a ribbon that follows the
 * route exactly (same technique as the other environments' ground), with
 * plank banding in the shader and instanced railing posts along both
 * edges.
 */

const RIBBON_SAMPLES = 300;
const RAIL_HEIGHT = 1.05;
const POST_EVERY = 6;

const DeckMaterial = shaderMaterial(
  {
    uEnergy: 0,
    uMood: 0,
    uImpactCenter: new THREE.Vector3(),
    uImpactAge: 999,
    uImpactStrength: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#c489b5'),
    // Warm, saturated, high-key timber. The previous dark browns went
    // muddy the moment shading and fog were applied.
    uWoodA: new THREE.Color('#d9955f'),
    uWoodB: new THREE.Color('#b06f45'),
    uGlow: new THREE.Color('#ffd08a'),
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
    uniform float uEnergy, uMood, uImpactAge, uImpactStrength;
    uniform vec3 uImpactCenter, uCameraPos, uFogColor, uWoodA, uWoodB, uGlow;
    varying float vAlong;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    float hash(float x){ return fract(sin(x * 91.3458) * 47453.5453); }
    void main() {
      // Plank banding across the direction of travel.
      // Crisp plank banding with a hard dark seam — a drawn line between
      // boards, not a soft gradient.
      float plankId = floor(vAlong * 520.0);
      float plank = fract(vAlong * 520.0);
      float seam = step(0.055, plank) * step(plank, 0.945);
      vec3 col = mix(uWoodB, uWoodA, hash(plankId));
      col = mix(col * 0.62, col, seam);
      // A single hard edge band rather than a smooth vignette.
      float edge = min(vUv.x, 1.0 - vUv.x);
      col = mix(col * 0.72, col, step(0.07, edge));
      // Kept high-key: mood lifts it, but it never drops into mud.
      col *= 0.92 + 0.26 * uMood + uEnergy * 0.10;

      // Impact ripple from beats / landings, same language as the other
      // environments' ground.
      float ring = uImpactAge * 22.0;
      float dist = distance(vWorldPos, uImpactCenter);
      float band = 1.0 - smoothstep(0.0, 2.4, abs(dist - ring));
      float fade = clamp(1.0 - uImpactAge / 0.55, 0.0, 1.0);
      col += uGlow * band * fade * uImpactStrength * 1.6;

      float d = length(uCameraPos - vWorldPos);
      col = mix(col, uFogColor, smoothstep(90.0, 340.0, d));
      gl_FragColor = vec4(col, 1.0);
    }
  `
);

function buildDeck(route: RouteData<string>, samples: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], along: number[] = [], idx: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i % samples) / samples;
    const f = route.getFrameAt(t);
    const { corridorRadius } = route.getDistrictInfoAt(t);
    const half = Math.min(corridorRadius, 2.6);
    const l = f.position.clone().addScaledVector(f.right, -half);
    const r = f.position.clone().addScaledVector(f.right, half);
    pos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    uv.push(0, 0, 1, 0);
    along.push(i / samples, i / samples);
    if (i < samples) {
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

const postGeometry = new THREE.BoxGeometry(1, 1, 1);

export function Walkway({
  featureFrame,
  route,
}: {
  featureFrame: AudioFeatureFrame;
  route: RouteData<string>;
}) {
  const deckMaterial = useMemo(() => new DeckMaterial(), []);
  const postRef = useRef<THREE.InstancedMesh>(null!);
  const railRef = useRef<THREE.InstancedMesh>(null!);

  const deckGeometry = useMemo(() => buildDeck(route, RIBBON_SAMPLES), [route]);

  const posts = useMemo(() => {
    const list: { p: THREE.Vector3; rotY: number; isRail: boolean; len: number }[] = [];
    for (let i = 0; i < RIBBON_SAMPLES; i += POST_EVERY) {
      const t = i / RIBBON_SAMPLES;
      const f = route.getFrameAt(t);
      const { corridorRadius } = route.getDistrictInfoAt(t);
      const half = Math.min(corridorRadius, 2.6);
      const rotY = Math.atan2(f.tangent.x, f.tangent.z);
      for (const side of [-1, 1] as const) {
        list.push({
          p: f.position.clone().addScaledVector(f.right, side * half).addScaledVector(f.up, RAIL_HEIGHT / 2),
          rotY,
          isRail: false,
          len: RAIL_HEIGHT,
        });
        // Horizontal rail segment spanning to the next post.
        const t2 = (i + POST_EVERY) / RIBBON_SAMPLES;
        const f2 = route.getFrameAt(((t2 % 1) + 1) % 1);
        const half2 = Math.min(route.getDistrictInfoAt(((t2 % 1) + 1) % 1).corridorRadius, 2.6);
        const a = f.position.clone().addScaledVector(f.right, side * half).addScaledVector(f.up, RAIL_HEIGHT);
        const b = f2.position.clone().addScaledVector(f2.right, side * half2).addScaledVector(f2.up, RAIL_HEIGHT);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        list.push({ p: mid, rotY: Math.atan2(b.x - a.x, b.z - a.z), isRail: true, len: a.distanceTo(b) });
      }
    }
    return list;
  }, [route]);

  // Railings sit closest to the camera of anything in the world, so they
  // get the same cel treatment — a dark realistic wood here was a large
  // part of what made the frame look muddy.
  const woodMaterial = useMemo(() => {
    const m = new ToonSurfaceMaterial();
    (m.uniforms.uColor.value as THREE.Color).set('#c88250');
    (m.uniforms.uShadowTint.value as THREE.Color).set('#6b3a6e');
    (m.uniforms.uRimColor.value as THREE.Color).set('#ffe0c0');
    m.uniforms.uRimStrength.value = 0.5;
    return m;
  }, []);

  const beatState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;
  const landState = useRef(createBeatConsumerState()).current;
  const impactStart = useRef(-999);
  const impactStrength = useRef(0);
  const impactCenter = useRef(new THREE.Vector3());

  useEffect(
    () => () => {
      deckGeometry.dispose();
      deckMaterial.dispose();
      woodMaterial.dispose();
    },
    [deckGeometry, deckMaterial, woodMaterial]
  );

  useEffect(() => {
    const d = new THREE.Object3D();
    let pi = 0, ri = 0;
    posts.forEach((item) => {
      d.position.copy(item.p);
      d.rotation.set(0, item.rotY, 0);
      if (item.isRail) {
        d.scale.set(0.14, 0.16, item.len);
        d.updateMatrix();
        railRef.current.setMatrixAt(ri++, d.matrix);
      } else {
        d.scale.set(0.2, item.len, 0.2);
        d.updateMatrix();
        postRef.current.setMatrixAt(pi++, d.matrix);
      }
    });
    postRef.current.instanceMatrix.needsUpdate = true;
    railRef.current.instanceMatrix.needsUpdate = true;
  }, [posts]);

  const postCount = useMemo(() => posts.filter((p) => !p.isRail).length, [posts]);
  const railCount = useMemo(() => posts.filter((p) => p.isRail).length, [posts]);

  useFrame((state, rawDelta) => {
    const t = state.clock.elapsedTime;
    const dt = Math.min(rawDelta, 0.05);
    const cam = state.camera.position;

    const beat = consumeBeat(featureFrame, beatState);
    if (beat > 0) { impactStart.current = t; impactStrength.current = beat; impactCenter.current.copy(cam); }
    const major = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (major > 0) { impactStart.current = t; impactStrength.current = 3.2 + major * 2.2; impactCenter.current.copy(cam); }
    const land = consumeEvent(groundImpactState.id, groundImpactState.strength, landState);
    if (land > 0) { impactStart.current = t; impactStrength.current = land; impactCenter.current.copy(groundImpactState.position); }

    const u = deckMaterial.uniforms;
    u.uEnergy.value = featureFrame.energy;
    u.uMood.value = featureFrame.sectionMood;
    u.uImpactAge.value = t - impactStart.current;
    u.uImpactStrength.value = impactStrength.current;
    (u.uImpactCenter.value as THREE.Vector3).copy(impactCenter.current);
    (u.uCameraPos.value as THREE.Vector3).copy(cam);
    (woodMaterial.uniforms.uCameraPos.value as THREE.Vector3).copy(cam);
    // Referenced so travel speed and rhythm stay wired into this
    // environment the same way they are elsewhere.
    void speedPerceptionFrac(cameraMotionState.speed);
    void rhythmState.drumPresence;
    void dt;
  });

  return (
    <>
      <mesh geometry={deckGeometry}>
        <primitive object={deckMaterial} attach="material" side={THREE.DoubleSide} />
      </mesh>
      <instancedMesh ref={postRef} args={[postGeometry, woodMaterial, Math.max(1, postCount)]} frustumCulled={false} />
      <instancedMesh ref={railRef} args={[postGeometry, woodMaterial, Math.max(1, railCount)]} frustumCulled={false} />
    </>
  );
}
