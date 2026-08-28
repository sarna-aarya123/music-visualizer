import * as THREE from 'three';
import type { MajorEventPhase, MajorEventState } from './musicEventDirector';

/**
 * Phase 6 Stage 4 — moving camera shots for the major-event sequence
 * (Stage 3's buildup -> tension -> drop -> transform -> reveal ->
 * aftermath). Three reusable, parameterised motion primitives rather than
 * one bespoke function per named shot in the brief — "dolly-in"/"dolly-
 * out reveal" are both `push` (sign of the distance delta), "flyby",
 * "sweeping aerial", and "ground-level pass" are all `sweep` at different
 * height/lateral parameters, `orbit` is `orbit`.
 *
 * Pure math, no rendering: `getSequenceCameraShot()` is the single entry
 * point `WorldDirector` delegates to (this is the "what shot + when"
 * decision — the phase -> `ShotSpec` table below), writing a position and
 * look target into caller-owned output vectors and returning a 0..1 blend
 * weight. `CameraRig` is the only thing that ever touches `camera.*`
 * directly — it decides how this weight composes with everything else
 * (mode blend, the existing cinematicDirector cut) and applies the result.
 *
 * Target: locked once per sequence (the nearest landmark to the character
 * at the moment the sequence starts, or a point ahead along the route if
 * none is close) rather than re-picked every frame — the shot math treats
 * `target` as a fixed point for the whole ~13s sequence, so a nearest-
 * landmark search that could flip mid-sequence as the character runs past
 * would make every primitive's framing jump. Locking is edge-triggered off
 * `MajorEventState.phase` leaving `'idle'`, and cleared by
 * `resetSequenceCameraShot()` (called from `WorldDirector.reset()`) on
 * seek/new-track, matching this project's established reset pattern.
 *
 * Zero per-frame allocation in the hot path: every vector below is a
 * module-level scratch object mutated in place (`.copy()`/
 * `.addScaledVector()`/`.applyAxisAngle()`, never `.clone()`).
 *
 * Phase 6 Stage 6: every shot's position and look-at are each a blend
 * between the character's own current position and the locked landmark
 * target — `pivotWeight`/`lookWeight` below (0 = character, 1 =
 * landmark). This replaced an earlier version where every primitive
 * always positioned around AND looked at the locked landmark, full stop
 * — the character was read only once, to help pick that landmark, and
 * never touched again. That made the character fall out of frame for
 * most of a sequence two ways at once: the look-at never pointed at them,
 * and because the pivot was a single static point while the character
 * kept running, they drifted away from it as the sequence went on. Using
 * `characterPos` (continuously updated every frame, unlike the locked
 * target) as part of the pivot fixes both — most phases are now
 * character-anchored with a landmark bias for direction/energy, not
 * landmark-anchored with the character as an afterthought. See
 * `PLAN.md` §10 for the full diagnosis and per-phase intent this
 * implements.
 */

type ShotSpec =
  | { kind: 'push'; distStart: number; distEnd: number; height: number; lateral: number; pivotWeight: number; lookWeight: number }
  | { kind: 'orbit'; radius: number; height: number; angleStart: number; angleSpan: number; pivotWeight: number; lookWeight: number }
  | {
      kind: 'sweep';
      alongStart: number;
      alongEnd: number;
      lateralStart: number;
      lateralEnd: number;
      height: number;
      pivotWeight: number;
      lookWeight: number;
    };

/** Eases 0..1 with zero velocity at both ends — the same curve
 *  `cinematicDirector.ts`'s `smoothstep01` and `musicEventDirector.ts`'s
 *  aftermath decay already use, kept local here rather than imported so
 *  this file has no dependency on either. */
