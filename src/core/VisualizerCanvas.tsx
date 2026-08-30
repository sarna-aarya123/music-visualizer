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
 *  and briefly lifts the vignette for a dramatic surge.
 *  Typed loosely (`any`) because @react-three/postprocessing's ref type
 *  for effect components doesn't line up with the underlying effect
 *  instance across versions — the instance itself does expose these
 *  properties at runtime, which is all we need here.
 *
 *  Phase 6 Stage 7 — readability pass. The major-event response used to
 *  stack a very large additive bloom term (`env * 4.5`), a near-total
 *  vignette lift (down to 0.15), and heavy chromatic aberration on top of
 *  the emissive/rim/sky-white-mix boosts every other system applies from
 *  the SAME envelope — the combined result blew the whole frame out to
 *  white so nothing was readable. Rebalanced here (and in WorldScene /
 *  Islands / ProceduralSky / IslandSky / WorldPath / WorldParticles) so a
 *  drop still reads as a powerful visual surge but the environment,
 *  character, landmarks and cel-shaded value separation all stay visible:
 *   - bloom's event term cut ~60% and the total hard-clamped
 *   - bloom's luminanceThreshold RISES during an event, so only genuine
 *     highlights bloom and mid-tones stop smearing
 *   - the vignette keeps a real frame (floor 0.45, was 0.15)
 *   - chromatic aberration eased back for legibility */
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
      // Stage 8: `luminanceThreshold` settled at 0.28 — a middle ground.
      // 0.22 (pre-Stage-7) bloomed the neon-grid floors edge to edge into
      // a solid slab; 0.34 killed almost all glow and everything went
      // bland. At 0.28 mid-tones still don't bloom but emissive props and
      // bright highlights get a real halo again.
      const raw = 0.5 + featureFrame.energy * 1.3 + pulse.current * 0.7 + majorEnvelope * 2.0;
      bloomRef.current.intensity = Math.min(raw, 2.9);
      bloomRef.current.luminanceThreshold = 0.28 + majorEnvelope * 0.1;
    }
    if (vignetteRef.current) {
      // Floor raised 0.15 -> 0.45: the frame always keeps a visible edge
      // darkening, so a major event can't open the whole image up to white.
      vignetteRef.current.darkness = Math.max(0.45, 0.9 - majorEnvelope * 0.4);
    }
    if (chromaticRef.current) {
      const shift = majorEnvelope * 0.0038;
      chromaticRef.current.offset.set(shift, shift * 0.6);
    }
  });

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        ref={bloomRef}
        intensity={0.5}
        luminanceThreshold={0.28}
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
