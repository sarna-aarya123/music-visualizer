import * as THREE from 'three';
import type { MajorEventPhase, MajorEventState } from './musicEventDirector';

/**
 * The major-event sequence's cinematic camera — "hero shot or nothing"
 * (Stage 8, the fifth pass on this area).
 *
 * WHAT IT DOES NOW: on a major event, IF a signature landmark (pyramids,
 * whale, ferris wheel, rings, giant mushrooms…) sits in the framing band
 * [`MIN_TARGET_DIST`, `MAX_TARGET_DIST`] from the character when the
 * sequence leaves `idle`, lock onto it and, for the `drop`+`transform`
 * window (~3.5s), cut to ONE composed `heroFrame` shot: camera behind the
 * character on the line from that landmark, lifted — landmark beyond,
 * character in the foreground, both in frame, a slow settle in, no orbit
 * or sweep. Then the chase cam has it back.
 *
 * IF NO LANDMARK IS IN THE BAND: `getSequenceCameraShot` returns 0 for
 * every phase — the plain third-person chase cam holds through the whole
 * sequence. There is deliberately no "dynamic move around the character"
 * fallback: an always-on camera move that frames nothing was exactly what
 * four prior tuning passes kept failing on.
 *
 * Pure math, no rendering. `getSequenceCameraShot()` writes a position and
 * look target into caller-owned vectors and returns a 0..1 blend weight;
 * `CameraRig` is the only thing that touches `camera.*` and composes this
 * with the mode blend + the Stage-7 environment-clearance pass (which runs
 * while this weight is non-zero, so the hero shot can't clip geometry).
 *
 * `SEQUENCE_CAMERA_ENABLED = false` kills it entirely (chase cam always).
 * The locked target is cleared by `resetSequenceCameraShot()` (from
 * `WorldDirector.reset()`) on seek/new-track.
 *
 * Zero per-frame allocation: every vector below is a module-level scratch
 * object mutated in place, never `.clone()`.
 *
 * The `push`/`orbit`/`sweep` primitives and their `pivotWeight`/
 * `lookWeight` char↔landmark blends (Stages 4/6) are kept as dead code
 * below — no `SHOT_TABLE` entry uses them now.
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
    }
  /** The one shot this file fires now (Stage 8 — "hero shot or nothing").
   *  Camera sits behind the character ON THE LINE from the locked landmark,
   *  lifted: the landmark reads BEYOND the character, the character sits in
   *  the foreground for scale, and both are in frame by construction. No
   *  orbit, no lateral sweep — a slow settle only. `distFrom`/`distTo` ease
   *  within the phase; `lookWeight` biases the look-at from character (0)
   *  toward landmark (1). Only ever used when a real landmark is locked (see
   *  the hard gate in `getSequenceCameraShot`). */
  | { kind: 'heroFrame'; distFrom: number; distTo: number; height: number; lookWeight: number };

/** Eases 0..1 with zero velocity at both ends — the same curve
 *  `cinematicDirector.ts`'s `smoothstep01` and `musicEventDirector.ts`'s
 *  aftermath decay already use, kept local here rather than imported so
 *  this file has no dependency on either. */
function ease(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Stage 8 — "hero shot or nothing". This file fires exactly ONE kind of
 * shot: `heroFrame`, and ONLY when a real signature landmark was locked
 * when the sequence started (`sequenceHasLandmark`). If nothing worth
 * framing is near, `getSequenceCameraShot` returns 0 for every phase and
 * the camera stays on the plain chase cam — there is no "character-anchored
 * dynamic move" fallback any more. That fallback (an orbit/push around the
 * character showing nothing) was exactly the "cinematic that shows nothing"
 * the user kept reporting across four prior tuning passes.
 *
 * Only `drop` + `transform` have an entry (~3.5s total). `drop` eases the
 * shot in; `transform` holds then eases out (see the envelope at the bottom
 * of `getSequenceCameraShot`). `buildup`/`tension`/`reveal`/`aftermath`
 * return 0 → plain chase cam. The `dist` creeps in slightly from `drop` to
 * `transform` for a gentle settle toward the subject.
 */
