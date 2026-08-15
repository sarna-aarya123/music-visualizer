import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';
import { PER_ROW, ROW_SPACING, ROWS, STREET_HALF_WIDTH } from './layout';

// ---------------------------------------------------------------------------
// Procedural skyline generation
//
// Every building is 1-4 stacked box "segments" that narrow and offset as
// they rise (setbacks/towers) instead of one uniform box, plus optional
// antennas, rooftop machinery, signage, and the occasional bridge between
// neighbors — this is what gives the skyline an irregular, interesting
// silhouette instead of reading as a field of identical cubes.
// ---------------------------------------------------------------------------

interface Segment {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  sx: number;
  sy: number;
  sz: number;
  seed: number;
}

interface Antenna {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  color: THREE.Color;
}

interface Machinery {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  sx: number;
  sy: number;
  sz: number;
}

interface Sign {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  width: number;
  height: number;
  color: THREE.Color;
}

interface SkylineLayout {
  segments: Segment[];
  antennas: Antenna[];
  machinery: Machinery[];
  signs: Sign[];
}

const ANTENNA_COLORS = ['#ff5577', '#ffe08a', '#8fd8ff'];
const SIGN_COLORS = ['#ff3fb0', '#7ef9ff', '#ffdd55', '#8f6bff'];

function pushSegment(
  segments: Segment[],
  cx: number,
  cz: number,
  rotationY: number,
  bottomY: number,
  w: number,
  d: number,
  h: number,
  seed: number
): number {
  segments.push({ x: cx, y: bottomY + h / 2, z: cz, rotationY, sx: w, sy: h, sz: d, seed });
  return bottomY + h;
}

/** Builds one multi-segment building at (x, z) and appends its segments to
 *  the shared list. Returns its final roof height and base half-width so
 *  callers can place antennas/machinery/signs/bridges relative to it. */
function buildBuilding(x: number, z: number, segments: Segment[]) {
  const seed = Math.random();
  // A minority of buildings get a slight overall yaw for an "angled
  // structure" look rather than everything being axis-aligned.
  const rotationY = Math.random() < 0.15 ? (Math.random() - 0.5) * 0.3 : 0;

  const width = 2.2 + Math.random() * 3.2;
  const depth = 2.0 + Math.random() * 2.8;
  const height = 5 + Math.random() * 9;

  let y = pushSegment(segments, x, z, rotationY, 0, width, depth, height, seed);
  let cx = x;
  let cz = z;
  let prevW = width;
  let prevD = depth;
  let segCount = 1;

  // Stack narrowing, offset setback segments on top — the probability of
  // continuing drops with each additional segment so most buildings stay
  // modest while a few become tall, elaborate towers.
  while (segCount < 4 && Math.random() < (segCount === 1 ? 0.8 : segCount === 2 ? 0.48 : 0.25)) {
    const shrink = 0.42 + Math.random() * 0.32;
    const w = Math.max(0.9, prevW * shrink);
    const d = Math.max(0.9, prevD * shrink);
    const h = segCount === 1 ? 3 + Math.random() * 7 : 2 + Math.random() * 3.5;

    const maxOffX = Math.max(0, (prevW - w) / 2);
    const maxOffZ = Math.max(0, (prevD - d) / 2);
    cx = x + (Math.random() - 0.5) * 2 * maxOffX;
    cz = z + (Math.random() - 0.5) * 2 * maxOffZ;

    y = pushSegment(segments, cx, cz, rotationY, y, w, d, h, seed);
    prevW = w;
    prevD = d;
    segCount++;
  }

  return { topY: y, halfWidth: width / 2 };
}