function ease(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Buildup: a slow push that trails the character from far back, closing
 *  in — an epic "camera catching up" read, character as anchor, whatever
 *  landmark is ahead visible as they run toward it. Tension: a mostly
 *  character-pivoted orbit — "the camera is waiting with them" — with
 *  just enough landmark bias in the look to feel like anticipation, not
 *  a plain follow-cam. Drop: a fast character-centered punch-in (mostly
 *  hidden behind the existing cinematicDirector cut, which takes priority
 *  — see CameraRig; kept as a real shot rather than a no-op so the system
 *  still does something sensible on the rare frame the cut isn't active).
 *  Transform: a sweep still anchored mostly on the character, with more
 *  landmark bias than buildup/tension — "flying around the character
 *  while the world changes around them". Reveal: THE phase where
 *  landmark focus is intentional — but the position pivot stays fairly
 *  character-anchored (so they stay legible as a foreground/scale
 *  reference) while the look-at swings mostly toward the landmark being
 *  revealed. Aftermath: pivot and look both swing back toward the
 *  character — "attention returns to them" as the sequence winds down. */
const SHOT_TABLE: Partial<Record<MajorEventPhase, ShotSpec>> = {
  buildup: { kind: 'push', distStart: 46, distEnd: 27, height: 11, lateral: 9, pivotWeight: 0.2, lookWeight: 0.15 },
  tension: { kind: 'orbit', radius: 25, height: 9, angleStart: 0.5, angleSpan: 0.65, pivotWeight: 0.15, lookWeight: 0.2 },
  drop: { kind: 'push', distStart: 20, distEnd: 12, height: 6, lateral: -4, pivotWeight: 0.3, lookWeight: 0.25 },
  transform: {
    kind: 'sweep',
    alongStart: -34,
    alongEnd: 30,
    lateralStart: -22,
    lateralEnd: 20,
    height: 16,
    pivotWeight: 0.35,
    lookWeight: 0.3,
  },
  reveal: { kind: 'push', distStart: 22, distEnd: 48, height: 14, lateral: -12, pivotWeight: 0.25, lookWeight: 0.7 },
  aftermath: { kind: 'orbit', radius: 30, height: 12, angleStart: -0.3, angleSpan: 0.4, pivotWeight: 0.15, lookWeight: 0.1 },
};

const NEXT_PHASE: Partial<Record<MajorEventPhase, MajorEventPhase>> = {
  buildup: 'tension',
  tension: 'drop',
  drop: 'transform',
  transform: 'reveal',
  reveal: 'aftermath',
};

/** How long before a phase ends its shot starts blending toward the next
 *  phase's shot (evaluated at ITS progress 0) — guarantees no phase
 *  boundary ever snaps, regardless of how the two primitives' endpoints
 *  happen to line up numerically. */
const TRANSITION_TIME = 0.35;
/** Fraction of `buildup` spent easing the whole shot system in from
 *  nothing, and of `aftermath` spent easing it back out to nothing. */
const FADE_FRACTION = 0.6;
/** Landmarks farther than this from the character when a sequence starts
 *  aren't a sensible thing to frame — falls back to a point ahead along
 *  the route instead. */
const MAX_TARGET_DIST = 90;
const FALLBACK_AHEAD_DIST = 40;

// --- Locked per-sequence target -------------------------------------
const lockedTarget = new THREE.Vector3();
let hasLockedTarget = false;
let wasIdle = true;

function findNearestLandmark(pos: THREE.Vector3, landmarks: THREE.Vector3[], maxDist: number): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestDist = maxDist;
  for (const p of landmarks) {
    const dist = pos.distanceTo(p);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/** Clears the locked target and phase-edge tracking — called from
 *  `WorldDirector.reset()` on new track load or a seek, so a target
 *  locked against the previous playback position can't leak into the
 *  next one. */
export function resetSequenceCameraShot(): void {
  lockedTarget.set(0, 0, 0);
  hasLockedTarget = false;
  wasIdle = true;
}

// --- Zero-allocation scratch state -----------------------------------
const scratchDir = new THREE.Vector3();
const scratchPivot = new THREE.Vector3();
const scratchLookPoint = new THREE.Vector3();
const nextPos = new THREE.Vector3();
const nextLook = new THREE.Vector3();

function evaluateShot(
  spec: ShotSpec,
  progress: number,
  characterPos: THREE.Vector3,
  target: THREE.Vector3,
  tangent: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  outPosition: THREE.Vector3,
  outLook: THREE.Vector3
): void {
  const t = ease(progress);
  // Position pivots around a character<->landmark blend (not always the
  // landmark) and the look-at is its OWN independent blend — see the
  // file-level comment. Decoupling the two is what lets `reveal` keep
  // the character legible as a foreground/scale reference (low
  // pivotWeight) while still swinging the look-at mostly onto the
  // landmark being revealed (high lookWeight).
  scratchPivot.copy(characterPos).lerp(target, spec.pivotWeight);
  scratchLookPoint.copy(characterPos).lerp(target, spec.lookWeight);
  switch (spec.kind) {
    case 'push': {
      const dist = THREE.MathUtils.lerp(spec.distStart, spec.distEnd, t);
      outPosition
        .copy(scratchPivot)
        .addScaledVector(tangent, -dist)
        .addScaledVector(up, spec.height)
        .addScaledVector(right, spec.lateral);
      outLook.copy(scratchLookPoint);
      break;
    }
    case 'orbit': {
      const angle = spec.angleStart + spec.angleSpan * t;
      scratchDir.copy(right).applyAxisAngle(up, angle).normalize();
      outPosition.copy(scratchPivot).addScaledVector(scratchDir, spec.radius).addScaledVector(up, spec.height);
      outLook.copy(scratchLookPoint);
      break;
    }
    case 'sweep': {
      const along = THREE.MathUtils.lerp(spec.alongStart, spec.alongEnd, t);
      const lateral = THREE.MathUtils.lerp(spec.lateralStart, spec.lateralEnd, t);
      outPosition
        .copy(scratchPivot)
        .addScaledVector(tangent, along)
        .addScaledVector(right, lateral)
        .addScaledVector(up, spec.height);
      outLook.copy(scratchLookPoint);
      break;
    }
  }
}

/**
 * The single entry point `WorldDirector.getSequenceCameraShot` delegates
 * to. Returns the blend weight (0 = no shot active, caller should ignore
 * `outPosition`/`outLook`) for the current point in the major-event
 * sequence, having already written this frame's shot position/look into
 * the supplied output vectors.
 */
export function getSequenceCameraShot(
  seq: Readonly<MajorEventState>,
  phaseDurations: Record<Exclude<MajorEventPhase, 'idle'>, number>,
  characterPos: THREE.Vector3,
  tangent: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  landmarks: THREE.Vector3[],
  outPosition: THREE.Vector3,
  outLook: THREE.Vector3
): number {
  const isIdle = seq.phase === 'idle';

  // Edge-triggered lock: the instant the sequence leaves 'idle', pick and
  // freeze a target for its whole duration.
  if (wasIdle && !isIdle) {
    const nearest = findNearestLandmark(characterPos, landmarks, MAX_TARGET_DIST);
    if (nearest) {
      lockedTarget.copy(nearest);
    } else {
      lockedTarget.copy(characterPos).addScaledVector(tangent, FALLBACK_AHEAD_DIST);
    }
    hasLockedTarget = true;
  }
  wasIdle = isIdle;

  if (isIdle || !hasLockedTarget) return 0;

  const spec = SHOT_TABLE[seq.phase];
  if (!spec) return 0;

  const duration = phaseDurations[seq.phase as Exclude<MajorEventPhase, 'idle'>];
  const progress = duration > 0 ? THREE.MathUtils.clamp(seq.phaseTime / duration, 0, 1) : 1;

  evaluateShot(spec, progress, characterPos, lockedTarget, tangent, right, up, outPosition, outLook);

  // Cross-fade toward the next phase's shot (at its own progress 0) in the
  // last TRANSITION_TIME seconds of this one, so no phase boundary snaps.
  const nextPhase = NEXT_PHASE[seq.phase];
  const timeLeft = duration - seq.phaseTime;
  if (nextPhase && timeLeft < TRANSITION_TIME) {
    const nextSpec = SHOT_TABLE[nextPhase];
    if (nextSpec) {
      evaluateShot(nextSpec, 0, characterPos, lockedTarget, tangent, right, up, nextPos, nextLook);
      const mix = ease(1 - timeLeft / TRANSITION_TIME);
      outPosition.lerp(nextPos, mix);
      outLook.lerp(nextLook, mix);
    }
  }

  // Envelope: eases the whole system in over the first part of `buildup`
  // and back out over the last part of `aftermath` — a clear beginning
  // and end, not an instant appear/disappear.
  let envelope = 1;
  if (seq.phase === 'buildup') {
    envelope = ease(Math.min(1, progress / FADE_FRACTION));
  } else if (seq.phase === 'aftermath') {
    const fadeStart = 1 - FADE_FRACTION;
    envelope = progress <= fadeStart ? 1 : 1 - ease((progress - fadeStart) / FADE_FRACTION);
  }
  return envelope;
}