const HERO_HEIGHT = 10;
const HERO_LOOK_WEIGHT = 0.62;
const SHOT_TABLE: Partial<Record<MajorEventPhase, ShotSpec>> = {
  drop: { kind: 'heroFrame', distFrom: 32, distTo: 27, height: HERO_HEIGHT, lookWeight: HERO_LOOK_WEIGHT },
  transform: { kind: 'heroFrame', distFrom: 27, distTo: 22, height: HERO_HEIGHT, lookWeight: HERO_LOOK_WEIGHT },
};

const NEXT_PHASE: Partial<Record<MajorEventPhase, MajorEventPhase>> = {
  drop: 'transform',
};

/** Master switch. `false` = the sequence camera never engages; the camera
 *  is the plain third-person chase cam through a major event. */
const SEQUENCE_CAMERA_ENABLED = true;

/** The moving camera engages at most this often (seconds). Matches
 *  `cinematicDirector.ts`'s `MIN_GAP` so the cut and this brief move fire
 *  together on one major event, then both go quiet. */
const CINEMATIC_COOLDOWN = 20;

/** How long before a phase ends its shot starts blending toward the next
 *  phase's shot (evaluated at ITS progress 0) — guarantees no phase
 *  boundary ever snaps, regardless of how the two primitives' endpoints
 *  happen to line up numerically. */
const TRANSITION_TIME = 0.35;
/** Fraction of `transform` spent easing the shot back out to the chase cam. */
const FADE_FRACTION = 0.6;
/** The framing band: a locked landmark must sit within
 *  [MIN_TARGET_DIST, MAX_TARGET_DIST] of the character when the sequence
 *  starts. Nearer than the floor and the camera would already be on top of
 *  it (nothing to "reveal"); past the ceiling it's too small/far to be the
 *  subject. Outside the band → NO cinematic, plain chase cam. The ceiling
 *  is generous because every signature landmark is enormous (pyramids
 *  30-90u, whales 40-75u, ferris wheels 30-60u) and the character keeps
 *  running toward it during the ~3.5s shot, arriving roughly as it ends. */
const MIN_TARGET_DIST = 45;
const MAX_TARGET_DIST = 140;

// --- Locked per-sequence target -------------------------------------
const lockedTarget = new THREE.Vector3();
let hasLockedTarget = false;
let sequenceHasLandmark = false;
let wasIdle = true;
/** Wall-clock (R3F elapsed) of the last time the moving camera engaged,
 *  and whether THIS sequence is suppressed because the cooldown hadn't
 *  elapsed when it started. */
let lastEngageTime = -999;
let suppressedThisSequence = false;

/** Nearest landmark within the framing band [minDist, maxDist]. Anything
 *  closer than `minDist` is skipped (the camera is already on top of it),
 *  so this can return a farther landmark over a very close one. */
