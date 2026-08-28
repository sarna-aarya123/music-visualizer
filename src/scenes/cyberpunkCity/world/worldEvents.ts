import * as THREE from 'three';
import type { AnimatedInstances } from '../../shared/OutlinedInstances';
import type { MajorEventPhase } from './musicEventDirector';
import { WorldDirector } from './worldDirector';

/**
 * Phase 6 Stage 5 — world event archetypes: the reusable behaviors
 * `PLAN.md` §6 proposed, actually wired up. Architecture, per this stage's
 * brief:
 *
 *   WorldDirector  -> decides WHEN (already true: it owns `sequence`,
 *                      the phase/timing every event below is keyed off)
 *   this file       -> the "world event executor": generic, reusable
 *                      per-instance transform math, no knowledge of any
 *                      particular world
 *   world data      -> `EventBinding[]` lists authored per world (in
 *                      `worlds/definitions.ts` and `Islands.tsx`) that
 *                      decide WHICH existing props participate and WITH
 *                      WHAT parameters
 *
 * WorldDirector itself gains no new code this stage — it doesn't need to;
 * events are entirely a function of `WorldDirector.sequence`, which it
 * already publishes. Nothing here ever imports three.js rendering
 * concerns beyond `Matrix4` math — no scene graph, no materials, no
 * `camera.*`. `OutlinedInstances` (Stage 1) and `Islands.tsx`'s own hand-
 * rolled instance updates are the only things that ever call
 * `InstancedMesh.setMatrixAt`.
 *
 * Ten named archetypes, FOUR real evaluator functions — "generic
 * behaviors, not ten completely separate implementations":
 *
 *   RISE, SUMMON, BLOOM, SURGE, ACTIVATE, REVEAL, SWEEP  -> `riseLike`
 *     (a lift + scale envelope; SWEEP adds a per-index stagger so the
 *     same envelope reads as a wave through the group instead of
 *     everyone moving in lockstep)
 *   SPIN_UP                                              -> `spinUp`
 *   SCATTER_REFORM                                       -> `scatterReform`
 *   FLYOVER — NOT wired into any world binding this stage. It would be a
 *     translate-across variant of the same primitives applied to a single
 *     instance, but no world has an existing standalone "flying object"
 *     prop to reuse without adding new geometry (explicitly out of scope)
 *     — see PLAN.md's Stage 5 write-up for the full reasoning. The type
 *     exists for completeness/future use, not as a gap left silently.
 *
 * Determinism: every evaluator is a pure function of
 * (base transform, the sequence's own phase/phaseTime, static params,
 * instance index). No `Math.random()`, no per-frame or per-trigger
 * seeding — `SCATTER_REFORM`'s per-instance jitter comes from a cheap
 * deterministic hash of the index (`pseudoRandom` below), so the same
 * instance always scatters to the same offset, every playthrough, every
 * replay, with zero allocated state to reset.
 *
 * Zero per-frame allocation: every vector/quaternion below is a
 * module-level scratch object, mutated via `.decompose()`/`.compose()`/
 * `.multiply()`/`.setFromAxisAngle()` — never `.clone()`.
 */

export type EventArchetype =
  | 'RISE'
  | 'ACTIVATE'
  | 'SPIN_UP'
  | 'SCATTER_REFORM'
  | 'SWEEP'
  | 'FLYOVER'
  | 'SUMMON'
  | 'BLOOM'
  | 'SURGE'
  | 'REVEAL';

/** A flexible param bag — only the fields the archetype's evaluator
 *  actually reads are meaningful for a given binding; the rest are
 *  ignored. Simpler than a discriminated union per archetype for what is,
 *  in practice, four evaluator shapes reused across ten names. */
export interface EventParams {
  /** riseLike family: world-space Y offset from the base transform's own
   *  position, eased from `liftFrom` (at phase-local progress 0) to
   *  `liftTo` (at progress 1). */
  liftFrom?: number;
  liftTo?: number;
  /** riseLike family: uniform scale multiplier on the base transform's
   *  own scale, eased the same way. */
  scaleFrom?: number;
  scaleTo?: number;
  /** SWEEP only: fraction of the phase spent staggering across the group
   *  (0 = everyone moves together, close to 1 = strongly one-at-a-time).
   *  Larger groups read as a travelling wave; see `staggeredProgress`. */
  stagger?: number;
  /** SPIN_UP only: constant angular rate (radians/second) around the
   *  instance's own local up axis, integrated over the CURRENT PHASE'S
   *  own `phaseTime` only. A SPIN_UP binding must stay within a single
   *  phase — never span two — or the angle would reset to 0 at the next
   *  phase's boundary (phaseTime itself resets there). This is the same
   *  "never `elapsed * rate`" hazard `HANDOFF.md` flags, sidestepped by
   *  keeping `rate` genuinely constant for the binding's one phase rather
   *  than letting it (or the base it's integrated against) change
   *  mid-integration. */
  spinRate?: number;
  /** SCATTER_REFORM only: how far instances scatter from their base
   *  position/how many extra spins they make while reforming. */
  scatterRadius?: number;
  scatterHeight?: number;
  scatterSpins?: number;
}

