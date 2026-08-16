import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import { consumeBeat, consumeSnareHit, consumeSpectralShift, createBeatConsumerState } from '../../audio/beatConsumer';
import { getMajorEventEnvelope } from './world/musicEventDirector';

// ---------------------------------------------------------------------------
// Rendering only — placement now comes entirely from world/worldGenerator.ts,
// which builds every building/landmark relative to the route so it can
// never overlap the camera's guaranteed-clear corridor. This file just
// turns that layout into instanced meshes and owns the stylized facade
// material.
// ---------------------------------------------------------------------------

const BuildingMaterial = shaderMaterial(
  {
    uTime: 0,
    uBass: 0,
    uEnergy: 0,
    uHigh: 0,
    uPulse: 0,
    uCameraPos: new THREE.Vector3(),
    uLightDir: new THREE.Vector3(20, 30, -10).normalize(),
    uFogColor: new THREE.Color('#05030c'),
    uColorBase: new THREE.Color('#0a0e24'),
    uColorWindow: new THREE.Color('#ffb35c'),
    uColorAccent: new THREE.Color('#7ef2ff'),
    // District color families (see worldGenerator's DISTRICT_HUES): warm
    // rust/orange for industrial areas, vivid magenta for canyon/plaza —
    // a handful of recognizable moods rather than one palette everywhere.
    uColorWarm: new THREE.Color('#ff8a3c'),
    uColorVivid: new THREE.Color('#ff3fc8'),
  },
  // vertex
  /* glsl */ `
    attribute float aSeed;
    attribute float aHue;
    varying vec2 vUv;
    varying float vSeed;
    varying float vHue;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    uniform float uBass;

    void main() {
      vUv = uv;
      vSeed = aSeed;
      vHue = aHue;
      vec3 pos = position;
      // Global "breathing" on bass — big enough to actually read as the
      // world pulsing with the music, not a barely-perceptible wobble.
      pos.y *= 1.0 + uBass * 0.045;
      vec4 worldPos = modelMatrix * instanceMatrix * vec4(pos, 1.0);
      vWorldPos = worldPos.xyz;
      vNormalW = normalize(mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  // fragment
  /* glsl */ `
    uniform float uTime;
    uniform float uEnergy;
    uniform float uHigh;
    uniform float uPulse;
    uniform float uBass;
    uniform vec3 uCameraPos;
    uniform vec3 uLightDir;
    uniform vec3 uFogColor;
    uniform vec3 uColorBase;
    uniform vec3 uColorWindow;
    uniform vec3 uColorAccent;
    uniform vec3 uColorWarm;
    uniform vec3 uColorVivid;
    varying vec2 vUv;
    varying float vSeed;
    varying float vHue;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453123);
    }

    void main() {
      vec2 grid = vec2(8.0, 22.0);
      vec2 cellF = vUv * grid;
      vec2 cell = floor(cellF);
      vec2 cellUv = fract(cellF);

      // Thin dark mullions so lit cells read as small window rectangles.
      float pane = step(0.14, cellUv.x) * step(0.14, cellUv.y);

      // Visual hierarchy: each building's own hashed brightness decides how
      // many of its windows are lit — most buildings stay mostly dark, a
      // minority read as densely, brightly occupied.
      float buildingBrightness = hash(vec2(vSeed * 731.0, 17.0));
      float litThreshold = mix(0.965, 0.74, buildingBrightness * buildingBrightness);

      float base = hash(cell + vSeed * 97.0);
      float lit = step(litThreshold, base) * pane;

      float flickerSeed = hash(cell + vSeed * 13.0 + floor(uTime * 3.0));
      float flicker = step(0.994, flickerSeed) * uHigh * pane;

      float glow = clamp(lit + flicker, 0.0, 1.0) * (1.0 + uPulse * 1.4);

      // Cel/toon shading: hard-banded lighting from face orientation
      // relative to the key light, instead of a smooth gradient — this is
      // what actually reads as "stylized game render" rather than
      // "realistic 3D building". Combined with the existing vertical
      // posterization for a genuine light/dark PLANE per face, not per
      // pixel.
      float ndotl = dot(normalize(vNormalW), normalize(uLightDir));
      float toonBand = ndotl > 0.4 ? 1.0 : (ndotl > -0.05 ? 0.5 : 0.16);
      float heightBand = floor(vUv.y * 4.0) / 4.0;
      vec3 shade = uColorBase * (0.32 + 0.5 * heightBand) * toonBand;

      // A slow, always-on light band scanning up every facade — the world
      // stays visibly alive even with the camera calm and the music quiet.
      float scan = smoothstep(0.94, 1.0, sin(vUv.y * 2.4 - uTime * 0.35 + vSeed * 6.0));
      shade += uColorAccent * scan * 0.12;

      // Cool-dominant, warm-accent composition: most windows are the warm
      // amber accent color; a minority of buildings use the cool cyan
      // accent instead, giving color separation rather than one uniform
      // "everything neon" wash. Strong bass shifts the whole facade
      // slightly warmer — buildings as instruments, not just scenery.
      vec3 districtWindow = mix(uColorWindow, uColorWarm, step(0.25, vHue) * step(vHue, 0.75));
      districtWindow = mix(districtWindow, uColorVivid, step(0.75, vHue));
      vec3 windowColor = mix(districtWindow, uColorAccent, step(0.72, fract(vSeed * 5.2)));
      windowColor = mix(windowColor, vec3(1.0, 0.85, 0.6), uPulse * 0.7);
      vec3 col = mix(shade, windowColor, clamp(glow, 0.0, 1.0) * (0.65 + 0.5 * uEnergy));
      col = mix(col, col * vec3(1.15, 1.0, 0.85), clamp(uBass * 1.3, 0.0, 0.5));

      // Stylized rim light — silhouette edges facing the camera pick up a
      // strong cool highlight, the anime "backlit" look, rather than
      // physically based specular.
      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fresnel = pow(1.0 - clamp(dot(normalize(vNormalW), viewDir), 0.0, 1.0), 2.2);
      col += uColorAccent * fresnel * 0.65 * (0.5 + 0.5 * uEnergy);

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(28.0, 130.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

const antennaGeometry = new THREE.CylinderGeometry(0.05, 0.09, 1, 6);
const antennaMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });

const machineryGeometry = new THREE.BoxGeometry(1, 1, 1);
const machineryMaterial = new THREE.MeshStandardMaterial({ color: '#0c0b1a', roughness: 0.9 });

const signGeometry = new THREE.PlaneGeometry(1, 1);
const signMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  transparent: true,
  side: THREE.DoubleSide,
});

// Low-poly faceted cone — the tapered spire / angled roof shape, deliberately
// low-segment for a stylized rather than smooth-realistic silhouette.
const roofCapGeometry = new THREE.ConeGeometry(1, 1, 6);
const roofCapMaterial = new THREE.MeshStandardMaterial({ color: '#141230', roughness: 0.75 });

// Toon outline via the classic "inverted hull" technique: a second copy of
// every segment, pushed outward along its own normal by a roughly constant
// WORLD-space thickness (compensating for each instance's own non-uniform
// scale), rendered back-face-only so just the silhouette rim shows through
// — this is what makes the skyline read as illustrated rather than
// smooth-shaded 3D. Reuses the segment mesh's own instance matrices
// (copied, not recomputed) and geometry, so it costs one extra draw call
// rather than a second full generation pass.
const OutlineMaterial = shaderMaterial(
  { uOutlineWidth: 0.055, uColor: new THREE.Color('#020103') },
  /* glsl */ `
    uniform float uOutlineWidth;
    void main() {
      vec3 instScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec3 push = normal * (uOutlineWidth / max(instScale, vec3(0.001)));
      vec4 worldPos = modelMatrix * instanceMatrix * vec4(position + push, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,
  /* glsl */ `
    uniform vec3 uColor;
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
    }
  `
);

export function Buildings({ featureFrame, world }: SceneProps) {
  const segmentsMeshRef = useRef<THREE.InstancedMesh>(null!);
  const outlineMeshRef = useRef<THREE.InstancedMesh>(null!);
  const antennaMeshRef = useRef<THREE.InstancedMesh>(null!);
  const machineryMeshRef = useRef<THREE.InstancedMesh>(null!);
  const signMeshRef = useRef<THREE.InstancedMesh>(null!);
  const roofCapMeshRef = useRef<THREE.InstancedMesh>(null!);

  const material = useMemo(() => new BuildingMaterial(), []);
  const outlineMaterial = useMemo(() => {
    const m = new OutlineMaterial();
    m.side = THREE.BackSide;
    return m;
  }, []);
  const pulse = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;
  const snareState = useRef(createBeatConsumerState()).current;
  const shiftState = useRef(createBeatConsumerState()).current;

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const seeds = new Float32Array(world.segments.length);
    const hues = new Float32Array(world.segments.length);
    world.segments.forEach((s, i) => {
      seeds[i] = s.seed;
      hues[i] = s.hueShift ?? 0;
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aHue', new THREE.InstancedBufferAttribute(hues, 1));
    return geo;
  }, [world]);

  useEffect(() => {
    const dummy = new THREE.Object3D();

    world.segments.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(s.tiltX ?? 0, s.rotationY, s.tiltZ ?? 0);
      dummy.scale.set(s.sx, s.sy, s.sz);
      dummy.updateMatrix();
      segmentsMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    segmentsMeshRef.current.instanceMatrix.needsUpdate = true;

    // The outline shell reuses the exact same instance transforms — copy
    // rather than recompute.
    outlineMeshRef.current.instanceMatrix.copyArray(segmentsMeshRef.current.instanceMatrix.array);
    outlineMeshRef.current.instanceMatrix.needsUpdate = true;

    world.antennas.forEach((a, i) => {
      dummy.position.set(a.x, a.y + a.height / 2, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(a.radius, a.height, a.radius);
      dummy.updateMatrix();
      antennaMeshRef.current.setMatrixAt(i, dummy.matrix);
      antennaMeshRef.current.setColorAt(i, a.color);
    });
    antennaMeshRef.current.instanceMatrix.needsUpdate = true;
    if (antennaMeshRef.current.instanceColor) antennaMeshRef.current.instanceColor.needsUpdate = true;

    world.machinery.forEach((m, i) => {
      dummy.position.set(m.x, m.y, m.z);
      dummy.rotation.set(0, m.rotationY, 0);
      dummy.scale.set(m.sx, m.sy, m.sz);
      dummy.updateMatrix();
      machineryMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    machineryMeshRef.current.instanceMatrix.needsUpdate = true;

    world.signs.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rotationY, 0);
      dummy.scale.set(s.width, s.height, 1);
      dummy.updateMatrix();
      signMeshRef.current.setMatrixAt(i, dummy.matrix);
      signMeshRef.current.setColorAt(i, s.color);
    });
    signMeshRef.current.instanceMatrix.needsUpdate = true;
    if (signMeshRef.current.instanceColor) signMeshRef.current.instanceColor.needsUpdate = true;

    world.roofCaps.forEach((r, i) => {
      dummy.position.set(r.x, r.y + r.height / 2, r.z);
      dummy.rotation.set(0, r.rotationY, 0);
      dummy.scale.set(r.radius, r.height, r.radius);
      dummy.updateMatrix();
      roofCapMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    roofCapMeshRef.current.instanceMatrix.needsUpdate = true;
  }, [world]);

  const machineryDummy = useRef(new THREE.Object3D()).current;

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const elapsed = state.clock.elapsedTime;

    // Beat/snare → illumination pulse: consumed exactly once per event,
    // then decays smoothly — every detected hit visibly brightens the
    // skyline for a moment, never silently. A major event layers a much
    // bigger, longer surge on top via the shared envelope.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) pulse.current = Math.max(pulse.current, beatHit);
    const snareHit = consumeSnareHit(featureFrame, snareState);
    if (snareHit > 0) pulse.current = Math.max(pulse.current, snareHit * 0.8);
    // A beat switch changes the world's identity, not just its brightness
    // — the skyline flashes as one visible "something changed" moment.
    const shiftHit = consumeSpectralShift(featureFrame, shiftState);
    if (shiftHit > 0) pulse.current = Math.max(pulse.current, shiftHit);
    pulse.current *= Math.exp(-dt * 6);

    const u = material.uniforms;
    u.uTime.value = elapsed;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uHigh.value = featureFrame.high + featureFrame.hihatIntensity * 0.3;
    u.uPulse.value = Math.max(pulse.current, getMajorEventEnvelope());
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);

    // The world stays visibly alive even with the camera calm and the
    // music quiet: rooftop machinery continuously rotates, antenna/sign
    // lights continuously pulse — always-on animation loops, independent
    // of any audio event.
    world.machinery.forEach((m, i) => {
      const spinSpeed = 0.3 + (i % 5) * 0.15;
      machineryDummy.position.set(m.x, m.y, m.z);
      machineryDummy.rotation.set(0, m.rotationY + elapsed * spinSpeed, 0);
      machineryDummy.scale.set(m.sx, m.sy, m.sz);
      machineryDummy.updateMatrix();
      machineryMeshRef.current.setMatrixAt(i, machineryDummy.matrix);
    });
    machineryMeshRef.current.instanceMatrix.needsUpdate = true;

    antennaMaterial.opacity = 0.55 + 0.45 * Math.sin(elapsed * 2.3) * Math.sin(elapsed * 0.7 + 1.5);
    signMaterial.opacity = 0.65 + 0.35 * Math.sin(elapsed * 3.1 + 2.0) * Math.sin(elapsed * 1.1);
  });

  return (
    <>
      <instancedMesh
        ref={segmentsMeshRef}
        args={[geometry, material, world.segments.length]}
        frustumCulled={false}
      />
      <instancedMesh ref={outlineMeshRef} args={[geometry, outlineMaterial, world.segments.length]} frustumCulled={false} />
      <instancedMesh
        ref={antennaMeshRef}
        args={[antennaGeometry, antennaMaterial, world.antennas.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={machineryMeshRef}
        args={[machineryGeometry, machineryMaterial, world.machinery.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={signMeshRef}
        args={[signGeometry, signMaterial, world.signs.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={roofCapMeshRef}
        args={[roofCapGeometry, roofCapMaterial, world.roofCaps.length]}
        frustumCulled={false}
      />
    </>
  );
}