function findNearestLandmark(
  pos: THREE.Vector3,
  landmarks: THREE.Vector3[],
  minDist: number,
  maxDist: number
): THREE.Vector3 | null {
  let best: THREE.Vector3 | null = null;
  let bestDist = maxDist;
  for (const p of landmarks) {
    const dist = pos.distanceTo(p);
    if (dist >= minDist && dist < bestDist) {
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
  sequenceHasLandmark = false;
  wasIdle = true;
  lastEngageTime = -999;
  suppressedThisSequence = false;
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
  pivotW: number,
  lookW: number,
  tangent: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  outPosition: THREE.Vector3,
  outLook: THREE.Vector3
): void {
  const t = ease(progress);
  // `heroFrame` (the only kind fired now) ignores `pivotW`/`lookW` and
  // reads its own `lookWeight`. The push/orbit/sweep cases below are dead
  // code kept for the type/shape; they still use the character<->landmark
  // pivot blend.
  scratchPivot.copy(characterPos).lerp(target, pivotW);
  scratchLookPoint.copy(characterPos).lerp(target, lookW);
  switch (spec.kind) {
    case 'heroFrame': {
      // Direction FROM the landmark TO the character, flattened to XZ so
      // the vertical offset is purely `height`. Camera sits that way past
      // the character: landmark beyond, character in the foreground for
      // scale, both in frame by construction. Degenerate only if the
      // character is exactly on the landmark — fall back to straight
      // behind.
      scratchDir.copy(characterPos).sub(target);
      scratchDir.y = 0;
      if (scratchDir.lengthSq() < 1e-4) scratchDir.copy(tangent).multiplyScalar(-1);
      scratchDir.normalize();
      const heroDist = THREE.MathUtils.lerp(spec.distFrom, spec.distTo, t);
      outPosition
        .copy(characterPos)
        .addScaledVector(scratchDir, heroDist)
        .addScaledVector(up, spec.height);
      outLook.copy(characterPos).lerp(target, spec.lookWeight);
      break;
    }
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
  elapsed: number,
  characterPos: THREE.Vector3,
  tangent: THREE.Vector3,
  right: THREE.Vector3,
  up: THREE.Vector3,
  landmarks: THREE.Vector3[],
  outPosition: THREE.Vector3,
  outLook: THREE.Vector3
): number {
  if (!SEQUENCE_CAMERA_ENABLED) {
    // Keep the idle-edge tracker current so a future re-enable doesn't
    // mis-fire on a sequence that's already mid-flight.
    wasIdle = seq.phase === 'idle';
    return 0;
  }

  const isIdle = seq.phase === 'idle';

  // Edge-triggered, once per sequence: decide whether the moving camera is
  // allowed to engage at all (cooldown), and lock its framing target.
  if (wasIdle && !isIdle) {
    suppressedThisSequence = elapsed - lastEngageTime < CINEMATIC_COOLDOWN;
    if (!suppressedThisSequence) lastEngageTime = elapsed;

    // Hero shot or nothing: lock onto the nearest landmark in the framing
    // band, or mark this sequence as having none (→ the chase cam holds
    // for the whole sequence, no cinematic).
    const nearest = findNearestLandmark(characterPos, landmarks, MIN_TARGET_DIST, MAX_TARGET_DIST);
    if (nearest) {
      lockedTarget.copy(nearest);
      sequenceHasLandmark = true;
    } else {
      lockedTarget.copy(characterPos);
      sequenceHasLandmark = false;
    }
    hasLockedTarget = true;
  }
  wasIdle = isIdle;

  if (isIdle || !hasLockedTarget || suppressedThisSequence) return 0;
  // No landmark was in the framing band when this sequence started → no
  // cinematic at all. This is the whole point of the Stage 8 rework: the
  // camera never leaves the character unless there is something worth
  // cutting to.
  if (!sequenceHasLandmark) return 0;

  // Only `drop` + `transform` engage — every other phase keeps the plain
  // chase camera (there is no SHOT_TABLE entry, so `spec` is undefined).
  const spec = SHOT_TABLE[seq.phase];
  if (!spec) return 0;

  const duration = phaseDurations[seq.phase as Exclude<MajorEventPhase, 'idle'>];
  const progress = duration > 0 ? THREE.MathUtils.clamp(seq.phaseTime / duration, 0, 1) : 1;

  // `heroFrame` reads its own weights; the 0/0 here are the unused
  // pivot/look blends for the dead push/orbit/sweep kinds.
  evaluateShot(spec, progress, characterPos, lockedTarget, 0, 0, tangent, right, up, outPosition, outLook);

  // Cross-fade toward the next phase's shot (at its own progress 0) in the
  // last TRANSITION_TIME seconds of this one, so no phase boundary snaps.
  const nextPhase = NEXT_PHASE[seq.phase];
  const timeLeft = duration - seq.phaseTime;
  if (nextPhase && timeLeft < TRANSITION_TIME) {
    const nextSpec = SHOT_TABLE[nextPhase];
    if (nextSpec) {
      evaluateShot(nextSpec, 0, characterPos, lockedTarget, 0, 0, tangent, right, up, nextPos, nextLook);
      const mix = ease(1 - timeLeft / TRANSITION_TIME);
      outPosition.lerp(nextPos, mix);
      outLook.lerp(nextLook, mix);
    }
  }

  // Envelope: ease in across the short `drop` phase, hold through most of
  // `transform`, ease back out over its last stretch — a clear ~3.5s
  // beginning/middle/end, then the chase camera has it back.
  let envelope = 1;
  if (seq.phase === 'drop') {
    envelope = ease(progress);
  } else if (seq.phase === 'transform') {
    const fadeStart = 1 - FADE_FRACTION;
    envelope = progress <= fadeStart ? 1 : 1 - ease((progress - fadeStart) / FADE_FRACTION);
  }
  return envelope;
}
