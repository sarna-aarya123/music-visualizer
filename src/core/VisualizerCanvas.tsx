import { useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing';
import { FeatureUpdater } from './FeatureUpdater';
import { ENVIRONMENTS, DEFAULT_ENVIRONMENT_ID } from '../scenes/registry';
import { useEnvironmentStore } from '../state/environmentStore';
import { featureFrame } from '../audio/featureFrame';
import { consumeBeat, createBeatConsumerState } from '../audio/beatConsumer';
import { getMajorEventEnvelope } from '../scenes/cyberpunkCity/world/musicEventDirector';

/** Overall energy → post-processing intensity (the "atmosphere breathes
 *  with the track" mapping), plus a reliable atmospheric pulse on every
 *  detected beat, consumed exactly once via the same beat-counter
 *  mechanism every other reactive system uses. A major event spikes bloom
 *  hard and briefly lifts the vignette for a screen-flash feel.
 *  Typed loosely (`any`) because @react-three/postprocessing's ref type
 *  for effect components doesn't line up with the underlying effect
 *  instance across versions — the instance itself does expose these
 *  properties at runtime, which is all we need here. */
function PostFX() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bloomRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vignetteRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chromaticRef = useRef<any>(null);
  const pulse = useRef(0);
  const beatState = useRef(createBeatConsumerState()).current;

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0) pulse.current = Math.max(pulse.current, beatHit);
    pulse.current *= Math.exp(-dt * 7);

    const majorEnvelope = getMajorEventEnvelope();

    if (bloomRef.current) {
      bloomRef.current.intensity = 0.5 + featureFrame.energy * 1.6 + pulse.current * 0.9 + majorEnvelope * 4.5;
    }
    if (vignetteRef.current) {
      vignetteRef.current.darkness = Math.max(0.15, 0.9 - majorEnvelope * 0.85);
    }
    if (chromaticRef.current) {
      const shift = majorEnvelope * 0.006;
      chromaticRef.current.offset.set(shift, shift * 0.6);
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        ref={bloomRef}
        intensity={0.5}
        luminanceThreshold={0.22}
        luminanceSmoothing={0.6}
        mipmapBlur
      />
      <Vignette ref={vignetteRef} eskil={false} offset={0.25} darkness={0.9} />
      <ChromaticAberration
        ref={chromaticRef}
        offset={new THREE.Vector2(0, 0)}
        radialModulation={false}
        modulationOffset={0}
      />
      <Noise opacity={0.02} />
    </EffectComposer>
  );
}

export function VisualizerCanvas() {
  const activeId = useEnvironmentStore((s) => s.activeId);
  const environment = ENVIRONMENTS[activeId] ?? ENVIRONMENTS[DEFAULT_ENVIRONMENT_ID];
  const SceneComponent = environment.SceneComponent;

  return (
    <Canvas
      camera={{ position: [0, 5.5, 8], fov: 52, near: 0.1, far: 1400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 1.75]}
    >
      <color attach="background" args={['#05030c']} />
      <FeatureUpdater />
      {/* Keyed by environment id so switching environments fully remounts
          the scene (fresh route/world/camera/character state) rather than
          trying to reconcile two completely different geometry sets. */}
      <SceneComponent key={activeId} featureFrame={featureFrame} />
      <PostFX />
    </Canvas>
  );
}