function generateSkyline(): SkylineLayout {
  const segments: Segment[] = [];
  const antennas: Antenna[] = [];
  const machinery: Machinery[] = [];
  const signs: Sign[] = [];

  for (let row = 0; row < ROWS; row++) {
    const rowZ = -row * ROW_SPACING - 10;

    for (const side of [-1, 1] as const) {
      const rowFootprints: { cx: number; cz: number; topY: number; halfWidth: number }[] = [];

      for (let n = 0; n < PER_ROW; n++) {
        const x = side * (STREET_HALF_WIDTH + n * 3.6 + Math.random() * 1.6 + row * 0.3);
        const z = rowZ - Math.random() * 4;
        const built = buildBuilding(x, z, segments);
        rowFootprints.push({ cx: x, cz: z, topY: built.topY, halfWidth: built.halfWidth });

        if (Math.random() < 0.3) {
          antennas.push({
            x,
            y: built.topY,
            z,
            height: 1.5 + Math.random() * 3,
            radius: 1,
            color: new THREE.Color(ANTENNA_COLORS[Math.floor(Math.random() * ANTENNA_COLORS.length)]),
          });
        }

        if (Math.random() < 0.35) {
          machinery.push({
            x: x + (Math.random() - 0.5) * built.halfWidth * 0.6,
            y: built.topY + 0.3,
            z: z + (Math.random() - 0.5) * built.halfWidth * 0.6,
            rotationY: Math.random() * Math.PI,
            sx: 0.5 + Math.random() * 0.6,
            sy: 0.5 + Math.random() * 0.7,
            sz: 0.5 + Math.random() * 0.6,
          });
        }

        if (Math.random() < 0.18 && built.topY > 8) {
          const signY = built.topY * 0.4 + Math.random() * built.topY * 0.3;
          signs.push({
            x: x + side * (built.halfWidth + 0.05),
            y: signY,
            z,
            rotationY: side > 0 ? -Math.PI / 2 : Math.PI / 2,
            width: 1.2 + Math.random() * 1.6,
            height: 0.5 + Math.random() * 0.7,
            color: new THREE.Color(SIGN_COLORS[Math.floor(Math.random() * SIGN_COLORS.length)]),
          });
        }
      }

      // Occasional bridge between neighboring buildings in the same row.
      for (let n = 0; n < rowFootprints.length - 1; n++) {
        if (Math.random() >= 0.12) continue;
        const a = rowFootprints[n];
        const b = rowFootprints[n + 1];
        const gap = Math.abs(b.cx - a.cx) - (a.halfWidth + b.halfWidth);
        if (gap <= 0.5 || gap >= 6) continue;
        const bridgeY = Math.min(a.topY, b.topY) * (0.55 + Math.random() * 0.25);
        segments.push({
          x: (a.cx + b.cx) / 2,
          y: bridgeY,
          z: (a.cz + b.cz) / 2,
          rotationY: 0,
          sx: Math.abs(b.cx - a.cx),
          sy: 0.5 + Math.random() * 0.4,
          sz: 0.6 + Math.random() * 0.5,
          seed: Math.random(),
        });
      }
    }
  }

  return { segments, antennas, machinery, signs };
}

// ---------------------------------------------------------------------------
// Building facade material — stylized windows, per-building brightness
// hierarchy, rim lighting, and a beat-triggered illumination pulse.
// ---------------------------------------------------------------------------

const BuildingMaterial = shaderMaterial(
  {
    uTime: 0,
    uBass: 0,
    uEnergy: 0,
    uHigh: 0,
    uPulse: 0,
    uCameraPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#05030c'),
    uColorBase: new THREE.Color('#0b0a1f'),
    uColorWindow: new THREE.Color('#7ef9ff'),
  },
  // vertex
  /* glsl */ `
    attribute float aSeed;
    varying vec2 vUv;
    varying float vSeed;
    varying vec3 vWorldPos;
    varying vec3 vNormalW;
    uniform float uBass;

    void main() {
      vUv = uv;
      vSeed = aSeed;
      vec3 pos = position;
      // Subtle global "breathing" on bass rather than per-instance CPU work.
      pos.y *= 1.0 + uBass * 0.015;
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
    uniform vec3 uCameraPos;
    uniform vec3 uFogColor;
    uniform vec3 uColorBase;
    uniform vec3 uColorWindow;
    varying vec2 vUv;
    varying float vSeed;
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

      float glow = clamp(lit + flicker, 0.0, 1.0) * (1.0 + uPulse * 0.8);

      vec3 shade = uColorBase * (0.3 + 0.45 * vUv.y);
      vec3 windowColor = mix(uColorWindow, vec3(1.0, 0.55, 0.72), fract(vSeed * 3.7));
      windowColor = mix(windowColor, vec3(1.0, 0.82, 0.55), uPulse * 0.5);
      vec3 col = mix(shade, windowColor, clamp(glow, 0.0, 1.0) * (0.65 + 0.5 * uEnergy));

      // Stylized rim light — silhouette edges facing the camera pick up a
      // cool highlight, the anime "backlit" look, rather than physically
      // based specular.
      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fresnel = pow(1.0 - clamp(dot(normalize(vNormalW), viewDir), 0.0, 1.0), 2.5);
      col += vec3(0.45, 0.65, 1.0) * fresnel * 0.35 * (0.4 + 0.6 * uEnergy);

      float dist = length(uCameraPos - vWorldPos);
      float fogAmount = smoothstep(28.0, 130.0, dist);
      col = mix(col, uFogColor, fogAmount);

      gl_FragColor = vec4(col, 1.0);
    }
  `
);