export interface EventBinding {
  phase: Exclude<MajorEventPhase, 'idle'>;
  archetype: EventArchetype;
  params: EventParams;
}

// --- Zero-allocation scratch state -----------------------------------
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchExtraQuat = new THREE.Quaternion();
const scratchOffset = new THREE.Vector3();
const UP_AXIS = new THREE.Vector3(0, 1, 0);

function ease(t: number): number {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Cheap deterministic pseudo-random in [0,1) from an integer — the
 *  classic shader-style sine hash. No state, no allocation, same input
 *  always gives the same output (which is the point: `SCATTER_REFORM`
 *  needs per-instance variety, not per-frame or per-trigger variety). */
function pseudoRandom(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Maps [0,1] phase progress to a per-instance-staggered [0,1], so a
 *  group reads as a wave travelling through it rather than moving in
 *  lockstep. `rank` is the instance's position within the participating
 *  set (0..count-1), NOT its raw index into the group's full matrices. */
function staggeredProgress(progress: number, rank: number, count: number, stagger: number): number {
  if (count <= 1 || stagger <= 0) return progress;
  const start = (rank / Math.max(1, count - 1)) * stagger;
  const span = Math.max(0.0001, 1 - stagger);
  return THREE.MathUtils.clamp((progress - start) / span, 0, 1);
}

/** RISE / SUMMON / BLOOM / SURGE / ACTIVATE / REVEAL / SWEEP's shared
 *  math: lift + scale, eased. Exported directly (alongside `EventParams`)
 *  for `floatingIslands/Islands.tsx`, which hand-rolls its own instance
 *  updates rather than going through `OutlinedInstances`/
 *  `createSignatureEventAnimated` (see that file for why) but still wants
 *  the exact same, already-tuned rise/lift math for its own signature
 *  event rather than a second reimplementation.
 *
 *  `phaseTime` is only used when `params.spinRate` is set — lets a
 *  riseLike-family binding ALSO rotate (e.g. Desert Dream's pyramids
 *  "rise and rotate") without a second evaluator pass. Same single-phase
 *  caveat as `spinUp` below: only bind `spinRate` on a phase this group
 *  doesn't also carry a spin into from the previous phase. */
export function riseLike(
  base: THREE.Matrix4,
  progress: number,
  phaseTime: number,
  params: EventParams,
  out: THREE.Matrix4
): void {
  const t = ease(progress);
  base.decompose(scratchPos, scratchQuat, scratchScale);
  const lift = THREE.MathUtils.lerp(params.liftFrom ?? 0, params.liftTo ?? 0, t);
  const scaleMul = THREE.MathUtils.lerp(params.scaleFrom ?? 1, params.scaleTo ?? 1, t);
  scratchPos.y += lift;
  scratchScale.multiplyScalar(scaleMul);
  if (params.spinRate) {
    scratchExtraQuat.setFromAxisAngle(UP_AXIS, params.spinRate * phaseTime);
    scratchQuat.multiply(scratchExtraQuat);
  }
  out.compose(scratchPos, scratchQuat, scratchScale);
}

/** SPIN_UP: a constant-rate rotation around the instance's own local up
 *  axis, composed so it spins in the geometry's own original frame
 *  (correct even for a base transform that's itself tilted — e.g. Outer
 *  Dimension's rings) rather than around world-Y. */
function spinUp(base: THREE.Matrix4, phaseTime: number, params: EventParams, out: THREE.Matrix4): void {
  base.decompose(scratchPos, scratchQuat, scratchScale);
  const angle = (params.spinRate ?? 2.2) * phaseTime;
  scratchExtraQuat.setFromAxisAngle(UP_AXIS, angle);
  scratchQuat.multiply(scratchExtraQuat);
  out.compose(scratchPos, scratchQuat, scratchScale);
}

/** SCATTER_REFORM: at progress 0 each instance sits at a deterministic
 *  scattered offset (own angle/radius/height from `pseudoRandom(index)`)
 *  with extra spin; eases back to exactly the base transform by
 *  progress 1 — "assembling out of chaos". */
function scatterReform(base: THREE.Matrix4, progress: number, params: EventParams, index: number, out: THREE.Matrix4): void {
  const t = ease(progress);
  base.decompose(scratchPos, scratchQuat, scratchScale);
  const radius = params.scatterRadius ?? 8;
  const height = params.scatterHeight ?? 5;
  const a = pseudoRandom(index * 3 + 1) * Math.PI * 2;
  const r = radius * (0.5 + pseudoRandom(index * 3 + 2) * 0.5);
  const h = (pseudoRandom(index * 3 + 3) - 0.5) * height;
  scratchOffset.set(Math.cos(a) * r, h, Math.sin(a) * r);
  scratchPos.addScaledVector(scratchOffset, 1 - t);
  const spins = params.scatterSpins ?? 1;
  scratchExtraQuat.setFromAxisAngle(UP_AXIS, (1 - t) * Math.PI * 2 * spins);
  scratchQuat.multiply(scratchExtraQuat);
  out.compose(scratchPos, scratchQuat, scratchScale);
}

/** Dispatches one binding for one instance at the sequence's current
 *  phase/phaseTime. `rank`/`count` are the instance's position within the
 *  participating set (for SWEEP's stagger) — pass `indices.indexOf(index)`
 *  and `indices.length` (see `createSignatureEventAnimated`). */
function evaluateBinding(
  binding: EventBinding,
  base: THREE.Matrix4,
  index: number,
  rank: number,
  count: number,
  progress: number,
  phaseTime: number,
  out: THREE.Matrix4
): void {
  switch (binding.archetype) {
    case 'SPIN_UP':
      spinUp(base, phaseTime, binding.params, out);
      return;
    case 'SCATTER_REFORM':
      scatterReform(base, progress, binding.params, index, out);
      return;
    case 'SWEEP': {
      const p = staggeredProgress(progress, rank, count, binding.params.stagger ?? 0.6);
      riseLike(base, p, phaseTime, binding.params, out);
      return;
    }
    default:
      riseLike(base, progress, phaseTime, binding.params, out);
  }
}

/**
 * The "world event executor" a world's `build()` calls to turn a plain
 * `PropGroup` into one whose `animated.indices` participate in its
 * signature event(s). `baseMatrices` is the group's normal, already-
 * computed static matrices (the exact same array passed as
 * `PropGroup.matrices`) — this NEVER mutates them, only reads, so the
 * group's rest state is always recoverable and nothing is corrupted by
 * repeated event cycles. `indices` selects which of those matrices
 * participate (a subset for performance/focus, not necessarily all of
 * them). `bindings` is this world's own data: which archetype fires
 * during which sequence phase, with what parameters — author bindings so
 * consecutive phases' `liftTo`/`liftFrom` (etc.) line up, since this
 * function does not cross-fade between bindings the way Stage 4's camera
 * shots do (props tolerate a harder cut between phases far better than
 * the camera does; see PLAN.md for why that tradeoff was made here).
 *
 * Outside an active sequence (`phase === 'idle'`) or during a phase with
 * no matching binding, every participating instance is simply copied
 * back to its exact base matrix — the group is indistinguishable from a
 * plain static one whenever no event is running.
 */
export function createSignatureEventAnimated(
  baseMatrices: THREE.Matrix4[],
  indices: number[],
  bindings: EventBinding[]
): AnimatedInstances {
  const count = indices.length;
  return {
    indices,
    sample(index, out) {
      const seq = WorldDirector.sequence;
      const base = baseMatrices[index];
      if (seq.phase === 'idle') {
        out.copy(base);
        return;
      }
      const binding = bindings.find((b) => b.phase === seq.phase);
      if (!binding) {
        out.copy(base);
        return;
      }
      const duration = WorldDirector.phaseDurations[seq.phase];
      const progress = duration > 0 ? THREE.MathUtils.clamp(seq.phaseTime / duration, 0, 1) : 1;
      const rank = indices.indexOf(index);
      evaluateBinding(binding, base, index, rank, count, progress, seq.phaseTime, out);
    },
  };
}
