import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { audioEngine } from '../audio/AudioEngine';
import { FeatureExtractor } from '../audio/FeatureExtractor';
import { featureFrame } from '../audio/featureFrame';

/**
 * Mounted once inside <Canvas>. Every render frame, pulls fresh FFT data
 * from the AnalyserNode and writes the derived features into the shared
 * `featureFrame` singleton, which every scene reads directly.
 *
 * Lives inside the R3F render loop (useFrame) rather than its own
 * requestAnimationFrame loop, so audio analysis stays in lockstep with
 * what's actually about to be drawn.
 */
export function FeatureUpdater() {
  const extractorRef = useRef<FeatureExtractor | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useFrame(() => {
    const analyser = audioEngine.analyser;
    if (!analyser) return;

    // (Re)create the extractor if this is the first frame with an analyser,
    // or a new AudioContext/analyser was created (e.g. after dispose).
    if (extractorRef.current === null || analyserRef.current !== analyser) {
      extractorRef.current = new FeatureExtractor(analyser, audioEngine.sampleRate);
      analyserRef.current = analyser;
    }

    extractorRef.current.update(featureFrame, audioEngine.getCurrentTime());
  });

  return null;
}
