import * as THREE from 'three';
import type { AudioFeatureFrame } from '../../../audio/types';
import { consumeDrop, consumeSpectralShift, createBeatConsumerState } from '../../../audio/beatConsumer';

/**
 * The system that decides when something musically big enough has
 * happened to warrant a rare, major, coordinated world event — not every
 * beat, not even every strong beat, but genuine drops/beat-switches/huge
 * transients. Every reactive system (camera, buildings, ground, particles,
 * atmosphere, post-processing) reads the same `majorEventState` singleton
 * and renders its own piece of the event, scaled by the same lifecycle
 * envelope, so the whole world moves together for that moment.
 *
 * Lifecycle: idle -> anticipation -> impact -> reaction -> recovery -> idle.
 * `impactEventId` increments exactly once per event, right as it enters
 * 'impact' — consumers use the same exactly-once beatConsumer mechanism
 * against it for one-shot reactions (a velocity launch, a ripple, a
 * particle burst), while `getMajorEventEnvelope()` gives a continuous
 * 0..1 value any consumer can read every frame for a smooth surge-and-fade.
 */

export type MajorEventPhase = 'idle' | 'anticipation' | 'impact' | 'reaction' | 'recovery';

export interface MajorEventState {
  phase: MajorEventPhase;
  phaseTime: number;
  intensity: number;
  impactEventId: number;
  originPosition: THREE.Vector3;
}

export const majorEventState: MajorEventState = {
  phase: 'idle',
  phaseTime: 0,
  intensity: 0,
  impactEventId: 0,
  originPosition: new THREE.Vector3(),
};

const PHASE_DURATIONS: Record<Exclude<MajorEventPhase, 'idle'>, number> = {
  anticipation: 0.18,
  impact: 0.12,
  reaction: 0.75,
  recovery: 1.4,
};

const PHASE_ORDER: MajorEventPhase[] = ['anticipation', 'impact', 'reaction', 'recovery', 'idle'];

/** Major events must stay rare to feel special — this is the single
 *  biggest lever for "obvious but not exhausting". */
const MIN_EVENT_GAP = 7;
const IMPACT_SCORE_BAR = 0.86;
const SPECTRAL_SHIFT_BAR = 0.55;

let impactCounter = 0;
let lastMajorEventTime = -999;
const dropConsumer = createBeatConsumerState();
const shiftConsumer = createBeatConsumerState();

export function stepMusicEventDirector(
  dt: number,
  frame: AudioFeatureFrame,
  cameraPosition: THREE.Vector3,
  elapsed: number
): void {
  majorEventState.phaseTime += dt;

  if (majorEventState.phase !== 'idle') {
    const duration = PHASE_DURATIONS[majorEventState.phase];
    if (majorEventState.phaseTime > duration) {
      const next = PHASE_ORDER[PHASE_ORDER.indexOf(majorEventState.phase) + 1] ?? 'idle';
      majorEventState.phase = next;
      majorEventState.phaseTime = 0;
      if (next === 'impact') {
        impactCounter += 1;
        majorEventState.impactEventId = impactCounter;
      }
    }
  }

  if (majorEventState.phase === 'idle') {
    const dropHit = consumeDrop(frame, dropConsumer);
    const shiftHit = consumeSpectralShift(frame, shiftConsumer);
    const impactSpike = frame.impactScore > IMPACT_SCORE_BAR;
    const cooldownOk = elapsed - lastMajorEventTime > MIN_EVENT_GAP;

    if (cooldownOk && (dropHit > 0 || shiftHit > SPECTRAL_SHIFT_BAR || impactSpike)) {
      majorEventState.phase = 'anticipation';
      majorEventState.phaseTime = 0;
      majorEventState.intensity = Math.max(dropHit > 0 ? 0.85 : 0, shiftHit, frame.impactScore);
      majorEventState.originPosition.copy(cameraPosition);
      lastMajorEventTime = elapsed;
    }
  }
}

/** A continuous 0..1 envelope for the current major-event phase — rises
 *  through anticipation, peaks at impact, decays through reaction and a
 *  faint tail through recovery. Safe to read every frame from anywhere. */
export function getMajorEventEnvelope(): number {
  const s = majorEventState;
  switch (s.phase) {
    case 'anticipation':
      return (s.phaseTime / PHASE_DURATIONS.anticipation) * 0.3 * s.intensity;
    case 'impact':
      return s.intensity;
    case 'reaction':
      return s.intensity * Math.max(0, 1 - s.phaseTime / PHASE_DURATIONS.reaction);
    case 'recovery':
      return s.intensity * 0.15 * Math.max(0, 1 - s.phaseTime / PHASE_DURATIONS.recovery);
    default:
      return 0;
  }
}
