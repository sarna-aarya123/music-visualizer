import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { SceneProps } from '../types';
import { consumeBeat, createBeatConsumerState } from '../../audio/beatConsumer';

const AMBIENT_COUNT = 260;
const AMBIENT_HEIGHT_RANGE = 40;
const AMBIENT_SPREAD = 70;

const DUST_COUNT = 90;
const DUST_SPREAD = 5.5; // stays close around the camera — the foreground layer

/** Ambient embers drifting through the whole scene. Base drift is always
 *  present (idle scene still feels alive); high frequencies add extra
 *  upward speed/opacity, and every beat adds a short burst on top. */
function AmbientMotes({ featureFrame }: SceneProps) {
  const materialRef = useRef<THREE.PointsMaterial>(null!);
  const speedsRef = useRef<Float32Array>(null!);
  const burst = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;

  const geometry = useMemo(() => {
    const positions = new Float32Array(AMBIENT_COUNT * 3);
    const speeds = new Float32Array(AMBIENT_COUNT);
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * AMBIENT_SPREAD;
      positions[i * 3 + 1] = Math.random() * AMBIENT_HEIGHT_RANGE;
      positions[i * 3 + 2] = (Math.random() - 0.5) * AMBIENT_SPREAD - 60;
      speeds[i] = 0.4 + Math.random() * 1.2;
    }
    speedsRef.current = speeds;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const speeds = speedsRef.current;
    const activity = featureFrame.high;

    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) burst.current = beatHit;
    burst.current *= Math.exp(-delta * 4);

    for (let i = 0; i < AMBIENT_COUNT; i++) {
      let y = posAttr.getY(i);
      y += delta * (0.6 + speeds[i] * (0.5 + activity * 1.5 + burst.current * 4));
      if (y > AMBIENT_HEIGHT_RANGE) y = 0;
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.opacity = 0.22 + activity * 0.55 + burst.current * 0.75;
      materialRef.current.size = 0.12 + activity * 0.16 + burst.current * 0.22;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={materialRef}
        color="#9be8ff"
        transparent
        opacity={0.3}
        size={0.15}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/** A small cloud of dust motes that stays wrapped around the camera at all
 *  times — the foreground depth layer: close, slightly out of focus-
 *  feeling particles that drift past as the camera travels, giving the
 *  environment scale and parallax rather than feeling like a flat backdrop. */
function ForegroundDust({ featureFrame }: SceneProps) {
  const materialRef = useRef<THREE.PointsMaterial>(null!);

  const geometry = useMemo(() => {
    const positions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * DUST_SPREAD * 2;
      positions[i * 3 + 1] = (Math.random() - 0.3) * DUST_SPREAD * 1.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * DUST_SPREAD * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const cam = state.camera.position;

    for (let i = 0; i < DUST_COUNT; i++) {
      let x = posAttr.getX(i);
      let y = posAttr.getY(i);
      let z = posAttr.getZ(i);

      y += delta * 0.15;

      // Wrap each mote back into a box centered on the camera once it
      // drifts too far away, so the cloud always reads as "around here".
      if (Math.abs(x - cam.x) > DUST_SPREAD) x = cam.x + (Math.random() - 0.5) * DUST_SPREAD * 2;
      if (y - cam.y > DUST_SPREAD * 0.8) y = cam.y - DUST_SPREAD * 0.6;
      if (Math.abs(z - cam.z) > DUST_SPREAD) z = cam.z + (Math.random() - 0.5) * DUST_SPREAD * 2;

      posAttr.setXYZ(i, x, y, z);
    }
    posAttr.needsUpdate = true;

    if (materialRef.current) {
      materialRef.current.opacity = 0.1 + featureFrame.high * 0.2;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={materialRef}
        color="#cfe8ff"
        transparent
        opacity={0.15}
        size={0.045}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export function Particles({ featureFrame }: SceneProps) {
  return (
    <>
      <AmbientMotes featureFrame={featureFrame} />
      <ForegroundDust featureFrame={featureFrame} />
    </>
  );
}
