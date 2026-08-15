import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { FeatureUpdater } from './FeatureUpdater';
import { CyberpunkCityScene } from '../scenes/cyberpunkCity/CyberpunkCityScene';
import { featureFrame } from '../audio/featureFrame';

/** Overall energy → post-processing intensity (the "atmosphere breathes
 *  with the track" mapping), plus a small kick punch on bloom.
 *  Typed loosely (`any`) because @react-three/postprocessing's ref type
 *  for effect components doesn't line up with the underlying effect
 *  instance across versions — the instance itself does expose `.intensity`
 *  at runtime, which is all we need here. */
function PostFX() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bloomRef = useRef<any>(null);

  useFrame(() => {
    if (bloomRef.current) {
      bloomRef.current.intensity =
        0.5 + featureFrame.energy * 1.6 + featureFrame.kickImpulse * 0.7;
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
      <Vignette eskil={false} offset={0.25} darkness={0.9} />
      <Noise opacity={0.02} />
    </EffectComposer>
  );
}

export function VisualizerCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 5.5, 8], fov: 50, near: 0.1, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      dpr={[1, 1.75]}
    >
      <color attach="background" args={['#05030c']} />
      <FeatureUpdater />
      <CyberpunkCityScene featureFrame={featureFrame} />
      <PostFX />
    </Canvas>
  );
}
