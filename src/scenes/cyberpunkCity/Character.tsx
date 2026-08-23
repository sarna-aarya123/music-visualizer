import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { AudioFeatureFrame } from '../../audio/types';
import { consumeBeat, consumeDrop, consumeEvent, createBeatConsumerState } from '../../audio/beatConsumer';
import { majorEventState } from './world/musicEventDirector';
import { characterMotionState } from './world/characterMotionState';
import { MIN_SPEED, MAX_SPEED } from './world/musicController';
import { triggerGroundImpact } from './world/groundImpactState';
import { rhythmState } from './world/rhythmState';
import { useViewModeStore } from '../../state/viewModeStore';
import { useEnvironmentStore } from '../../state/environmentStore';
import { getAppearance, type CharacterAppearance } from '../shared/characterAppearance';

/**
 * Character shading matches the worlds' cel style: two hard light bands
 * with a hue-shifted (not blackened) shadow side, plus a thin dark
 * outline. A flat black silhouette read as an unfinished placeholder
 * against every environment, so the character is now built from coloured
 * parts driven by a per-world appearance config.
 */
function makeToonPart(color: string, shadowTint = '#2a1a44'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uShadow: { value: new THREE.Color(shadowTint) },
      uLightDir: { value: new THREE.Vector3(40, 30, -70).normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      void main() {
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uShadow, uLightDir;
      varying vec3 vNormalW;
      void main() {
        float ndl = dot(normalize(vNormalW), normalize(uLightDir));
        vec3 lit = uColor * 1.15;
        vec3 shade = mix(uColor, uShadow, 0.6) * 0.6;
        vec3 col = mix(shade, lit, step(0.06, ndl));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

type Vec3 = [number, number, number];

/**
 * Renders a part twice: once as the expanded back-faces-only outline
 * shell, once as the real surface. Every character part goes through this
 * so the figure carries the same ink line as the world geometry — without
 * it the character reads as a flat cut-out pasted over a cel-shaded scene.
 *
 * The geometry element is reused for both meshes; React treats it as an
 * immutable descriptor, so each mesh instantiates its own geometry.
 */
function Outlined({
  material,
  outline,
  position,
  rotation,
  scale,
  children,
}: {
  material: THREE.Material;
  outline: THREE.Material;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3 | number;
  children: React.ReactNode;
}) {
  return (
    <>
      <mesh position={position} rotation={rotation} scale={scale} material={outline}>
        {children}
      </mesh>
      <mesh position={position} rotation={rotation} scale={scale} material={material}>
        {children}
      </mesh>
    </>
  );
}

/** Thin dark outline drawn back-faces-only around the character, matching
 *  the ink line used on the world geometry. */
function makeOutline(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uWidth: { value: 0.022 }, uColor: { value: new THREE.Color('#170b22') } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uWidth, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
  });
}

const CHAR_HEIGHT = 2;
const HIP_Y = CHAR_HEIGHT * 0.52;
const SHOULDER_Y = CHAR_HEIGHT * 0.82;
const LEG_LENGTH = HIP_Y * 0.92;
const ARM_LENGTH = CHAR_HEIGHT * 0.36;
// A knee split — thigh + shin around a bending pivot — instead of one
// rigid leg box. This alone is the single highest-value change for how
// stiff the silhouette reads up close, per prior review.
const THIGH_LENGTH = LEG_LENGTH * 0.52;
const SHIN_LENGTH = LEG_LENGTH * 0.48;
const KNEE_BEND_AMP = 1.15;
// An elbow split — upper arm + forearm — mirroring the knee, so the
// silhouette has real articulation on all four limbs rather than knees
// only. Small hand/foot caps close off each limb instead of a bare box end.
const UPPER_ARM_LENGTH = ARM_LENGTH * 0.56;
const FOREARM_LENGTH = ARM_LENGTH * 0.44;
const ELBOW_BEND_AMP = 0.85;
const FOOT_LENGTH = 0.24;
const FOOT_HEIGHT = 0.07;
const HAND_SIZE = 0.1;

/** Same bar CameraRig uses for "a real 808/kick" — duplicated rather than
 *  imported so each file stays self-contained; keep the two in sync if
 *  ever retuned. */
const STRONG_BEAT_BAR = 0.72;

// Jumps are already the rarest, most gated signal available (only
// majorEventState, itself ≥7s apart) — but every major event fired one
// equally regardless of how dramatic it actually was. Reserving the jump
// for genuinely the strongest events (drop-caused ones score ~0.85+ per
// musicEventDirector.ts) while lighter major events still get their
// existing lean/sprint reaction, unchanged.
const JUMP_INTENSITY_BAR = 0.75;
// Was 0.14s, then 0.32s — Phase 4.1: still not visibly registering as a
// deliberate "gather before launch". Lengthened and deepened further, plus
// its ease-in rate (below) slowed, so the crouch is unmistakably a distinct
// beat, not a blip.
const ANTICIPATION_DURATION = 0.45;
const ANTICIPATION_CROUCH = 0.34;

// A small, FIXED (not per-frame-random — that would read as jitter, not
// character) left/right stride asymmetry — real gait isn't a perfect
// mirror. Applied as a phase offset + slight amplitude scale on the
// right side only, consistently, so the character has one subtle,
// repeatable "handedness" instead of legs/arms being an exact mirror.
const STRIDE_ASYM_PHASE = 0.12;
const STRIDE_ASYM_AMP = 0.93;

// --- Phase 5 step 4: secondary-motion / de-mechanization constants -------
// The core problem: legs, torso bob, and knees all derived from the exact
// same stridePhase and the exact same poseRate, so the whole body moved as
// one rigid mathematical unit. These constants give each layer of the
// legs -> hips -> torso -> shoulders -> head hierarchy its own fixed
// phase relationship and/or its own ease rate, so motion visibly cascades
// instead of snapping into lockstep. All still fully deterministic (no
// per-frame randomness) and all still smooth (exponential easing or plain
// sine, nothing discontinuous).

// Hips: driven by the SAME stridePhase as the legs (so they stay
// physically coherent with the stride, not a disconnected wobble) but at
// a fixed phase OFFSET from it — a distinct "voice" rather than moving in
// exact lockstep with the leg swing — eased at its own rate, separate from
// the torso's lean easing below.
const HIP_SWAY_PHASE_OFFSET = 0.55;
const HIP_SWAY_AMOUNT = 0.1; // lateral tilt (rotation.z), scaled by strideAmp
const HIP_TWIST_AMOUNT = 0.05; // subtle counter-twist (rotation.y), scaled by strideAmp
const HIP_EASE_RATE = 5.5;

// Shoulders: no separate shoulder geometry exists, so the counter-rotation
// is applied directly as an additive term on both arm groups' rotation.x —
// a fraction of the torso's OWN (already-eased) lean, chased with its own
// slower ease rate so it visibly trails the torso instead of moving with
// it frame-for-frame.
const SHOULDER_COUNTER_FACTOR = 0.4;
const SHOULDER_EASE_RATE = 5;

// Head: partially resists (rather than perfectly inheriting) the torso's
// rotation — a fraction of the torso's lean, inverted, eased slower still
// so the head reads as comparatively stable/stabilizing rather than
// rigidly mirroring every torso movement.
const HEAD_STABILIZE_FACTOR = 0.5;
const HEAD_EASE_RATE = 3.2;

// Landing recovery: a second, independent decay — slower than
// `compression`'s existing dt*6 — driving a small extra knee-bend/hip-dip
// right at touchdown that lingers a bit longer than the torso's own
// squash, so the body settles in stages rather than every part resuming
// the run pose on the same frame.
const LANDING_SETTLE_DECAY = 3.5;

type MoveState = 'idle' | 'walk' | 'run' | 'sprint';
type JumpPhase = 'none' | 'anticipation' | 'air' | 'land';

/** Target pose parameters per movement state — Character.tsx doesn't have
 *  animation clips, so "transition" means smoothly interpolating these
 *  numbers frame to frame rather than cross-fading clips. */
interface Pose {
  strideFreq: number;
  strideAmp: number;
  armAmp: number;
  lean: number;
  crouch: number;
  breathe: number;
}

const POSES: Record<MoveState, Pose> = {
  idle: { strideFreq: 0, strideAmp: 0, armAmp: 0, lean: 0.02, crouch: 0, breathe: 1 },
  walk: { strideFreq: 2.2, strideAmp: 0.35, armAmp: 0.28, lean: 0.05, crouch: 0, breathe: 0 },
  // Run/sprint lean and arm-swing pushed further than before — a punchier,
  // more exaggerated "anime run" read rather than a jog.
  run: { strideFreq: 4.0, strideAmp: 0.82, armAmp: 0.7, lean: 0.2, crouch: 0.02, breathe: 0 },
  sprint: { strideFreq: 6.4, strideAmp: 1.12, armAmp: 1.05, lean: 0.42, crouch: 0.09, breathe: 0 },
};

// Phase 5 step 3: rethresholded against the new 10-34 cruise range from
// step 1 (was tuned for the old 4-15 range). Under the old thresholds
// (MIN+1.2 / MIN+4.5 / MAX*1.25 = 21.25 for a MAX of 17 back then), 'run'
// alone spanned almost the entire practical speed range and 'sprint' only
// existed above MAX_SPEED — i.e. only reachable via a beat/drop burst, not
// through ordinary energy-driven cruising. The same problem would recur
// unscaled at the new range (idle<11.2, walk<14.5, run<42.5 leaves
// 'sprint' unreachable below a burst overshoot). Rethresholded so a
// genuinely high-energy (not just bursty) sustained cruise — roughly the
// top ~30% of the energy range, since computeTargetSpeed eases through
// smoothstep — reads as 'sprint' on its own merit, while typical mid
// energy still reads as a convincing 'run' and only real breakdown-level
// lows (well below the MIN_SPEED cruise floor, which only a breakdown's
// own multiplier can produce) drop to 'idle'/'walk'. Formulas still
// expressed relative to MIN_SPEED/MAX_SPEED (not hardcoded), so they keep
// scaling automatically if the speed range is ever retuned again.
// Phase 5 step 5: named so the locomotion-floor blend below (used to fix
// step 3's breakdown-sliding bug) can share the EXACT same boundary value
// instead of approximating it — an approximated denominator there
// previously left a small but real target discontinuity right at this
// threshold (locomotionFloor reached ~0.78, not 1.0, the instant speed
// crossed into 'walk', so the stride-frequency target visibly jumped from
// ~1.71 to a flat 2.2 on that exact frame).
const IDLE_SPEED_THRESHOLD = MIN_SPEED - 3;

function classifyMoveState(speed: number, forcedSprint: boolean): MoveState {
  if (forcedSprint) return 'sprint';
  if (speed < IDLE_SPEED_THRESHOLD) return 'idle';
  if (speed < MIN_SPEED + 6) return 'walk';
  if (speed < MAX_SPEED * 0.82) return 'run';
  return 'sprint';
}

/**
 * A minimal stylized humanoid silhouette that runs along the route,
 * grounded at RouteGenerator's own surface (via characterMotionState,
 * written once per frame by CameraRig).
 *
 * Movement state machine: idle -> walk -> run -> sprint, purely from
 * travel speed, plus a forced-sprint window on strong 808s/drops/major
 * events so the character visibly surges with the music rather than only
 * following speed passively. A separate jump sequence (anticipation crouch
 * -> launch -> air -> land) fires on a major event — a deliberate, rare
 * "special action", not a dance move.
 *
 * Hi-hats/snares intentionally never reach the character, same rule as
 * the camera. Hidden entirely in first-person view, since in that mode
 * the viewer IS the character.
 */
export function Character({
  featureFrame,
  appearance,
}: {
  featureFrame: AudioFeatureFrame;
  /** Optional override; by default the look is chosen from the active
   *  environment so each world gets its own protagonist. */
  appearance?: CharacterAppearance;
}) {
  const mode = useViewModeStore((s) => s.mode);
  const activeEnvironmentId = useEnvironmentStore((s) => s.activeId);
  const look = appearance ?? getAppearance(activeEnvironmentId);

  const mats = useMemo(
    () => ({
      skin: makeToonPart(look.skin),
      hair: makeToonPart(look.hair),
      shirt: makeToonPart(look.shirt),
      pants: makeToonPart(look.pants),
      shoes: makeToonPart(look.shoes),
      gear: makeToonPart(look.gearColor),
      cape: makeToonPart(look.cape ?? look.shirt),
      accent: new THREE.MeshBasicMaterial({ color: look.accent ?? look.shirt, toneMapped: false }),
      outline: makeOutline(),
    }),
    [look]
  );

  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const groupRef = useRef<THREE.Group>(null!);
  const hipsRef = useRef<THREE.Group>(null!);
  const torsoRef = useRef<THREE.Group>(null!);
  const headRef = useRef<THREE.Group>(null!);
  const capeRef = useRef<THREE.Group>(null!);
  const leftLegRef = useRef<THREE.Group>(null!);
  const rightLegRef = useRef<THREE.Group>(null!);
  const leftKneeRef = useRef<THREE.Group>(null!);
  const rightKneeRef = useRef<THREE.Group>(null!);
  const leftArmRef = useRef<THREE.Group>(null!);
  const rightArmRef = useRef<THREE.Group>(null!);
  const leftElbowRef = useRef<THREE.Group>(null!);
  const rightElbowRef = useRef<THREE.Group>(null!);

  const stridePhase = useRef(0);
  const compression = useRef(0);
  const lean = useRef(0);
  const forceSprintTimer = useRef(0);
  const pose = useRef<Pose>({ ...POSES.idle });

  const jumpPhase = useRef<JumpPhase>('none');
  const jumpTimer = useRef(0);
  const jumpOffsetY = useRef(0);
  const jumpVelY = useRef(0);
  // Eased 0..1 "how airborne" blend instead of a hard 0/1 switch on
  // jumpPhase — the airborne tuck/spread pose now eases in and out rather
  // than popping instantly the frame the phase changes.
  const airBlend = useRef(0);
  // Eases the visible crouch depth in during the (now longer) anticipation
  // window instead of it being an instant target-swap like `pose.crouch`.
  const anticipationCrouch = useRef(0);
  // Acceleration-based lean: tracks frame-to-frame speed change, smoothed,
  // so the character leans into speeding up and eases out of slowing down
  // — real momentum, not just a function of the current speed bucket.
  const prevSpeed = useRef(0);
  const accelLean = useRef(0);
  // One final ease pass on the fully-combined torso lean (see the comment
  // at its use site) so the sum of several individually-smoothed terms
  // can't itself read as abrupt.
  const leanDisplay = useRef(0);

  // Phase 5 step 4: secondary-motion state — each eased independently, at
  // its own rate, so the legs -> hips -> torso -> shoulders -> head chain
  // visibly cascades instead of moving in lockstep.
  const hipSwayDisplay = useRef(0);
  const hipTwistDisplay = useRef(0);
  const shoulderCounter = useRef(0);
  const headStabilize = useRef(0);
  // Spikes to 1 the instant a landing occurs, decays independently of
  // `compression` (see LANDING_SETTLE_DECAY) — drives a small extra knee
  // bend/hip dip that lingers slightly longer than the torso's own squash.
  const landingSettle = useRef(0);

  const beatState = useRef(createBeatConsumerState()).current;
  const dropState = useRef(createBeatConsumerState()).current;
  const majorState = useRef(createBeatConsumerState()).current;

  useFrame((state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05);
    if (!groupRef.current) return;

    groupRef.current.visible = mode !== 'first';

    const m = characterMotionState;

    // --- Bass/808/drop/major accents — independent of the camera's own
    // reaction to the same events, same "only low frequencies" rule. -----
    const beatHit = consumeBeat(featureFrame, beatState);
    if (beatHit > 0.55) compression.current = Math.max(compression.current, beatHit - 0.4);
    if (beatHit > STRONG_BEAT_BAR) forceSprintTimer.current = Math.max(forceSprintTimer.current, 1.0);

    const dropHit = consumeDrop(featureFrame, dropState);
    if (dropHit > 0) {
      lean.current = Math.max(lean.current, 0.55);
      forceSprintTimer.current = Math.max(forceSprintTimer.current, 2.5);
    }

    const majorHit = consumeEvent(majorEventState.impactEventId, majorEventState.intensity, majorState);
    if (majorHit > 0) {
      lean.current = Math.max(lean.current, majorHit);
      forceSprintTimer.current = Math.max(forceSprintTimer.current, 3.0);
      // Only the most dramatic major events (drop-caused, or an unusually
      // strong impact spike) earn an actual jump — lighter major events
      // (a milder spectral-shift/impact-spike trigger) still get the lean/
      // sprint surge above, just not the jump. Major-event detection
      // itself, its 7s gate, and its trigger conditions are all unchanged
      // in musicEventDirector.ts — this only decides which of ITS events
      // Character.tsx chooses to jump on.
      if (majorHit > JUMP_INTENSITY_BAR && jumpPhase.current === 'none') {
        jumpPhase.current = 'anticipation';
        jumpTimer.current = 0;
      }
    }

    compression.current *= Math.exp(-dt * 6);
    lean.current *= Math.exp(-dt * 2);
    forceSprintTimer.current = Math.max(0, forceSprintTimer.current - dt);
    // Independent, slower decay than `compression` — see LANDING_SETTLE_DECAY.
    landingSettle.current *= Math.exp(-dt * LANDING_SETTLE_DECAY);

    // --- Jump sequence: anticipation crouch -> launch -> air -> land. ---
    // A deliberate special action, not a platformer — only ever triggered
    // by a major musical event.
    const GRAVITY = 20;
    switch (jumpPhase.current) {
      case 'anticipation':
        jumpTimer.current += dt;
        if (jumpTimer.current > ANTICIPATION_DURATION) {
          jumpVelY.current = 7.2;
          jumpPhase.current = 'air';
        }
        break;
      case 'air':
        jumpVelY.current -= GRAVITY * dt;
        jumpOffsetY.current += jumpVelY.current * dt;
        if (jumpOffsetY.current <= 0 && jumpVelY.current < 0) {
          jumpOffsetY.current = 0;
          jumpVelY.current = 0;
          jumpPhase.current = 'land';
          jumpTimer.current = 0;
          compression.current = Math.max(compression.current, 0.85);
          // Starts the independent, slower-decaying settle (see
          // LANDING_SETTLE_DECAY) that gives knees/hips a touch more
          // recovery time than the torso's own squash — a staggered
          // settle rather than every part snapping back together.
          landingSettle.current = 1;
          // Ties the landing into the same world-reactivity language as a
          // beat — a visible ground ripple right where the character lands.
          triggerGroundImpact(groupRef.current.position, 2.6);
        }
        break;
      case 'land':
        jumpTimer.current += dt;
        if (jumpTimer.current > 0.18) jumpPhase.current = 'none';
        break;
      default:
        break;
    }

    groupRef.current.position.copy(m.position).addScaledVector(m.up, jumpOffsetY.current);
    groupRef.current.up.copy(m.up);
    groupRef.current.lookAt(m.position.clone().add(m.tangent));

    // Anticipation crouch: eases IN over the anticipation window (not an
    // instant target-swap) so "the music built up, then the character
    // visibly gathered before launching" actually has time to register.
    // Phase 4.1: slowed further (was dt*9) so the crouch visibly builds
    // rather than snapping most of the way there in the first couple of
    // frames of the (now longer) anticipation window.
    const anticipationTarget = jumpPhase.current === 'anticipation' ? ANTICIPATION_CROUCH : 0;
    anticipationCrouch.current += (anticipationTarget - anticipationCrouch.current) * (1 - Math.exp(-dt * 6));

    // Acceleration-based lean: real momentum, independent of which
    // discrete speed bucket classifyMoveState lands on — speeding up
    // leans the character forward into it, slowing down eases that back
    // out. Smoothed twice (the raw derivative, then the lean itself) so
    // frame-to-frame speed noise never reads as a twitch. Phase 4.1: gain
    // and clamp both raised (was *0.012 clamped ±0.12) — the original lean
    // was too small to read as "the character has momentum" rather than
    // "the character is a function of current speed only".
    const rawAccel = dt > 0 ? (m.speed - prevSpeed.current) / dt : 0;
    prevSpeed.current = m.speed;
    const accelTarget = THREE.MathUtils.clamp(rawAccel * 0.02, -0.22, 0.22);
    accelLean.current += (accelTarget - accelLean.current) * (1 - Math.exp(-dt * 4));

    // --- Movement state -> target pose, smoothly interpolated (this IS
    // the transition, since there are no animation clips to cross-fade). -
    const moveState = classifyMoveState(m.speed, forceSprintTimer.current > 0);
    const target = POSES[moveState];
    const poseRate = 1 - Math.exp(-dt * 6);
    // Drum presence nudges the CADENCE and ENERGY of the stride — Phase
    // 4.1: was a barely-perceptible ±8% cadence-only nudge. Multiplying a
    // target of 0 (idle) still stays 0, so this only ever affects a
    // character that's already moving, never introduces idle jitter, and
    // it's still fully eased into via the same poseRate as everything else
    // in this block, so neither cadence nor amplitude ever pops.
    const cadenceMul = 1 + 0.3 * rhythmState.drumPresence;
    const strideEnergyMul = 1 + 0.22 * rhythmState.drumPresence;
    // Phase 5 step 4: fixes the "sliding" bug flagged in step 3 — a musical
    // breakdown's sectionMultiplier can push actual travel speed (m.speed)
    // below the 'idle' bucket's threshold even though the character never
    // truly stops, and POSES.idle has zero stride amplitude/frequency by
    // design (a genuine dead stop should show no stride at all). Rather
    // than patch the discrete thresholds again, blend the idle bucket's
    // OWN stride targets continuously toward the walk pose in proportion
    // to actual speed — a true stop (m.speed ~0) still shows no stride,
    // but any real residual travel speed (a breakdown dip, not a full
    // stop) keeps at least a small, smooth walk-like cycle instead of legs
    // frozen mid-swing while still translating. Phase 5 step 5: denominator
    // is now the EXACT idle/walk threshold (was an approximated
    // MIN_SPEED*0.9) so this blend reaches exactly 1.0 — matching the walk
    // pose's own fixed target precisely — right at the frame moveState
    // crosses into 'walk', removing the residual target-snap that existed
    // at that boundary.
    const locomotionFloor = THREE.MathUtils.clamp(m.speed / IDLE_SPEED_THRESHOLD, 0, 1);
    const strideFreqTarget = moveState === 'idle' ? THREE.MathUtils.lerp(0, POSES.walk.strideFreq, locomotionFloor) : target.strideFreq;
    const strideAmpTarget = moveState === 'idle' ? THREE.MathUtils.lerp(0, POSES.walk.strideAmp, locomotionFloor) : target.strideAmp;
    const armAmpTarget = moveState === 'idle' ? THREE.MathUtils.lerp(0, POSES.walk.armAmp, locomotionFloor) : target.armAmp;
    pose.current.strideFreq += (strideFreqTarget * cadenceMul - pose.current.strideFreq) * poseRate;
    pose.current.strideAmp += (strideAmpTarget * strideEnergyMul - pose.current.strideAmp) * poseRate;
    pose.current.armAmp += (armAmpTarget * strideEnergyMul - pose.current.armAmp) * poseRate;
    pose.current.lean += (target.lean - pose.current.lean) * poseRate;
    pose.current.crouch += (target.crouch - pose.current.crouch) * poseRate;
    pose.current.breathe += (target.breathe - pose.current.breathe) * poseRate;

    stridePhase.current += dt * pose.current.strideFreq;
    // A small second-harmonic term breaks the perfect front/back symmetry
    // of a pure sine — real gait spends less time in the fast recovery
    // swing than in the slower stance/push-off, and a bare sine (equal
    // time both ways) is a big part of what reads as "robotic" rather than
    // human. Still perfectly smooth (a sum of sines), just less mechanical.
    // On top of that, the left and right sides now run on a slightly
    // different phase/amplitude (STRIDE_ASYM_PHASE/AMP, both fixed
    // constants — a consistent "handedness", not per-frame randomness),
    // since legs/arms being an EXACT mirror was itself a large part of the
    // "mechanically symmetrical" read.
    const phaseL = stridePhase.current;
    const phaseR = stridePhase.current + STRIDE_ASYM_PHASE;
    const swingShape = (p: number) => Math.sin(p) + 0.18 * Math.sin(p * 2 - 0.6);
    const swingL = swingShape(phaseL) * pose.current.strideAmp;
    const swingR = swingShape(phaseR) * pose.current.strideAmp * STRIDE_ASYM_AMP;
    // Idle sway also picks up with drum presence — the character shouldn't
    // read as frozen-neutral while standing through an active rhythm.
    const idleSway = Math.sin(state.clock.elapsedTime * (1.3 + 0.8 * rhythmState.drumPresence)) * (0.05 + 0.04 * rhythmState.drumPresence) * pose.current.breathe;

    // Moved up from the torso block below (was computed there directly
    // before use) so shoulder/head secondary motion, computed next, can
    // react to the SAME frame's torso lean rather than a frame-stale value.
    // One more ease pass on the fully-combined lean: each term below is
    // already individually smoothed, but summing several independently-
    // smoothed terms and applying the raw sum the same frame can still
    // read as a small abrupt shift at the moment a drop/major-event
    // impulse lands — easing the SUM removes that residual step.
    const leanTarget = pose.current.lean + lean.current * 0.35 + idleSway * 0.3 + accelLean.current;
    leanDisplay.current += (leanTarget - leanDisplay.current) * (1 - Math.exp(-dt * 8));

    // --- Hips: same stridePhase as the legs (stays physically coherent
    // with the stride) but at a fixed phase OFFSET, eased at its own rate
    // — a distinct layer rather than a mirror of the leg swing or the
    // torso lean. Lateral tilt (rotation.z) plus a small counter-twist
    // (rotation.y), both scaled by how much the character is actually
    // striding (strideAmp) so hips stay still when genuinely stopped.
    const hipPhase = stridePhase.current + HIP_SWAY_PHASE_OFFSET;
    const hipIdleSway = Math.sin(state.clock.elapsedTime * 0.42 + 0.8) * 0.035 * pose.current.breathe;
    const hipSwayTarget = Math.sin(hipPhase) * pose.current.strideAmp * HIP_SWAY_AMOUNT + hipIdleSway;
    const hipTwistTarget = Math.sin(hipPhase + Math.PI / 2) * pose.current.strideAmp * HIP_TWIST_AMOUNT;
    hipSwayDisplay.current += (hipSwayTarget - hipSwayDisplay.current) * (1 - Math.exp(-dt * HIP_EASE_RATE));
    hipTwistDisplay.current += (hipTwistTarget - hipTwistDisplay.current) * (1 - Math.exp(-dt * HIP_EASE_RATE));

    // --- Shoulders: no separate geometry, so applied as an additive
    // counter-rotation on both arm groups below — a fraction of the
    // torso's OWN lean, chased at a slower rate so it visibly trails
    // rather than moving in the same instant as the torso does.
    const shoulderCounterTarget = -leanDisplay.current * SHOULDER_COUNTER_FACTOR;
    shoulderCounter.current += (shoulderCounterTarget - shoulderCounter.current) * (1 - Math.exp(-dt * SHOULDER_EASE_RATE));

    // --- Head: partially resists the torso's rotation (a fraction,
    // inverted) at the slowest rate of the chain, so it reads as
    // comparatively stable rather than perfectly inheriting every torso
    // movement.
    const headStabilizeTarget = -leanDisplay.current * HEAD_STABILIZE_FACTOR;
    headStabilize.current += (headStabilizeTarget - headStabilize.current) * (1 - Math.exp(-dt * HEAD_EASE_RATE));

    // Ease the "how airborne" blend toward its target instead of switching
    // instantly — removes the pop at the anticipation/air/land boundaries.
    const airTarget = jumpPhase.current === 'air' ? 1 : 0;
    airBlend.current += (airTarget - airBlend.current) * (1 - Math.exp(-dt * 11));
    const airTuck = airBlend.current * 0.5;
    // A distinct airborne silhouette — legs/arms spread outward, not just
    // tucked forward, so a jump reads as its own recognizable pose rather
    // than a scaled-down run frame.
    const airSpread = airBlend.current * 0.4;

    const armRatio = pose.current.armAmp / Math.max(pose.current.strideAmp, 0.001);
    if (leftLegRef.current) {
      leftLegRef.current.rotation.x = swingL - airTuck;
      leftLegRef.current.rotation.z = airSpread;
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x = -swingR - airTuck;
      rightLegRef.current.rotation.z = -airSpread;
    }
    // Contralateral pairing (opposite arm swings with opposite leg,
    // anatomically correct): left arm follows the right leg's swing value
    // and vice versa — already true before asymmetry existed, preserved
    // here by pairing each arm with the OTHER side's swing.
    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = -swingR * armRatio + airTuck * 0.6 + shoulderCounter.current;
      leftArmRef.current.rotation.z = -airSpread * 1.2;
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = swingL * armRatio + airTuck * 0.6 + shoulderCounter.current;
      rightArmRef.current.rotation.z = airSpread * 1.2;
    }

    // Knee bend: peaks as each leg lifts through its forward swing, eases
    // back out near full extension. `bendPulse` is a smooth (C1-continuous)
    // half-wave pulse — raising max(0, sin) to a power removes the sharp
    // derivative kink a plain half-rectified sine has right at the zero
    // crossing, which is a big part of what read as "robotic" up close.
    // `kneeEnabled` is now a continuous ramp on strideAmp itself (already
    // smoothly eased frame to frame) rather than a hard threshold switch,
    // so there's no pop the instant the character starts/stops moving.
    const bendPulse = (x: number) => Math.pow(Math.max(0, Math.sin(x)), 1.7);
    const kneeEnabled = THREE.MathUtils.clamp(pose.current.strideAmp / 0.22, 0, 1);
    // Each knee now tracks ITS OWN leg's phase (phaseL/phaseR) rather than
    // a shared stridePhase, so the bend stays physically coherent with the
    // now-asymmetric swing above instead of drifting out of sync with it.
    const leftKneeBend = bendPulse(phaseL + 0.9) * KNEE_BEND_AMP * kneeEnabled;
    const rightKneeBend = bendPulse(phaseR + Math.PI + 0.9) * KNEE_BEND_AMP * kneeEnabled * STRIDE_ASYM_AMP;
    // landingSettle adds a small extra bend right at touchdown (both
    // knees, since a two-footed jump lands on both feet together), fading
    // on its own slower decay — see LANDING_SETTLE_DECAY — so the knees
    // visibly "give" a little longer than the torso's own squash below.
    if (leftKneeRef.current) leftKneeRef.current.rotation.x = leftKneeBend + airTuck * 0.8 + landingSettle.current * 0.35;
    if (rightKneeRef.current) rightKneeRef.current.rotation.x = rightKneeBend + airTuck * 0.8 + landingSettle.current * 0.35;

    // Elbow bend, paired with the diagonally-opposite knee (arms swing
    // opposite the same-side leg) — same smooth-pulse approximation,
    // same phase pairing as the contralateral arm swing above.
    const leftElbowBend = bendPulse(phaseR + Math.PI + 0.9) * ELBOW_BEND_AMP * kneeEnabled * STRIDE_ASYM_AMP;
    const rightElbowBend = bendPulse(phaseL + 0.9) * ELBOW_BEND_AMP * kneeEnabled;
    if (leftElbowRef.current) leftElbowRef.current.rotation.x = leftElbowBend + airTuck * 0.5;
    if (rightElbowRef.current) rightElbowRef.current.rotation.x = rightElbowBend + airTuck * 0.5;

    if (torsoRef.current) {
      // sin(x)^2 gives the same "bounce twice per stride" shape as
      // abs(sin(2x)) but with zero derivative at every trough instead of a
      // sharp V — a smooth bob instead of a slightly juddery one.
      const bobShape = Math.sin(stridePhase.current) * Math.sin(stridePhase.current);
      const bob = bobShape * 0.03 * kneeEnabled;
      const breatheBob = Math.sin(state.clock.elapsedTime * 0.9) * 0.02 * pose.current.breathe;
      // landingSettle adds a touch more sink beyond compression's own
      // squash, on its own slower decay — one more staggered layer of the
      // landing recovery (see LANDING_SETTLE_DECAY).
      torsoRef.current.position.y =
        SHOULDER_Y - compression.current * 0.3 - pose.current.crouch - anticipationCrouch.current - landingSettle.current * 0.04 + bob + breatheBob;
      // leanTarget/leanDisplay now computed earlier (see above, alongside
      // the hip/shoulder/head secondary motion that reacts to it) — just
      // applied here.
      torsoRef.current.rotation.x = leanDisplay.current;
      // A gentle idle look-around/weight-shift — the character keeps
      // moving in small, deliberate ways even at a dead stop, the same
      // "always alive" always-on-animation language the environment uses
      // (rooftop machinery, signs, cables), rather than freezing solid.
      torsoRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.05 * pose.current.breathe;
      torsoRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.5 + 1.2) * 0.025 * pose.current.breathe;
    }

    // --- Hips: apply the sway/twist computed earlier. Legs and torso are
    // both children of hipsRef (see the JSX below), so this composes
    // underneath the torso's own lean rather than replacing or fighting
    // it — the actual source of the "cascading" read, since torso rotation
    // is now layered ON TOP of hip rotation instead of sitting at the same
    // level. A small landing dip (own decay, see LANDING_SETTLE_DECAY)
    // rounds out the staggered recovery.
    if (hipsRef.current) {
      hipsRef.current.rotation.z = hipSwayDisplay.current;
      hipsRef.current.rotation.y = hipTwistDisplay.current;
      hipsRef.current.position.y = -landingSettle.current * 0.05;
    }

    // --- Head: partially resists the torso's rotation (see
    // headStabilize's computation above) rather than perfectly inheriting
    // it — applied directly to the head mesh, which sits as a child of
    // torsoRef, so its FINAL world rotation is torso's rotation composed
    // with this counter-term, not a full 1:1 mirror.
    if (headRef.current) {
      headRef.current.rotation.x = headStabilize.current;
    }

    // Cape/scarf: lifts backward with travel speed and flutters on its own
    // phase, faster when drums are driving — the clearest read of motion
    // on the character at a distance.
    if (capeRef.current) {
      const lift = THREE.MathUtils.clamp(m.speed / 34, 0, 1);
      const flutter = Math.sin(state.clock.elapsedTime * (5 + 6 * rhythmState.drumPresence));
      capeRef.current.rotation.x = -0.35 - lift * 0.85 + flutter * (0.05 + 0.09 * lift);
      capeRef.current.rotation.z = flutter * 0.09 * (0.4 + lift);
    }

    // Same idle life in the arms — a slow independent sway so they don't
    // freeze bolt-straight the instant stride amplitude hits zero.
    const idleArmSway = Math.sin(state.clock.elapsedTime * 0.6) * 0.07 * pose.current.breathe;
    if (leftArmRef.current) leftArmRef.current.rotation.x += idleArmSway;
    if (rightArmRef.current) rightArmRef.current.rotation.x -= idleArmSway;
  });

  return (
    <group ref={groupRef}>
      {/* Phase 5 step 4: a hip pivot layer wrapping legs + torso — this is
          the coordinate frame independent hip sway/twist rotates, so the
          torso's own lean (on torsoRef, further down) composes ON TOP of
          hip motion rather than sitting at the same level. No new visible
          geometry, just a transform node, same footprint as the existing
          knee/elbow groups. */}
      <group ref={hipsRef}>
        <group ref={leftLegRef} position={[-0.14, HIP_Y, 0]}>
          <Outlined material={mats.pants} outline={mats.outline} position={[0, -THIGH_LENGTH / 2, 0]}>
            <boxGeometry args={[0.16, THIGH_LENGTH, 0.16]} />
          </Outlined>
          <group ref={leftKneeRef} position={[0, -THIGH_LENGTH, 0]}>
            <Outlined material={mats.pants} outline={mats.outline} position={[0, -SHIN_LENGTH / 2, 0]}>
              <boxGeometry args={[0.14, SHIN_LENGTH, 0.14]} />
            </Outlined>
            <Outlined material={mats.shoes} outline={mats.outline} position={[0, -SHIN_LENGTH, FOOT_LENGTH * 0.3]}>
              <boxGeometry args={[0.17, FOOT_HEIGHT * 1.6, FOOT_LENGTH]} />
            </Outlined>
          </group>
        </group>
        <group ref={rightLegRef} position={[0.14, HIP_Y, 0]}>
          <Outlined material={mats.pants} outline={mats.outline} position={[0, -THIGH_LENGTH / 2, 0]}>
            <boxGeometry args={[0.16, THIGH_LENGTH, 0.16]} />
          </Outlined>
          <group ref={rightKneeRef} position={[0, -THIGH_LENGTH, 0]}>
            <Outlined material={mats.pants} outline={mats.outline} position={[0, -SHIN_LENGTH / 2, 0]}>
              <boxGeometry args={[0.14, SHIN_LENGTH, 0.14]} />
            </Outlined>
            <Outlined material={mats.shoes} outline={mats.outline} position={[0, -SHIN_LENGTH, FOOT_LENGTH * 0.3]}>
              <boxGeometry args={[0.17, FOOT_HEIGHT * 1.6, FOOT_LENGTH]} />
            </Outlined>
          </group>
        </group>

        <group ref={torsoRef} position={[0, SHOULDER_Y, 0]}>
          {/* Chest -> waist -> hip: a real human taper instead of one
              rectangle or two disjoint boxes. Each segment overlaps the next
              generously (no exposed seam/gap at the waist) while still
              narrowing at the waist and widening again slightly at the
              hips — the silhouette reads as a torso, not a stack of crates. */}
          <Outlined material={mats.shirt} outline={mats.outline} position={[0, 0.17, 0]}>
            <boxGeometry args={[0.44, 0.24, 0.26]} />
          </Outlined>
          {/* Chest accent stripe — a small emissive detail that catches the
              eye and reads as clothing rather than a plain block. */}
          {look.accent && (
            <mesh position={[0, 0.14, 0.135]} material={mats.accent}>
              <boxGeometry args={[0.12, 0.15, 0.02]} />
            </mesh>
          )}
          <Outlined material={mats.shirt} outline={mats.outline} position={[0, 0.02, 0]}>
            <boxGeometry args={[0.3, 0.18, 0.2]} />
          </Outlined>
          <Outlined material={mats.pants} outline={mats.outline} position={[0, -0.14, 0]}>
            <boxGeometry args={[0.36, 0.22, 0.23]} />
          </Outlined>
          {/* Closes the actual structural gap: the torso group's own origin
              (SHOULDER_Y) sits well above the legs' fixed pivot (HIP_Y) —
              0.6 apart — and no earlier torso segment reached far enough
              down to meet it, leaving visible empty space between torso and
              legs at all times. This connector reaches from the hip box
              down to (and slightly past) the leg pivot's local-space
              position, so the two always visually overlap regardless of
              crouch/compression. */}
          <Outlined material={mats.pants} outline={mats.outline} position={[0, -0.44, 0]}>
            <boxGeometry args={[0.32, 0.38, 0.22]} />
          </Outlined>
          {/* Trailing cape/scarf — hung behind the shoulders and animated
              in useFrame so movement reads clearly from any distance. */}
          {look.cape && (
            <group ref={capeRef} position={[0, 0.2, -0.15]}>
              <Outlined material={mats.cape} outline={mats.outline} position={[0, -0.3, -0.06]}>
                <boxGeometry args={[0.38, 0.62, 0.04]} />
              </Outlined>
              <Outlined material={mats.cape} outline={mats.outline} position={[0, -0.62, -0.14]}>
                <boxGeometry args={[0.3, 0.34, 0.04]} />
              </Outlined>
            </group>
          )}
          {/* Low-poly faceted head — a deliberately stylized "gem-cut" shape
              rather than a smooth sphere, matching the world's low-poly toon
              language (roof caps, spires) instead of a primitive ball.
              Carries its own headRef so it can partially resist (rather
              than perfectly inherit) the torso's rotation — see
              headStabilize above. */}
          <group ref={headRef} position={[0, 0.5, 0]}>
            <Outlined material={mats.skin} outline={mats.outline} scale={[0.97, 1.1, 0.88]}>
              <icosahedronGeometry args={[0.19, 1]} />
            </Outlined>
            {/* Hair/headgear — the biggest single silhouette difference
                between one world's protagonist and another's. */}
            {look.headGear === 'spikyHair' && (
              <group position={[0, 0.1, 0]}>
                <Outlined material={mats.hair} outline={mats.outline} scale={[1.05, 0.62, 1.02]}>
                  <icosahedronGeometry args={[0.19, 1]} />
                </Outlined>
                {([
                  [-0.12, 0.1, -0.06, 0.5],
                  [0.02, 0.16, -0.02, 0.7],
                  [0.14, 0.09, 0.02, 0.45],
                  [-0.04, 0.12, 0.1, 0.4],
                ] as const).map(([x, y, z, s], i) => (
                  <Outlined
                    key={i}
                    material={mats.hair}
                    outline={mats.outline}
                    position={[x, y, z]}
                    rotation={[0.5 + i, i * 1.3, 0.4]}
                  >
                    <coneGeometry args={[0.055, 0.2 * s + 0.12, 4]} />
                  </Outlined>
                ))}
              </group>
            )}
            {look.headGear === 'witchHat' && (
              <group position={[0, 0.14, 0]}>
                <Outlined material={mats.gear} outline={mats.outline} position={[0, 0.02, 0]}>
                  <cylinderGeometry args={[0.34, 0.34, 0.03, 12]} />
                </Outlined>
                <Outlined material={mats.gear} outline={mats.outline} position={[0, 0.24, 0.02]} rotation={[0.14, 0, 0.06]}>
                  <coneGeometry args={[0.19, 0.46, 12]} />
                </Outlined>
              </group>
            )}
            {look.headGear === 'helmet' && (
              <>
                <Outlined material={mats.gear} outline={mats.outline} scale={[1.22, 1.2, 1.2]}>
                  <icosahedronGeometry args={[0.19, 1]} />
                </Outlined>
                <mesh position={[0, 0.0, 0.17]} material={mats.accent} scale={[1, 0.62, 0.5]}>
                  <sphereGeometry args={[0.14, 12, 10]} />
                </mesh>
              </>
            )}
            {look.headGear === 'hood' && (
              <Outlined material={mats.gear} outline={mats.outline} position={[0, 0.04, -0.03]} scale={[1.25, 1.15, 1.3]}>
                <icosahedronGeometry args={[0.19, 1]} />
              </Outlined>
            )}
            {look.headGear === 'cap' && (
              <group position={[0, 0.13, 0]}>
                <Outlined material={mats.gear} outline={mats.outline} scale={[1.06, 0.55, 1.04]}>
                  <icosahedronGeometry args={[0.19, 1]} />
                </Outlined>
                <Outlined material={mats.gear} outline={mats.outline} position={[0, -0.02, 0.19]}>
                  <boxGeometry args={[0.28, 0.03, 0.16]} />
                </Outlined>
              </group>
            )}
          </group>
          <group ref={leftArmRef} position={[-0.3, 0.16, 0]}>
            <Outlined material={mats.shirt} outline={mats.outline} position={[0, -UPPER_ARM_LENGTH / 2, 0]}>
              <boxGeometry args={[0.13, UPPER_ARM_LENGTH, 0.13]} />
            </Outlined>
            <group ref={leftElbowRef} position={[0, -UPPER_ARM_LENGTH, 0]}>
              <Outlined material={mats.skin} outline={mats.outline} position={[0, -FOREARM_LENGTH / 2, 0]}>
                <boxGeometry args={[0.105, FOREARM_LENGTH, 0.105]} />
              </Outlined>
              <Outlined material={mats.skin} outline={mats.outline} position={[0, -FOREARM_LENGTH - HAND_SIZE * 0.6, 0]}>
                <boxGeometry args={[HAND_SIZE * 1.1, HAND_SIZE * 1.3, HAND_SIZE * 1.1]} />
              </Outlined>
            </group>
          </group>
          <group ref={rightArmRef} position={[0.3, 0.16, 0]}>
            <Outlined material={mats.shirt} outline={mats.outline} position={[0, -UPPER_ARM_LENGTH / 2, 0]}>
              <boxGeometry args={[0.13, UPPER_ARM_LENGTH, 0.13]} />
            </Outlined>
            <group ref={rightElbowRef} position={[0, -UPPER_ARM_LENGTH, 0]}>
              <Outlined material={mats.skin} outline={mats.outline} position={[0, -FOREARM_LENGTH / 2, 0]}>
                <boxGeometry args={[0.105, FOREARM_LENGTH, 0.105]} />
              </Outlined>
              <Outlined material={mats.skin} outline={mats.outline} position={[0, -FOREARM_LENGTH - HAND_SIZE * 0.6, 0]}>
                <boxGeometry args={[HAND_SIZE * 1.1, HAND_SIZE * 1.3, HAND_SIZE * 1.1]} />
              </Outlined>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