const antennaGeometry = new THREE.CylinderGeometry(0.05, 0.09, 1, 6);
const antennaMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

const machineryGeometry = new THREE.BoxGeometry(1, 1, 1);
const machineryMaterial = new THREE.MeshStandardMaterial({ color: '#0c0b1a', roughness: 0.9 });

const signGeometry = new THREE.PlaneGeometry(1, 1);
const signMaterial = new THREE.MeshBasicMaterial({
  color: '#ffffff',
  toneMapped: false,
  side: THREE.DoubleSide,
});

export function Buildings({ featureFrame }: SceneProps) {
  const segmentsMeshRef = useRef<THREE.InstancedMesh>(null!);
  const antennaMeshRef = useRef<THREE.InstancedMesh>(null!);
  const machineryMeshRef = useRef<THREE.InstancedMesh>(null!);
  const signMeshRef = useRef<THREE.InstancedMesh>(null!);

  const layout = useMemo(() => generateSkyline(), []);
  const material = useMemo(() => new BuildingMaterial(), []);
  const pulse = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;

  const geometry = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const seeds = new Float32Array(layout.segments.length);
    layout.segments.forEach((s, i) => (seeds[i] = s.seed));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    return geo;
  }, [layout]);

  useEffect(() => {
    const dummy = new THREE.Object3D();

    layout.segments.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rotationY, 0);
      dummy.scale.set(s.sx, s.sy, s.sz);
      dummy.updateMatrix();
      segmentsMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    segmentsMeshRef.current.instanceMatrix.needsUpdate = true;

    layout.antennas.forEach((a, i) => {
      dummy.position.set(a.x, a.y + a.height / 2, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(a.radius, a.height, a.radius);
      dummy.updateMatrix();
      antennaMeshRef.current.setMatrixAt(i, dummy.matrix);
      antennaMeshRef.current.setColorAt(i, a.color);
    });
    antennaMeshRef.current.instanceMatrix.needsUpdate = true;
    if (antennaMeshRef.current.instanceColor) antennaMeshRef.current.instanceColor.needsUpdate = true;

    layout.machinery.forEach((m, i) => {
      dummy.position.set(m.x, m.y, m.z);
      dummy.rotation.set(0, m.rotationY, 0);
      dummy.scale.set(m.sx, m.sy, m.sz);
      dummy.updateMatrix();
      machineryMeshRef.current.setMatrixAt(i, dummy.matrix);
    });
    machineryMeshRef.current.instanceMatrix.needsUpdate = true;

    layout.signs.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rotationY, 0);
      dummy.scale.set(s.width, s.height, 1);
      dummy.updateMatrix();
      signMeshRef.current.setMatrixAt(i, dummy.matrix);
      signMeshRef.current.setColorAt(i, s.color);
    });
    signMeshRef.current.instanceMatrix.needsUpdate = true;
    if (signMeshRef.current.instanceColor) signMeshRef.current.instanceColor.needsUpdate = true;
  }, [layout]);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);

    // Beat → illumination pulse: consumed exactly once per beat, then
    // decays smoothly — every detected beat visibly brightens the skyline
    // for a moment, never silently.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) pulse.current = beatHit;
    pulse.current *= Math.exp(-dt * 6);

    const u = material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uHigh.value = featureFrame.high;
    u.uPulse.value = pulse.current;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return (
    <>
      <instancedMesh
        ref={segmentsMeshRef}
        args={[geometry, material, layout.segments.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={antennaMeshRef}
        args={[antennaGeometry, antennaMaterial, layout.antennas.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={machineryMeshRef}
        args={[machineryGeometry, machineryMaterial, layout.machinery.length]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={signMeshRef}
        args={[signGeometry, signMaterial, layout.signs.length]}
        frustumCulled={false}
      />
    </>
  );
}
