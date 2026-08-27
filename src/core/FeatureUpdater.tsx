import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { audioEngine } from '../audio/AudioEngine';
import { FeatureExtractor } from '../audio/FeatureExtractor';
import { featureFrame } from '../audio/featureFrame';
import { useAudioStore } from '../state/audioStore';
import { WorldDirector } from '../scenes/cyberpunkCity/world/worldDirector';
import { resetCinematicDirector } from '../scenes/cyberpunkCity/world/cinematicDirector';
import { resetRhythmState } from '../scenes/cyberpunkCity/world/rhythmState';

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
  const resetToken = useAudioStore((s) => s.resetToken);

  // A new track loading, or a seek within the current one, both bump
  // resetToken — either way the audio position just had a discontinuity,
  // so every adaptive baseline/lifecycle state that assumes continuous
  // playback needs to start clean rather than misfiring against stale
  // pre-jump data.
  useEffect(() => {
    extractorRef.current?.reset();
    WorldDirector.reset();
    resetCinematicDirector();
    resetRhythmState();
  }, [resetToken]);

  useFrame((_, delta) => {
    const analyser = audioEngine.analyser;
    if (!analyser) return;

    // (Re)create the extractor if this is the first frame with an analyser,
    // or a new AudioContext/analyser was created (e.g. after dispose).
    if (extractorRef.current === null || analyserRef.current !== analyser) {
      extractorRef.current = new FeatureExtractor(analyser, audioEngine.sampleRate);
      analyserRef.current = analyser;
    }

    // While there's no live audio actually playing (idle/loading/ready/
    // paused/ended), there's nothing real to analyze — skip updating
    // entirely so featureFrame freezes exactly where it was rather than
    // decaying toward silence or scanning a disconnected analyser.
    if (!audioEngine.isPlaying()) return;

    extractorRef.current.update(featureFrame, audioEngine.getCurrentTime(), delta);
  });

  return null;
}
