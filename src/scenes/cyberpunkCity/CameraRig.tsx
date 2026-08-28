import * as THREE from 'three';
import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import type { RouteData } from './world/routeGenerator';
import type { WorldBase } from '../shared/environment';
import { consumeBeat, consumeDrop, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import {
  applyBeatBurst,
  applyMajorLaunch,
  createSpeedState,
  speedPerceptionFrac,
  stepSpeed,
} from './world/musicController';
import { cameraMotionState } from './world/cameraMotionState';
import { characterMotionState } from './world/characterMotionState';
import { getMajorEventEnvelope } from './world/musicEventDirector';
import { WorldDirector } from './world/worldDirector';
import { cinematicState, computeShotTransform, getCinematicBlend, stepCinematicDirector } from './world/cinematicDirector';
import { useViewModeStore } from '../../state/viewModeStore';
import { useAudioStore } from '../../state/audioStore';

/**
 * Multi-environment architecture: CameraRig is genuinely environment-
 * agnostic (see the file-level comment below), so its props are its own
 * minimal shape rather than cyberpunk's `SceneProps` — `route` only needs
 * the generic `RouteData<string>` (any environment's district/region names
 * work), and `world` only needs to satisfy `WorldBase` (just
 * `landmarkPositions`, forwarded to the equally-generic cinematicDirector).
 * Cyberpunk's actual `route`/`world` objects are structurally compatible
 * with these, so CyberpunkCityScene.tsx's call site needs no changes.
 */
interface CameraRigProps {
  featureFrame: AudioFeatureFrame;
  route: RouteData<string>;
  world: WorldBase;
}

const HEAD_HEIGHT = 1.75; // first-person: the character's own eye height
const FOLLOW_DIST = 5.5; // third-person: how far behind the character
// Raised, and the look target pulled in closer/lower (see thirdPersonLook
// below) — the default chase view now looks DOWN onto the character from
// slightly above, rather than sitting level and staring far down the road.
const FOLLOW_HEIGHT = 3.3; // third-person: how far above the character
const BASE_FOV = 52;
const LOOK_AHEAD = 16;
const CHASE_LOOK_AHEAD = 3.2; // third-person look target: how far ahead of the character
const CHASE_LOOK_HEIGHT = 0.9; // third-person look target: how far above the character
const MODE_BLEND_RATE = 1.6; // per second — the third/first-person transition

// Phase 6 Stage 3: the sequence's pre-drop hold now spans two phases
// ('buildup' then 'tension') instead of the old single ~0.3s
// 'anticipation' phase — combined so the FOV-tighten/pullback cue below
// ramps smoothly across both as one continuous ≈1.9s hold rather than
// resetting partway through. Read once at module scope since
// PHASE_DURATIONS is a fixed export, not per-frame state.
const PRE_DROP_DURATION = WorldDirector.phaseDurations.buildup + WorldDirector.phaseDurations.tension;

/** Below this, a beat produces no camera reaction at all — "almost no
 *  camera movement" for normal bass. Above it, a beat qualifies as a real
 *  808/kick. Above the higher bar, it's a "very strong" hit. */
const REACT_BAR = 0.55;
const STRONG_BEAT_BAR = 0.72;
const VERY_STRONG_BAR = 0.88;

type ImpulseKind = 'forward' | 'vertical' | 'rotational' | 'fov' | 'lateral';

/** Weighted so lateral/banking — the one kind of response that reads as
 *  "side to side" — is deliberately rare. Forward/vertical/rotational/FOV
 *  share the rest, so a strong beat still visibly does *something*, just
 *  not the same angled sideways move every time. */
function pickImpulseKind(): ImpulseKind {
  const r = Math.random();
  if (r < 0.3) return 'forward';
  if (r < 0.56) return 'vertical';
  if (r < 0.8) return 'rotational';
  if (r < 0.92) return 'fov';
  return 'lateral';
}

/**
 * Owns the character's progress along the route (`t`) and the
 * music-driven speed model, publishes the resulting ground frame to
 * characterMotionState (read by Character.tsx), and frames the camera
 * either as a third-person chase shot or a first-person head position —
 * blended smoothly on toggle, never snapping.
 *
 * STRICT RULE unchanged from prior iterations: only the bass/808 detector
 * and the events built on it (`dropId`, a major event) may physically
 * move the camera. Hi-hats, snares, mid-frequency content, and spectral
 * changes are never consumed here — they drive world reactions instead.
 *
 * Every camera movement still has to come from one of three sources:
 *   A. Route choreography — curvature-driven banking, always present but
 *      kept subtle.
 *   B. Music — low-frequency events only, tiered, varied in kind.
 *   C. Cinematic transitions — the altitude dive during a major event, and
 *      the third/first-person blend itself.
 */
export function CameraRig({ featureFrame, route, world }: CameraRigProps) {
  const { camera } = useThree();
  const mode = useViewModeStore((s) => s.mode);

  const t = useRef(Math.random());
  const speed = useRef(createSpeedState()).current;
  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  const smoothedUp = useRef(new THREE.Vector3(0, 1, 0));
  const prevTangent = useRef<THREE.Vector3 | null>(null);
  // Route-curvature banking is recomputed instantaneously each frame from
  // the raw frame-to-frame tangent delta, which can carry small numerical
  // noise (spline curvature variation, dt jitter) straight into visible
  // camera roll. Easing it removes that micro-jitter without dulling the
  // beat-driven punch (which stays a separate, unsmoothed impulse below).
  const smoothedCurvatureBank = useRef(0);
  const modeBlend = useRef(mode === 'first' ? 1 : 0);
  const chaseLag = useRef<THREE.Vector3 | null>(null);
  // Phase 6 Stage 4: written by WorldDirector.getSequenceCameraShot every
  // frame, reused in place — never reallocated (see cameraShots.ts's own
  // zero-allocation discipline; this is the same pattern extended to the
  // two output vectors it writes into).
  const seqShotPos = useRef(new THREE.Vector3());
  const seqShotLook = useRef(new THREE.Vector3());

  // Decaying impulses — each a distinct kind of movement, so a reaction
  // doesn't always look like "tilt sideways".
  const impulseForward = useRef(0);
  const impulseVertical = useRef(0);
  const impulseLateral = useRef(0);
  const impulseLookX = useRef(0);
  const impulseLookY = useRef(0);
  const impactFov = useRef(0);
  const beatBank = useRef(0);
  const currentFov = useRef(BASE_FOV);
  // Phase 5 step 5: anticipationBuild itself (see below) steps from its
  // peak straight to 0 the instant the sequence leaves its pre-drop hold
  // ('buildup'/'tension') — the FOV use of it is already smoothed through
  // currentFov's own ease, but the third-person position pull-back uses it
  // directly, with no ease of its own in between. One small ease ref
  // closes that gap without touching the impulse/threshold system itself.
  const anticipationPullback = useRef(0);

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    const f = featureFrame;

    const applyImpulse = (kind: ImpulseKind, magnitude: number) => {
      switch (kind) {
        case 'forward':
          impulseForward.current = Math.max(impulseForward.current, magnitude * 0.9);
          break;
        case 'vertical':
          impulseVertical.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.7;
          break;
        case 'rotational':
          impulseLookX.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 1.4;
          impulseLookY.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.7;
          break;
        case 'fov':
          impactFov.current = Math.max(impactFov.current, magnitude * 9);
          break;
        case 'lateral':
          impulseLateral.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 1.1;
          beatBank.current += (Math.random() < 0.5 ? -1 : 1) * magnitude * 0.1;
          break;
      }
    };

    // --- Only bass/808 may physically move the camera, and only above
    // REACT_BAR — most beats are felt nowhere near the camera at all.
    const beatHit = consumeBeat(f, beatState);
    if (beatHit > REACT_BAR) {
      if (beatHit > STRONG_BEAT_BAR) applyBeatBurst(speed, beatHit);

      if (beatHit > VERY_STRONG_BAR) {
        const kindA = pickImpulseKind();
        let kindB = pickImpulseKind();
        if (kindB === kindA) kindB = pickImpulseKind();
        applyImpulse(kindA, 1.3);
        applyImpulse(kindB, 0.8);
      } else if (beatHit > STRONG_BEAT_BAR) {
        applyImpulse(pickImpulseKind(), 0.85);
      } else {
        applyImpulse(pickImpulseKind(), 0.22);
      }
    }

    // Hi-hats, snares/claps, mid content, and spectral changes are
    // deliberately NOT consumed here at all — see the file-level comment.

    const dropHit = consumeDrop(f, dropState);
    if (dropHit > 0) {
      impulseForward.current = Math.max(impulseForward.current, 1.4);
      impulseVertical.current += (Math.random() < 0.5 ? -1 : 1) * 0.6;
      impactFov.current = Math.max(impactFov.current, 15);
    }

    const seq = WorldDirector.sequence;
    const majorHit = consumeEvent(seq.impactEventId, seq.intensity, majorState);
    if (majorHit > 0) {
      applyMajorLaunch(speed, majorHit);
      impulseForward.current = Math.max(impulseForward.current, majorHit * 2.2);
      impulseLookX.current += (Math.random() < 0.5 ? -1 : 1) * majorHit * 1.6;
      impactFov.current = Math.max(impactFov.current, majorHit * 16);
    }
    const majorEnvelope = getMajorEventEnvelope();
    const altitudeDive = -majorEnvelope * 2.4;

    // Phase 4.1, extended by Phase 6 Stage 3: a small, purely additive
    // "holding breath" cue during the sequence's pre-drop hold — now
    // 'buildup' then 'tension' (≈1.9s combined, was a single ~0.3s
    // 'anticipation' phase) — a slight FOV tighten plus a barely-there
    // forward creep, both fed into the SAME existing decaying-impulse/FOV
    // mechanics below rather than any new camera system, so the actual
    // event impulse still lands as the release right after. This is what
    // turns "beat happens -> camera reacts" into "music builds -> camera
    // holds -> event lands -> camera releases" — just stretched across a
    // longer, more noticeable hold than before. Progress ramps smoothly
    // across both phases as one continuous 0..1 (see PRE_DROP_DURATION).
    const preDropElapsed =
      seq.phase === 'buildup'
        ? seq.phaseTime
        : seq.phase === 'tension'
          ? WorldDirector.phaseDurations.buildup + seq.phaseTime
          : null;
    const anticipationBuild =
      preDropElapsed !== null ? THREE.MathUtils.clamp(preDropElapsed / PRE_DROP_DURATION, 0, 1) * seq.intensity : 0;
    // Phase 5 step 5: eased copy used only for the position pull-back below
    // (see anticipationPullback's declaration) — removes the single-frame
    // step anticipationBuild itself takes the instant the phase leaves the
    // pre-drop hold, without touching the FOV use of the raw value (which
    // was already smoothed through currentFov's own ease).
    anticipationPullback.current += (anticipationBuild - anticipationPullback.current) * (1 - Math.exp(-dt * 10));

    // Phase 2: an explicit user pause should freeze the world in place —
    // not the pre-upload/post-track-end idle camera cruise (deliberately
    // NOT gated the same way), just genuinely-paused playback. Everything
    // else below (camera placement from the current/frozen `t`, mode
    // blend, orientation, FOV, first/third-person toggle) still runs every
    // frame exactly as before, so the view stays fully responsive — it
    // just stops advancing forward. Read imperatively (no subscription/
    // re-render) since this only needs a single per-frame boolean.
    const shouldAdvance = useAudioStore.getState().status !== 'paused';

    if (shouldAdvance) stepSpeed(speed, dt, f);
    cameraMotionState.speed = speed.current;
    // Shared 0..1 "how fast does this feel" fraction (see musicController's
    // speedPerceptionFrac) — reused below for both FOV and the follow-
    // distance/height adjustment, anchored to the real cruise range rather
    // than the rarely-reached MAX_SPEED_CAP so it actually moves during
    // normal play. Already smooth (derived from speed.current, itself
    // exponentially tracked in stepSpeed), so no extra easing needed here.
    const speedPerception = speedPerceptionFrac(speed.current);

    if (shouldAdvance) {
      t.current = (((t.current + (speed.current * dt) / route.length) % 1) + 1) % 1;
    }
    const frame = route.getFrameAt(t.current);

    // Publish the character's ground frame for Character.tsx to read.
    characterMotionState.t = t.current;
    characterMotionState.position.copy(frame.position);
    characterMotionState.tangent.copy(frame.tangent);
    characterMotionState.right.copy(frame.right);
    characterMotionState.up.copy(frame.up);
    characterMotionState.speed = speed.current;

    // The cinematic director decides WHEN a shot change is warranted
    // (drop / major event / landmark proximity / district transition,
    // never a timer) — the gameplay chase camera below stays the default
    // and this only ever blends briefly toward an alternate framing.
    const district = route.getDistrictInfoAt(t.current).district;
    if (shouldAdvance) {
      stepCinematicDirector(dt, f, state.clock.elapsedTime, frame.position, district, world.landmarkPositions);
    }

    const decay = Math.exp(-dt * 7);
    impulseForward.current *= decay;
    impulseVertical.current *= decay;
    impulseLateral.current *= decay;
    impulseLookX.current *= decay;
    impulseLookY.current *= decay;
    impactFov.current *= Math.exp(-dt * 8);
    beatBank.current *= Math.exp(-dt * 3.5);

    // --- Third-person chase position: behind and above the character,
    // smoothed so it lags slightly rather than rigidly tracking — a chase
    // camera, not a rigidly-attached one. Phase 5 step 2: a restrained
    // speed-scaled pull-back/rise on top of the fixed base distance/height
    // — at higher perceived speed the camera sits a bit further back and a
    // bit higher, showing more incoming road (a classic racing-game cue),
    // easing back to the tighter base framing as speed drops. Small
    // enough to stay a framing nudge, not a second FOV effect, and it
    // inherits the same chaseLag smoothing as everything else below so it
    // can't itself introduce any pop.
    const dynamicFollowDist = FOLLOW_DIST + speedPerception * 2.2;
    const dynamicFollowHeight = FOLLOW_HEIGHT + speedPerception * 0.9;
    const thirdPersonTarget = frame.position
      .clone()
      .addScaledVector(frame.tangent, -dynamicFollowDist)
      .addScaledVector(frame.right, impulseLateral.current * 0.5)
      .addScaledVector(frame.up, dynamicFollowHeight + altitudeDive * 0.5 + impulseVertical.current * 0.5);
    if (!chaseLag.current) chaseLag.current = thirdPersonTarget.clone();
    chaseLag.current.lerp(thirdPersonTarget, 1 - Math.exp(-dt * 5));
    const thirdPersonPos = chaseLag.current
      .clone()
      .addScaledVector(frame.tangent, impulseForward.current * 0.6 - anticipationPullback.current * 0.35);

    // --- First-person head position: exactly at the character's eyes.
    const firstPersonPos = frame.position
      .clone()
      .addScaledVector(frame.tangent, impulseForward.current)
      .addScaledVector(frame.right, impulseLateral.current)
      .addScaledVector(frame.up, HEAD_HEIGHT + altitudeDive + impulseVertical.current);

    const modeTarget = mode === 'first' ? 1 : 0;
    modeBlend.current += (modeTarget - modeBlend.current) * (1 - Math.exp(-MODE_BLEND_RATE * dt));

    let position = thirdPersonPos.clone().lerp(firstPersonPos, modeBlend.current);

    // Cinematic shots only ever apply on top of third-person — first-person
    // stays exactly as stable as before (this iteration deliberately
    // doesn't touch it).
    const cineBlend = getCinematicBlend() * (1 - modeBlend.current);
    let cinematicLook: THREE.Vector3 | null = null;
    if (cineBlend > 0) {
      const shot = computeShotTransform(
        cinematicState.shot,
        frame.position,
        frame.tangent,
        frame.right,
        frame.up,
        cinematicState.targetPosition
      );
      position = position.clone().lerp(shot.position, cineBlend);
      cinematicLook = shot.look;
    }

    // Phase 6 Stage 4: the major-event sequence's own moving camera shot
    // (dolly/orbit/sweep — see cameraShots.ts) — WorldDirector decides
    // WHICH primitive and WHEN (a pure function of the sequence's phase/
    // elapsed time), this only applies the result. Deliberately yields to
    // an active cinematicDirector cut via `(1 - cineBlend)`: the two
    // systems would otherwise fight for the camera during the brief window
    // right at the drop, when cinematicDirector's own existing landmark/
    // dramatic-close shot is already framing the release. The sequence
    // shot fades back in smoothly as that cut's own blend fades out (both
    // use eased envelopes), so control hands off without a snap — see
    // PLAN.md for the exact timing this relies on. Also yields to
    // first-person via `(1 - modeBlend)`, matching every other cinematic
    // effect in this file.
    const seqBlendRaw = WorldDirector.getSequenceCameraShot(
      frame.position,
      frame.tangent,
      frame.right,
      frame.up,
      world.landmarkPositions,
      seqShotPos.current,
      seqShotLook.current
    );
    const seqBlend = seqBlendRaw * (1 - cineBlend) * (1 - modeBlend.current);
    let seqLook: THREE.Vector3 | null = null;
    if (seqBlend > 0) {
      position = position.clone().lerp(seqShotPos.current, seqBlend);
      seqLook = seqShotLook.current;
    }
    camera.position.copy(position);

    // --- Orientation: stable, world-up-referenced, never a Frenet frame.
    smoothedUp.current.lerp(frame.up, 1 - Math.exp(-dt * 3)).normalize();

    let rawCurvatureBank = 0;
    if (prevTangent.current) {
      const cross = new THREE.Vector3().crossVectors(prevTangent.current, frame.tangent);
      const turnRate = cross.y / Math.max(dt, 1e-4);
      const energyScale = 0.45 + 0.3 * f.energy;
      const majorScale = 1 + majorEnvelope * 1.6;
      const bankLimit = 0.18 * majorScale;
      rawCurvatureBank = THREE.MathUtils.clamp(-turnRate * 0.07 * energyScale * majorScale, -bankLimit, bankLimit);
    }
    prevTangent.current = frame.tangent.clone();
    smoothedCurvatureBank.current += (rawCurvatureBank - smoothedCurvatureBank.current) * (1 - Math.exp(-dt * 8));

    // Third-person stays level (a chase cam banking with the road reads as
    // nauseating); only first-person inherits the route's bank.
    const bank = THREE.MathUtils.clamp((smoothedCurvatureBank.current + beatBank.current) * modeBlend.current, -0.5, 0.5);
    const bankedUp = smoothedUp.current.clone().applyAxisAngle(frame.tangent, bank);
    camera.up.copy(bankedUp);

    const lookXClamped = THREE.MathUtils.clamp(impulseLookX.current, -6, 6);
    const lookYClamped = THREE.MathUtils.clamp(impulseLookY.current, -4, 4);

    // Third-person looks toward the character (slightly ahead, roughly
    // torso height) so they stay framed; first-person looks straight
    // ahead down the route, nudged by the rotational "glance" impulse.
    const thirdPersonLook = frame.position
      .clone()
      .addScaledVector(frame.tangent, CHASE_LOOK_AHEAD)
      .addScaledVector(frame.up, CHASE_LOOK_HEIGHT);
    const firstPersonLook = position
      .clone()
      .addScaledVector(frame.tangent, LOOK_AHEAD)
      .addScaledVector(frame.right, lookXClamped)
      .addScaledVector(frame.up, lookYClamped);
    let lookTarget = thirdPersonLook.clone().lerp(firstPersonLook, modeBlend.current);
    if (cinematicLook) lookTarget = lookTarget.clone().lerp(cinematicLook, cineBlend);
    if (seqLook) lookTarget = lookTarget.clone().lerp(seqLook, seqBlend);
    camera.lookAt(lookTarget);

    // --- FOV: base + speed-driven widening (a classic speed cue, tied to
    // actual travel speed) + the FOV impulse on top, with a slight
    // anticipation-phase tighten right before a major event lands (see
    // anticipationBuild above) — the lens visibly holds/narrows for a beat,
    // then the event's own impactFov burst releases it outward. Phase 5
    // step 2: now driven by speedPerception (anchored to the real cruise
    // range, computed once above) instead of a raw fraction of
    // MAX_SPEED_CAP — previously cruise speed only ever reached ~7-25% of
    // that denominator, so this widening was almost invisible during
    // normal play; now a full-energy cruise alone reaches a clearly
    // perceptible widen, with a bit more still available for drop bursts.
    const targetFov = BASE_FOV + speedPerception * 14 + impactFov.current - anticipationBuild * 4.5;
    currentFov.current += (targetFov - currentFov.current) * (1 - Math.exp(-dt * 9));
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = currentFov.current;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
