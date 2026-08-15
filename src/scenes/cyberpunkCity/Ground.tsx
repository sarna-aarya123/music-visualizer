import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import type { SceneProps } from '../types';
import type { RouteData } from './world/routeGenerator';
import { consumeBeat, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from './world/musicEventDirector';

const RIPPLE_SPEED = 22; // world units/sec the impact ring expands at
const RIPPLE_LIFETIME = 1.1; // seconds before a ripple fully fades

const RIBBON_SAMPLES = 260;
const TERRAIN_WIDTH = 45;

const GroundMaterial = shaderMaterial(
  {
    uBass: 0,
    uEnergy: 0,
    uGridScale: 0.08,
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
    uniform float uGridScale;
    uniform vec3 uCameraPos;
    uniform vec3 uFogColor;
    uniform vec3 uBaseColor;
    uniform vec3 uLineColor;
    uniform vec3 uImpactCenter;
    uniform float uImpactAge;
    uniform float uImpactStrength;
    varying vec3 vWorldPos;

    void main() {
      vec2 grid = abs(fract(vWorldPos.xz * uGridScale) - 0.5);
      float lineDist = min(grid.x, grid.y);
      float line = 1.0 - smoothstep(0.0, 0.03 + uBass * 0.015, lineDist);

      vec3 col = mix(uBaseColor, uLineColor, line * (0.55 + 0.45 * uEnergy));

      // Impact ring expanding outward from under the camera (in full 3D so
      // it still reads correctly on elevated/sloped route sections),
      // fading with both distance and age. Major events reuse this same
      // mechanism at a much higher strength for a giant energy-wave feel.
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

/** Builds a ribbon following the route's centerline, with per-sample inner
 *  /outer lateral offsets and an optional vertical offset — shared by the
 *  road itself and the wider terrain skirt on either side of it. */
function buildRibbonGeometry(
  route: RouteData,
  edgesAt: (t: number) => [number, number],
  yOffset: number,
  samples: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = (i % samples) / samples;
    const frame = route.getFrameAt(t);
    const [innerOffset, outerOffset] = edgesAt(t);
    const inner = frame.position
      .clone()
      .addScaledVector(frame.right, innerOffset)
      .addScaledVector(frame.up, yOffset);
    const outer = frame.position
      .clone()
      .addScaledVector(frame.right, outerOffset)
      .addScaledVector(frame.up, yOffset);
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z);

    if (i < samples) {
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
}

export function Ground({ featureFrame, route }: SceneProps) {
  const material = useMemo(() => new GroundMaterial(), []);
  const terrainMaterial = useMemo(() => {
    const m = new GroundMaterial();
    m.uniforms.uGridScale.value = 0.02;
    m.uniforms.uBaseColor.value = new THREE.Color('#050510');
    m.uniforms.uLineColor.value = new THREE.Color('#2a2a55');
    return m;
  }, []);

  const beatState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;
  const impactStartTime = useRef(-999);
  const impactStrength = useRef(0);

  // Road ribbon: exactly the corridor width, at route elevation — this is
  // what the camera actually rides. Two wider terrain-skirt ribbons flank
  // it so buildings (whose foundations sit at this same base elevation)
  // read as standing on continuous ground instead of floating in void.
  const roadGeometry = useMemo(
    () =>
      buildRibbonGeometry(
        route,
        (t) => {
          const { corridorRadius } = route.getDistrictInfoAt(t);
          return [-corridorRadius, corridorRadius];
        },
        0,
        RIBBON_SAMPLES
      ),
    [route]
  );
  const leftTerrainGeometry = useMemo(
    () =>
      buildRibbonGeometry(
        route,
        (t) => {
          const { corridorRadius } = route.getDistrictInfoAt(t);
          return [-(corridorRadius + TERRAIN_WIDTH), -corridorRadius];
        },
        -0.12,
        RIBBON_SAMPLES
      ),
    [route]
  );
  const rightTerrainGeometry = useMemo(
    () =>
      buildRibbonGeometry(
        route,
        (t) => {
          const { corridorRadius } = route.getDistrictInfoAt(t);
          return [corridorRadius, corridorRadius + TERRAIN_WIDTH];
        },
        -0.12,
        RIBBON_SAMPLES
      ),
    [route]
  );

  useEffect(
    () => () => {
      roadGeometry.dispose();
      leftTerrainGeometry.dispose();
      rightTerrainGeometry.dispose();
    },
    [roadGeometry, leftTerrainGeometry, rightTerrainGeometry]
  );

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Every detected beat starts a brand new ripple, guaranteed — this is
    // the "ground impact" reaction from the beat-interaction spec. A major
    // event reuses the same ripple at a far higher strength for a giant
    // energy-wave moment.
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) {
      impactStartTime.current = t;
      impactStrength.current = beatHit;
      (material.uniforms.uImpactCenter.value as THREE.Vector3).copy(state.camera.position);
    }
    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      impactStartTime.current = t;
      impactStrength.current = 3.5 + majorHit * 2.5;
      (material.uniforms.uImpactCenter.value as THREE.Vector3).copy(state.camera.position);
    }

    const u = material.uniforms;
    u.uBass.value = featureFrame.bass;
    u.uEnergy.value = featureFrame.energy;
    u.uImpactAge.value = t - impactStartTime.current;
    u.uImpactStrength.value = impactStrength.current;
    (u.uCameraPos.value as THREE.Vector3).copy(state.camera.position);

    terrainMaterial.uniforms.uBass.value = featureFrame.bass;
    terrainMaterial.uniforms.uEnergy.value = featureFrame.energy * 0.4;
    (terrainMaterial.uniforms.uCameraPos.value as THREE.Vector3).copy(state.camera.position);
  });

  return (
    <>
      {/* DoubleSide throughout: the ribbon's winding direction depends on
          the route's local curvature/right-vector, which flips sign
          around the loop — simpler and cheap (thin strips) to always draw
          both faces than to hand-derive consistent winding everywhere. */}
      <mesh geometry={roadGeometry}>
        <primitive object={material} attach="material" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={leftTerrainGeometry}>
        <primitive object={terrainMaterial} attach="material" side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={rightTerrainGeometry}>
        <primitive object={terrainMaterial} attach="material" side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}
