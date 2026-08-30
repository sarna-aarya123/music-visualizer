# PLAN — Next Phase: Spectacle, Events & the World Director

> **Status (2026-08-28): Stages 0-7 are complete, verified, and committed**
> — dynamic instance-matrix plumbing, the `WorldDirector` facade, the
> ~13s multi-phase major-event sequence, moving cinematic camera shots,
> per-world signature events, (Stage 6) the character-first cinematic-anchor
> fix, and (Stage 7) an effect-brightness readability rebalance, a
> cinematic-camera environment-clearance pass, a character/prop
> intersection fix, and the planned launch/glide/landing-shockwave
> character ability. See §10 for the Stage 6 diagnosis/brief and §11 for
> the Stage 7 write-up. **Stage 8 (variety / history / weighted selection,
> plus the deferred background/distant event layer) is next and has NOT
> been approved or started.**
>
> **Read `HANDOFF.md` first** for current architecture, conventions,
> protected systems and known pitfalls.
>
> **Stage A (offline audio pre-analysis) remains out of scope** unless the
> user explicitly asks for it.

Originally a read-only investigation prepared for review; Stages 0-5 have
since been executed exactly as scoped and approved, one at a time, each
reviewed before the next began. See §7 for what actually shipped in each
stage and §8 for how each was verified. §10 is the Stage 6 handoff.

> **Correction on scope:** there are **9 worlds**, not 11. The two
> pre-cel-shading environments ("Cyberpunk City (original)" and "Fantasy
> Forest (original)") were deleted at your request in the last session.
> Current list: Floating Islands (bespoke), Cyberpunk Night, Desert Dream,
> Underwater Abyss, Outer Dimension, PS2 Night, Fantasy Forest, Abstract
> Void, Chaotic Carnival.

---

## 1. What already exists that we can build on

**The audio layer is genuinely sufficient. No new detection is needed for
any feature in this phase.** `AudioFeatureFrame` already exposes:

- Continuous: `bass/lowMid/mid/high/energy`, four flux channels,
  `kickImpulse`, `impactScore`, `sectionMood`
- Discrete exactly-once events: `beatId` (+intensity/time/interval),
  `snareHitId`, `hihatId`, `spectralShiftId`, `dropId`, `breakdownId`
- Derived persistent state (`rhythmState.ts`): `drumPresence` (smooth 0–1),
  `energyTrend` (signed, multi-second)

`beatConsumer.ts`'s id/lastId pattern guarantees no consumer ever misses or
double-counts an event. This is the primitive the whole director should be
built on.

**`musicEventDirector.ts` is already ~60% of a director.** It has a phase
machine (idle → anticipation → impact → reaction → recovery), an
`intensity`, an `originPosition`, an exactly-once `impactEventId`, a 7s
`MIN_EVENT_GAP` cooldown, and a shared `getMajorEventEnvelope()` that every
system reads. The concepts are right; only the *scale* is too small.

**`cinematicDirector.ts`** has 8 shot types, a priority ladder (major event
> drop > landmark proximity > region change), a 4.5s cut cooldown, an
anti-repeat `pickVaried`, and a smoothstep blend envelope. `CameraRig`
already blends both position and look-at toward a shot.

**`musicController.ts`** already models *sections*: drop/breakdown set a
`sectionMultiplier` with hold timers that relax back to cruise.

**Character** has a complete jump lifecycle (anticipation → air → land),
already gated on `majorEventState.intensity > 0.75`, plus a pose state
machine and layered secondary motion. `groundImpactState.ts` is a clean
model for cross-system one-shot signalling.

**World architecture** is data-driven: `WorldDefinition` (sky, fog, ambient,
path, particles, outline, `build()`), `PropGroup` with a
`reactive: {mood, drums, event}` channel, `OutlinedInstances`,
`ProceduralSky` with band modes, `WorldPath` with three styles.

**The single most important existing hook:** `PropGroup.reactive` already
routes music into prop groups — but only into *emissive*. Extending that
same channel to drive *transforms* is the cheapest path to world events.

---

## 2. The biggest limitations right now

**(a) Prop transforms are baked. This is the structural blocker.**
`build()` computes `matrices` once; `OutlinedInstances` uploads them once in
a `useEffect`. Nothing can move. Every requested world event — structures
activating, terrain shifting, bridges opening, vegetation reacting,
buildings transforming — requires per-frame instance-matrix updates that the
current component cannot do. **Nothing else on the wishlist matters until
this is solved.**

**(b) Major events are far too short.** Fixed phase durations total ~2.57s
(0.3 + 0.12 + 0.75 + 1.4). A "massive drop moment" with
buildup → tension → drop → transformation → reveal → aftermath needs
**10–15s**. The current lifecycle physically cannot express it.

**(c) There is no anticipation, only reaction.** `dropId` fires *at* the
drop (fast-vs-slow energy envelope crossing). The 0.3s "anticipation" phase
begins after detection, so it is a post-hoc flourish, not real tension. True
buildup requires either triggering on rising `energyTrend` (approximate) or
pre-analysing the decoded buffer (exact — see Stage A).

**(d) One event channel, one shape.** `majorEventState` holds a single
event with no *kind*. It can't express "which event", can't run two things
at different rates, and can't carry per-event parameters.

**(e) No spatial awareness beyond `t`.** Only `findNearestLandmark` inside
the cinematic director. Events need "am I near a landmark / entering a
region / approaching something" queries.

**(f) No event memory.** Nothing records what recently happened, so
selection can't avoid repeats and the same song always produces the same
result — directly against the replayability goal.

**(g) Cinematic shots are static offsets.** Every shot is a fixed position
relative to the character. None *move*, so flybys, sweeps, orbits and
"camera travelling through an event" are impossible today.

**(h) No persistent world state.** No way to express "this bridge is now
open" that survives past an event envelope.

**(i) Character has exactly one ability**, triggered by exactly one
condition.

---

## 3. What should become part of a higher-level director

Introduce a **WorldDirector**: one system that owns *decisions*, plus
*executors* that own rendering. The director never draws anything.

**Inputs (all already available):**

| Category | Source |
|---|---|
| Song intensity/mood | `sectionMood`, `energy`, `energyTrend`, `drumPresence` |
| Discrete musical events | `dropId`, `breakdownId`, `spectralShiftId`, `beatId`, `impactScore` |
| Position | `characterMotionState.t/position/speed` |
| World | active world id, current region, landmark positions + kinds |
| History | rolling log of recent events (kind, time, position) |
| Cooldowns | global + per-archetype + per-target |

**Output: a `Sequence`** — a timed multi-phase script with named phases and
per-channel instructions:

```
Sequence {
  kind, intensity, origin, target?
  phases: [{ name: 'buildup' | 'tension' | 'impact' | 'transform'
             | 'reveal' | 'aftermath', duration }]
  channels: { camera?, character?, world?, lighting?, particles? }
}
```

**Moves into the director:** major-event triggering (extend
`musicEventDirector`, don't replace), cinematic shot *selection*
(`cinematicDirector` becomes a commanded channel rather than an independent
decider), world-event selection (new), character-ability triggering
(currently inline in `Character.tsx`).

**Deliberately stays OUT:** beat-level reactions (prop emissive, path
ripple, particle bursts, sky pulse) must remain local and immediate. If
everything routes through the director, quiet passages go dead and the
director becomes a bottleneck. Also unchanged: the speed model
(`musicController` — the director may *request* a temporary override), and
the hi-hat/snare camera exclusion.

---

## 4. Highest-impact features (ranked)

1. **Animated prop groups** — unblocks every world event. Add an optional
   animation channel to `PropGroup` with a small set of parameterised
   behaviours; make `OutlinedInstances` support dynamic matrices.
2. **Sequence model + director core** with long-form (10–15s) drop
   sequences replacing the fixed 2.57s lifecycle.
3. **Moving cinematic shots** — flyby, sweeping aerial, orbit, dolly-in,
   ground-level pass. Camera paths evaluated over time.
4. **World event archetype library** + per-world bindings (§6).
5. **Background/distant event layer** — enormous silhouettes, ships,
   creatures, distant activations. Very high spectacle-per-cost: far away,
   cheap to render, cannot touch route or collision.
6. **Event history + weighted selection** — the replayability requirement.
7. **A small character ability set** (launch, glide, landing shockwave) —
   see §5 for what to skip.

---

## 5. Features that would add clutter without enough payoff

- **Wall-running, vaulting, sliding, dashing.** There is no player input and
  no obstacles — these would be cosmetic animations with no stakes. A "dash"
  with no player behind it is just a speed burst, which `applyBeatBurst`
  already does. **Recommend: only abilities that read as reactions to the
  music** — a big launch on a drop, a glide across a gap, a landing
  shockwave. Skip the traversal verbs.
- **Simulated environmental destruction.** Expensive, fragile, and it fights
  route/collision reliability. Prefer *scatter-and-reform on a timeline* —
  visually similar, fully deterministic, no physics.
- **Per-world bespoke camera or event code.** Should be data, not code, or
  we get nine divergent implementations.
- **More particle systems.** We have one; parameterise it.
- **Constant ambient background motion.** Explicitly against your restraint
  requirement — background events should be rare and staged.
- **Terrain shifting that moves the route itself.** Terrain may shift
  *beside* the path only; the route spline must stay untouched.

---

## 6. Unique events for every world without duplicating architecture

**Pattern: generic event *verbs* in shared code + per-world *data*
bindings.** Roughly ten archetypes cover everything requested:

`RISE` · `ACTIVATE` · `SPIN_UP` · `SCATTER_REFORM` · `SWEEP` (a wave
travelling along the route through a group) · `FLYOVER` · `SUMMON` ·
`BLOOM` · `SURGE` (path/ground energy) · `REVEAL` (fog pulls back +
landmark ignites)

Each world's definition gains:

```
events: [
  { archetype: 'RISE', targets: ['pyramids'], minIntensity: 0.7,
    cooldown: 20, weight: 3, params: { height: 30, duration: 6 } },
  ...
]
```

Same engine, different data — no per-world rendering code. Proposed
signature events:

| World | Signature events |
|---|---|
| **Floating Islands** | Islands RISE/realign into a bridge · sakura BLOOM burst · distant sky-whale FLYOVER |
| **Cyberpunk Night** | Tower windows ACTIVATE floor-by-floor SWEEP · neon signs SURGE · flying-car FLYOVER · skyline REVEAL |
| **Desert Dream** | Pyramids RISE and rotate · debris SCATTER_REFORM into a ring · sandstorm REVEAL |
| **Underwater Abyss** | Whale SUMMON pass overhead · ruins RISE from the seabed · coral BLOOM · light-shaft REVEAL |
| **Outer Dimension** | Rings SPIN_UP and align · asteroid SCATTER_REFORM · planet-rise REVEAL |
| **PS2 Night** | Street lights ACTIVATE in a SWEEP down the road · house windows light in sequence · distant fireworks FLYOVER |
| **Fantasy Forest** | Mushroom caps BLOOM in a SWEEP · crystals ACTIVATE · spirit SUMMON · canopy REVEAL |
| **Abstract Void** | Solids SCATTER_REFORM into a structure · rings SPIN_UP · grid SURGE · full-geometry REVEAL |
| **Chaotic Carnival** | Ferris wheels SPIN_UP · bulbs ACTIVATE in chase patterns · fireworks FLYOVER · funhouse REVEAL |

Every one of these targets prop groups that **already exist** in each
world's generator. No new geometry is required for the first pass.

---

## 7. Recommended implementation order

**Stage 0 — DONE (2026-08-27).** Investigation only, no code written.
Findings (full detail was reported to the user at the time; kept short
here):

- Real instance counts per world, pulled from the actual generators, are
  small by WebGL standards — ~220 (Abstract Void) to ~1,660 (Cyberpunk
  Night, dominated by ~1,275 emissive window instances). Rewriting every
  instance in the largest group every frame would cost well under 0.5ms
  of JS and a trivial GPU `bufferSubData` — comparable to per-frame work
  `WorldParticles.tsx` already does today for 300 points.
- The app's actual headroom constraint is fragment/fill-rate (custom toon
  shader × Bloom/Vignette/ChromaticAberration/Noise × up to 1.75 dpr), not
  CPU or instance-matrix upload cost. Stage 1 doesn't touch triangle count
  or fragment cost, so it doesn't compete with that budget.
- `three@0.169.0` (confirmed in `node_modules/three/src/core/BufferAttribute.js`
  and `WebGLAttributes.js`) supports partial buffer uploads via
  `attribute.addUpdateRange(start, count)` — unused anywhere in this
  codebase before Stage 1, now the mechanism Stage 1 uses so an animated
  subset of a large group doesn't force a full-buffer re-upload.
- No throwaway perf-spike code was written — the empirical FPS check was
  folded into Stage 1's own verification instead (see §8), since Stage 1
  is the first point actual animatable code exists to measure.
- Full report (findings / recommended architecture / alternatives
  considered / exact Stage 1 design) is preserved in this session's
  transcript; this file keeps only the resulting decisions.

**Stage 1 — DONE (2026-08-27). Dynamic prop animation, plumbing only.**
`PropGroup` gained an optional `animated?: AnimatedInstances` field
(`{ indices: number[]; sample(index, out, elapsed, dt): void }`) in
`src/scenes/worlds/types.ts`. `OutlinedInstances.tsx` grew a conditional
`useFrame` branch: when a group declares `animated`, its flagged indices
are resampled every frame into the surface mesh's `instanceMatrix` via a
single persistent scratch `THREE.Matrix4` (no per-frame allocation),
uploaded with `addUpdateRange` per contiguous index run rather than a full
buffer re-upload, then mirrored into the outline mesh in the *same frame*
via the existing `copyArray` so the ink line can never lag the surface it
traces. `WorldScene.tsx` passes `g.animated` through unchanged otherwise.

**No world declares `animated` yet** — this stage is provably a no-op for
every existing world: the branch is behind `if (!animated || ...) return`,
and since `animated` is `undefined` everywhere, the branch cannot execute,
not just "didn't happen to run" this time. Floating Islands (which hand-
rolls the same upload/mirror pattern instead of using `OutlinedInstances`)
was left untouched — folding it onto the shared component is flagged as
follow-up debt (§9 point 7 area) for whenever it needs its first animated
prop, not a Stage 1 prerequisite. *Still no new visual features, no new
geometry, no event archetypes, no WorldDirector.*

**Stage 2 — DONE (2026-08-27). Parity director refactor, foundation only.**
This was scoped narrower than this section originally described, at the
user's explicit direction: establish the decisions-vs-executors seam, but
do not yet port cinematic selection onto it or introduce the `Sequence`
model — both remain future work (see "left untouched" below).

Added `src/scenes/cyberpunkCity/world/worldDirector.ts` — a thin
`WorldDirector` facade (`step(dt, frame, cameraPosition, elapsed)` /
`reset()`) that wraps the one decision system that exists today
(`musicEventDirector.ts`'s major-event lifecycle) by pure delegation, in
the same call order, with the same arguments. `musicEventDirector.ts`
itself has **zero diff** — its behavior is untouched, only *how it gets
called* changed. The two real control call sites were routed through the
facade:
- `MusicEventDirector.tsx` (the per-frame mount point) calls
  `WorldDirector.step(...)` instead of `stepMusicEventDirector(...)`
  directly.
- `FeatureUpdater.tsx`'s `resetToken` effect calls `WorldDirector.reset()`
  in place of the direct `resetMusicEventDirector()` call, alongside its
  sibling `resetCinematicDirector()`/`resetRhythmState()` calls, which
  were deliberately left as direct calls (see below).

**Left untouched, deliberately:**
- `cinematicDirector.ts` and `musicController.ts` — both are genuine
  "decisions" per §3's eventual scope, but their inputs
  (character position/tangent, district, landmarks) are camera-specific
  and only `CameraRig` has them ready per frame. Folding them into
  `WorldDirector.step`'s generic signature now would mean threading those
  extra params through the facade for zero behavioral gain. They stay
  called directly by `CameraRig`, as before.
- The ~18 files that read `majorEventState`/`getMajorEventEnvelope`
  directly (camera, character, world props/sky materials,
  post-processing) — all executors in the decisions-vs-executors sense,
  already reading published state rather than deciding anything
  themselves. Rerouting all of them through `WorldDirector` would be a
  large, purely mechanical diff with no behavioral upside; deferred until
  a future stage actually changes what they need to read.
- No `Sequence` model, no new event archetypes, no moving props, no new
  camera triggers, no Stage A. `worldDirector.ts`'s own doc comment states
  this scope explicitly so a future session doesn't assume more was built
  than actually was.

When a future stage adds a second decision producer, `WorldDirector.step`/
`reset` each grow one more delegated call — callers' shape doesn't change.

**Stage 3 — DONE (2026-08-27). Long-form cinematic sequence, built entirely
from existing effects.** The old ~2.57s lifecycle (idle -> anticipation ->
impact -> reaction -> recovery) is now a ≈13s sequence: **idle -> buildup
(1.0s) -> tension (0.9s) -> drop (0.5s) -> transform (3.0s) -> reveal
(3.6s) -> aftermath (4.0s) -> idle**. Total = 13.0s, mid-range of the
requested 10-15s.

**What actually changed (4 files):**
- `musicEventDirector.ts` — the `MajorEventPhase` union, `PHASE_DURATIONS`,
  and `PHASE_ORDER` grew from 4 phases to 6 (renamed, not just extended —
  see below). `impactEventId` still increments exactly once, now on
  entering `'drop'` (was `'impact'`) — same exactly-once semantics every
  consumer (`Character`'s jump, `CameraRig`'s launch impulse,
  `cinematicDirector`'s shot trigger, `WorldPath`/`WorldParticles`/
  `Walkway`/`Petals`'s bursts) already used, so **none of those 6+ files
  needed to change at all**. `getMajorEventEnvelope()` was reshaped into a
  6-phase curve (ramp through buildup, a held/pulsing plateau through
  tension, a hard jump to full intensity at drop, then three progressively
  gentler eased-decay stages through transform/reveal/aftermath — see the
  function's own doc comment for the exact shape). **This one function is
  what extends every existing envelope-driven effect** (camera altitude
  dive/FOV/curvature-bank scale in `CameraRig`, prop emissive/rim in
  `WorldScene`, sky uniforms in `ProceduralSky`/`IslandSky`/`Islands`,
  post-processing bloom/vignette/chromatic-aberration in `VisualizerCanvas`)
  across the new, longer duration — none of those consumer files needed
  *any* changes either, confirmed by `git diff` showing zero touches to
  them.
- `worldDirector.ts` — gained a `sequence` getter (read-only view of
  `majorEventState`) and a `phaseDurations` getter, so `WorldDirector`
  genuinely owns the sequence's raw phase/timing state, not just the
  step/reset control flow from Stage 2.
- `CameraRig.tsx` — the existing "Phase 4.1 holding-breath" FOV-tighten/
  pullback cue (previously gated on the single ~0.3s `'anticipation'`
  phase) now ramps smoothly across the combined `buildup`+`tension`
  duration (≈1.9s) as one continuous progress value. Reads the raw phase
  via `WorldDirector.sequence`/`.phaseDurations` instead of importing
  `majorEventState`/`PHASE_DURATIONS` directly (still imports
  `getMajorEventEnvelope()` directly, unchanged — see `worldDirector.ts`'s
  doc comment for why that split is deliberate). No other part of
  `CameraRig` changed: beat/drop consumption, hi-hat/snare exclusion,
  first/third-person blending, and FOV base formula are byte-for-byte
  untouched.
- `musicController.ts` — the `anticipationDamp` pacing dip (0.7× speed)
  now checks `phase === 'buildup' || phase === 'tension'` instead of the
  old single phase name, read via `WorldDirector.sequence`. `MIN_SPEED`/
  `MAX_SPEED`/`MAX_SPEED_CAP`/burst/section-multiplier constants — all of
  Phase 5's protected tuning — are untouched.

**Left untouched, deliberately:** `cinematicDirector.ts` (zero diff) — its
existing major-event branch already picks a landmark/dramatic-close shot
off the same `impactEventId`, so it fires exactly as before with no code
change, and its own ~3s shot duration was left alone rather than extended,
keeping this stage's footprint to exactly the sequence-timing work it was
scoped for. `Character.tsx` (zero diff) — its jump/lean/forced-sprint
reactions are already timed independently of `majorEventState`'s phase
durations (own local timers), so they needed no changes and already
provide a reasonable few-second "character reacts" window inside the
longer sequence. `FeatureExtractor.ts`, `beatConsumer.ts`, the audio clock,
route generation, collision/clearance — all zero diff (confirmed via
`git diff --name-only`).

**Known limitation, as instructed — documented, not solved:**
`dropId`/the other triggers still fire AT detection, not before it — there
is still no genuine pre-drop anticipation, because that needs the offline
pre-analysis this stage was explicitly told not to build (Stage A). The
`buildup`/`tension` phases are a post-trigger hold (the same technique the
old 0.3s `'anticipation'` phase already used, just stretched to ≈1.9s and
staged more dramatically), not a prediction — see the long "Known
limitation" note at the top of `musicEventDirector.ts` for the full
reasoning, including why the pre-drop hold was deliberately kept short
(audio/visual sync) while the post-drop transform/reveal/aftermath carry
essentially all the added length (no sync constraint against a single
instant applies there).

**Sequence-collision policy:** "ignore" — a new trigger simply can't fire
while `phase !== 'idle'` (unchanged gating), and since one sequence now
runs ≈13s — already longer than the unchanged 7s `MIN_EVENT_GAP` — the
effective gap between sequence starts is `max(7, 13) = 13s` without
`MIN_EVENT_GAP` itself needing to change.

**Stage 4 — DONE (2026-08-28). Moving cinematic camera shots for the major-
event sequence.** Three reusable motion primitives in a new
`world/cameraShots.ts`, all pure/deterministic functions of
(phase, elapsed-in-phase, shot params, target) with zero per-frame
allocation (persistent module-level scratch vectors, mutated via
`.copy()`/`.addScaledVector()`/`.applyAxisAngle()`, never `.clone()`):

- **`push`** — camera at a distance from `target` along `-tangent`
  (+height/lateral offset) that eases between a start and end distance.
  Approaching = dolly-in; receding = dolly-out/reveal. One primitive
  covers both, per the brief's "smaller set of excellent primitives"
  guidance.
- **`orbit`** — camera revolves around `target` at a fixed radius/height,
  sweeping a partial arc (not a full loop) with eased angular velocity.
- **`sweep`** — camera translates along a line passing `target`, from a
  "before" to an "after" lateral+along-route offset at a given height.
  Flyby, sweeping-aerial, and ground-level-pass are all this primitive at
  different height/span parameters (only the elevated "sweep" variant is
  wired into the default phase table below; ground-level pass is
  implemented as a parameterization, not separately wired in — noted as a
  tuning knob, not a gap, since the primitive already supports it).

**Target:** locked once per sequence — the nearest landmark to the
character when the sequence leaves `'idle'` (within 90 units), or a point
40 units ahead along the route if none is close — rather than re-picked
every frame, so the shot math has a fixed point to reason about for the
whole ~13s sequence instead of jumping if a different landmark becomes
nearest mid-sequence. Cleared by `resetSequenceCameraShot()`.

**Phase → shot table** (in `cameraShots.ts`, data not a hardcoded switch):
buildup = push in (46→27 units), tension = orbit (37° arc), drop = a fast
push punch-in (20→12 units — mostly hidden behind cinematicDirector's
existing cut, see below), transform = a wide elevated sweep (64-unit
excursion), reveal = push out (22→48 units — the "here's what changed"
pull-back), aftermath = a slow orbit that fades out. Distances are all
5-10× the normal chase camera's own offsets (`FOLLOW_DIST`=5.5,
`FOLLOW_HEIGHT`=3.3), so the shots read as a clearly different framing,
not a subtle nudge — directly answering the "must be noticeable"
requirement.

**No snapping:** two mechanisms. (1) The whole shot system eases in over
the first 60% of `buildup` and back out over the last 60% of `aftermath`
(a real beginning/middle/end), rather than an instant on/off. (2) Every
phase boundary cross-fades toward the next phase's shot (evaluated at its
own progress 0) over the last 0.35s of the current phase, so consecutive
primitives — which have no reason to land on the same point analytically —
never jump between each other.

**Architecture — decisions vs. rendering, kept separate as instructed:**
`WorldDirector.getSequenceCameraShot(...)` is the one new facade method
(pure delegation to `cameraShots.ts`, matching the `step`/`reset` pattern
from Stages 2-3) — this is "what shot + when". `CameraRig` is the only
thing that calls it and the only thing that ever touches `camera.*`; it
composes the returned blend weight with everything else already in the
file (`(1 - cineBlend) * (1 - modeBlend)`) and applies the result via the
same `position.clone().lerp(...)` pattern the file already used for the
cinematicDirector blend. `WorldDirector` itself gained no rendering
logic — its new method is a single delegating call, same shape as `step`/
`reset`.

**Coexistence with the existing `cinematicDirector.ts` cut — zero diff to
that file.** Rather than touching its lifecycle (explicitly to be avoided
"unless absolutely necessary" — it wasn't), the new sequence shot
multiplies its blend by `(1 - cineBlend)`, so cinematicDirector's existing
major-event landmark/dramatic-close cut (which already fires on the same
`impactEventId`, unchanged) always wins during its own ~3.0-3.2s active
window right at the drop, and the sequence shot fades back in smoothly as
that cut's own envelope fades out. This reuses the *existing* cinematic
shot as the sequence's natural "drop: decisive movement" beat (satisfying
that part of the brief's example arrangement for free) while the *new*
primitives own buildup/tension (before the cut) and transform/reveal/
aftermath (after it) — deliberately not the exact per-phase arrangement
the brief's example proposed 1:1 (that example didn't account for the
existing cut still being live for the first ~2.5s of `transform`), because
routing camera control that way exactly matches the brief's own
"the existing cinematicDirector lifecycle" being preserved.

**Verified with genuine visual confirmation** (browser pane composited
frames this session): `tsc -b`/`build` clean; all 9 worlds cycled with a
screenshot, zero console errors; the sequence watched across two full
restarts with closely-spaced screenshots showing clearly distinct,
evolving framings (a wide elevated shot, a close landmark shot, a tight
character close-up, an inside-the-landmark shot at different points in
the same run) — not two static presets, genuine movement through space;
camera cleanly returned to normal chase framing after each sequence ended
(no stuck state); a mid-sequence seek cancelled the shot immediately with
zero errors and no lingering elevated framing; first-person mode confirmed
unaffected (the shot's `(1 - modeBlend)` suppression works). See §8 for
the full verification writeup, including a testing-methodology caveat
about the synthetic test track's trigger timing.

**Left untouched, deliberately (all zero diff, confirmed via
`git diff --name-only`):** `cinematicDirector.ts`, `Character.tsx`,
`musicEventDirector.ts`, `FeatureExtractor.ts`, `beatConsumer.ts`, route
generation, collision/clearance. Inside `CameraRig.tsx` itself: beat/drop
consumption, hi-hat/snare exclusion, first/third-person blend rate, FOV
base formula, speed-scaled follow distance/height, and the Stage 3
anticipation-pullback cue are all untouched — confirmed via `git diff`
showing only the two new blocks (the ref declarations and the shot
application) plus one added line in the look-target chain.

**Stage 5 — DONE (2026-08-28). Event archetype library + per-world
signature events.** The first content stage — Stage 1's animated-instance
plumbing finally has something in it.

**Architecture, matching this stage's brief exactly:**
`WorldDirector` decides WHEN (unchanged — it already owns `sequence`, the
phase/timing every event below is keyed off; it gained no new code this
stage). A new `world/worldEvents.ts` is the "world event executor": generic,
world-agnostic per-instance transform math. Each world's own `build()` (in
`worlds/definitions.ts`, plus `floatingIslands/Islands.tsx` for the bespoke
world) supplies the "world data" — which existing prop-group instances
participate and with what archetype/parameters, as a plain `EventBinding[]`
list. `WorldDirector` never touches a `Matrix4` or a mesh.

**Ten named archetypes, four real evaluator functions** (generic behaviors,
not ten separate implementations):
- `riseLike` — a lift + scale envelope, eased. Covers RISE, SUMMON, BLOOM,
  SURGE, ACTIVATE, REVEAL, and SWEEP (SWEEP adds a per-index stagger on
  top so the same envelope reads as a wave through the group).
- `spinUp` (and `riseLike`'s own optional `spinRate`, for lift+spin
  combined) — constant-rate rotation around the instance's own local axis.
- `scatterReform` — deterministic per-index scatter (cheap sine-hash, not
  `Math.random()` or a seeded RNG closure — zero allocation, same instance
  always scatters to the same offset every playthrough) that eases back to
  exactly the base transform.
- `FLYOVER` — **not wired into any world's bindings this stage.** It would
  be a translate-across variant of the same primitives applied to a single
  instance, but no world has an existing standalone "flying object" prop
  to reuse without adding new geometry (explicitly out of scope this
  stage). The type exists; no binding uses it. Flagged here rather than
  left as a silent gap.

**Per-world signature events** (all built from each world's own *existing*
hero/landmark prop groups — no new geometry):

| World | Group(s) animated | What happens |
|---|---|---|
| Cyberpunk Night | `towers` (6 tallest, capped for focus) + their own `windows` | Towers surge up through buildup→drop→transform, hold at full height through reveal, settle in aftermath; their window bands rise in exact lockstep (see "coherence" below) and cascade on in a staggered SWEEP during tension, with a synced brightness pulse at the drop |
| Desert Dream | `pyramids` (all 11) | Rise dramatically at the drop, keep climbing through transform, then rotate slowly (`riseLike`'s combined spin) for the whole reveal phase while holding at peak height |
| Underwater Abyss | `whales` (all 5) + `coral` (subset) | Whales surge upward through the sequence; coral blooms in a staggered wave with a synced pulse at the drop |
| Outer Dimension | `rings` (all 7) | Rise to full height by the drop, then spin up during transform (single-phase, holds afterward) |
| PS2 Night | `lampHeads` (all 46) | Staggered SWEEP "activation" down the street (scale pop), settling exactly back to base at the drop — literally "street lights activate in a sweep" |
| Fantasy Forest | `caps` (all 60) | Bloom open in a staggered SWEEP during tension, a synced pulse at the drop, settling through transform/aftermath |
| Abstract Void | `rings` (all 10) + `cyan` (first 24) | Rings rise then spin up during transform; a subset of cyan solids scatters into chaos and reassembles during that same phase — "solids scatter/reform" |
| Chaotic Carnival | `wheels` (all 8) + `spokes` (all 16) + `bulbs` (first 40, wheels 0-3's rim lights) | Wheels rise then spin up during transform — literally "ferris wheels spin up"; spokes move in exact lockstep (they're the wheel's own rigid crossbeams); a bulb subset chase-activates during tension |
| Floating Islands (bespoke) | pagoda `body`/`roof` tiers (all) | The world's signature structure rises out of the islands through the sequence, settling back down in aftermath — implemented by hand (see below), not through `createSignatureEventAnimated` |

**A real coherence bug found and fixed during this pass:** initially only
each world's *hero* group (towers, wheels) was bound to an event, leaving
their rigidly-attached decoration (window bands mounted on the facade,
ferris-wheel support spokes, rim bulbs) at their original height while the
hero structure rose or spun — the decoration would visibly detach from
what it's physically part of. Fixed by giving every attached secondary
group the *identical* lift/spin binding as its parent (see `windowBindings`/
`spokeIndices`/bulb binding in `definitions.ts`) so structurally-connected
pieces always move together. `coral`/carnival's chase-bulb *pattern* itself
(not tied to a rigid parent) was left as its own independent flourish.

**Floating Islands** hand-rolls its pagoda-rise event directly in
`Islands.tsx` rather than going through `OutlinedInstances`/
`createSignatureEventAnimated`, because that file already hand-rolls its
own instanced-mesh updates (predates Stage 1; folding it onto the shared
path remains flagged follow-up debt, not a Stage 5 prerequisite). It
reuses `worldEvents.ts`'s exported `riseLike` directly for the actual
math — same tuned behavior, no reimplementation.

**A second real bug found and fixed:** `Islands.tsx`'s hand-rolled version
initially only wrote new matrices while a binding was active, which meant
a seek/reset landing exactly mid-event would freeze the pagodas
permanently in their risen position (the idle case never wrote anything to
undo it). Fixed with edge-triggered detection (`pagodaEventWasActive`) —
one guaranteed "restore to base" pass the instant the event stops for any
reason, then zero further work until the next event, preserving both
correctness and the near-zero idle cost. **`createSignatureEventAnimated`'s
`OutlinedInstances`-based path does not have this bug** — Stage 1's
contract already calls `sample()` unconditionally every frame for every
flagged index, so it recomputes from scratch (idle → exact base copy)
every single frame regardless of what happened the frame before; the
Islands.tsx hand-rolled path needed the explicit edge-detection specifically
*because* it optimizes away that unconditional per-frame recompute.

**Route/collision:** every event is pure vertical lift, scale, or rotation
around a prop's own existing position — nothing moves laterally into the
corridor, nothing changes `routeGenerator.ts` or clearance math (`git diff`
confirms zero touches). `CameraRig.tsx`, `cinematicDirector.ts`,
`musicEventDirector.ts`, `musicController.ts`, `FeatureExtractor.ts`,
`beatConsumer.ts` are all zero diff.

**Determinism/continuity discipline:** every `SPIN_UP`/combined-spin
binding is confined to a single sequence phase (never spans two) — a
constant rate integrated against that phase's own `phaseTime` is exact and
continuous within the phase, but would snap to a different angle at a
phase boundary where `phaseTime` resets to 0, so no binding does that.
Consecutive phases' `liftFrom`/`liftTo` (etc.) are authored to match at
every boundary within one binding list, so a single prop's own arc never
visibly snaps — but **bindings do not cross-fade into each other's
different evaluator types the way Stage 4's camera shots do** (e.g. a
group switching from `riseLike` to `SCATTER_REFORM` between phases would
snap). None of the bindings actually authored this stage do that (the one
`SCATTER_REFORM` binding — Void's cyan subset — is deliberately isolated
to a single phase with no adjacent lift binding, so its "snap into
scattered" at that phase's start is an intentional beat, not an
oversight). This is a real, documented limitation, not silently avoided:
props tolerate a harder cut far better than the camera does, and building
full cross-fade machinery for this pass's scope wasn't worth the
complexity — flagged as a Stage 6+ concern if a future binding needs it.

**Known simplification:** Carnival's rim bulbs get the wheel's *vertical*
lift/spin so they don't visually detach, but do not orbit around the
wheel's true rotation center as it spins (that would need each bulb's
evaluator to know the wheel's pivot, not just mirror its lift) — small,
numerous, and already drawing attention via their own scale-chase, so
this reads as a minor imperfection rather than a coherence bug. Flagged
as a real gap for whoever author the next set of bindings.

**Performance:** `createSignatureEventAnimated`'s `sample()` runs every
frame for every flagged index (Stage 1's existing contract — same as any
other animated group), even when idle (a cheap `out.copy(base)` early
return). Total animated-instance counts per world stay well under 150
(largest: PS2's 46 + Forest's 60; smallest meaningful: Outer's 7) — small
relative to Stage 0's own finding that even ~1,660-instance full rewrites
cost well under 0.5ms. Measured live: **60fps sustained both at rest and
during an active event** (browser `requestAnimationFrame` sampling, see
§8) — no measurable frame-time regression from this stage.

**Stage 6 — DONE (2026-08-28). Cinematic character focus fix.** Redefined
by the user from the originally-planned "background/distant event layer"
(deferred, folded into Stage 8/9 below) after watching Stage 4/5's actual
output and finding the cinematic camera lost the character for most of a
sequence. See §10 for the full brief, the code-verified root-cause
diagnosis, and exactly what was changed to fix it — two files
(`cameraShots.ts`, `cinematicDirector.ts`), no new camera system, no
rewrite.

**Stage 7 — DONE (2026-08-28). Readability + spatial-collision polish +
the planned character ability.** Three user-specified fixes plus the
planned launch/glide/landing-shockwave ability. Full write-up in §11.
Summary:
- **Effect-brightness rebalance** — every system that reads the
  major-event envelope (`getMajorEventEnvelope()`) was stacking its own
  large boost off the same curve (bloom `env*4.5` additive, vignette lift
  to 0.15, chromatic aberration, prop emissive up to ~2.6x additive, rim
  2.1x, sky white-mix ~0.33, path/particle bursts), so a drop blew the
  frame to white. Each contributor bounded/clamped, nothing removed —
  bloom event term cut to `*1.7` + hard clamp + a rising
  `luminanceThreshold` (only true highlights bloom at peak), vignette
  floor `0.45`, emissive event term + total both clamped, rim event boost
  halved, sky white-mix `~0.16`, path ripple / particle burst eased back.
  7 files, all render-side, zero audio/route/director touches.
- **Cinematic-camera environment clearance** — `shared/cameraObstacles.ts`
  turns a world's own large prop-group matrices into coarse bounding
  spheres (`WorldDefinition.obstacleKeys`; Floating Islands builds its own
  from near islands + pagodas), surfaced on `WorldBase.cameraObstacles`.
  `CameraRig` runs a clearance pass **only while a cinematicDirector cut
  or the sequence shot is influencing the camera**: push the composed
  position out of any sphere it's inside, accumulate, clamp the total
  (`MAX_CLEARANCE_PUSH` 16), keep it above the local route surface, then
  ease the whole correction through a persistent offset so it fades in/out
  with no "invisible wall" snap. Gameplay chase camera, route generation,
  corridor-clearance math: all untouched.
- **Character/prop intersection** — diagnosis: the character rigidly
  follows the route centreline and never deviates, so it can only visibly
  clip something placed at/near the centreline or moved there by an
  event. Five `flank()` call sites (abyss columns/coral, outer shards, PS2
  trunk-canopies, desert cacti) passed `ownRadius` 0/too-small for the
  prop's true size, leaving near faces on the corridor edge — each given
  its real radius + a slightly larger base margin (a sixth, forest
  crystals, was tried and reverted in the §11.5 verification pass — see
  §11.6). Headless before/after vs `1e38320` confirms these **improve**
  every targeted group with **no new intrusion**. Abstract Void's
  `SCATTER_REFORM` (`scatterRadius: 14` on cyan solids based as little as
  4 units past the corridor edge) was the one genuine event-driven
  intrusion — now restricted to comfortably-clear instances, reach pulled
  to 10, drama shifted vertical. `routeGenerator.ts` + clearance math:
  zero diff. A handful of pre-existing hairpin-graze props (~6 total,
  since the nine-world build, not touched by Stage 7) remain — §11.6.
- **Character ability** — the planned launch → glide → landing shockwave,
  built entirely on the existing major-event jump lifecycle in
  `Character.tsx` (no new system, no new director). A `'glide'` jump phase
  — ~0.6s near-weightless apex hang with an arms-wide / legs-trailing /
  forward-pitch pose — fires only on the strongest (drop-caused, ≥0.82)
  major events; the landing `groundImpact` shockwave now scales with the
  launch intensity. Everything from `JUMP_INTENSITY_BAR`..0.82 keeps the
  plain launch+land, unchanged.

**Stage 8 — Variety, history, weighted selection, replayability**, plus
the original Stage 6 background/distant event layer (deferred here).

**Stage 9 — Cross-world polish and performance pass.**

**Stage A (optional, parallel — biggest single quality unlock):** offline
pre-analysis of the decoded `AudioBuffer` at load time to build a timeline
of drops/sections *ahead of playback*. This is the only way to get genuine
buildup and tension rather than post-hoc reaction. It is **additive** — the
realtime path stays exactly as-is — but it is the largest new subsystem
here, so it is flagged separately rather than assumed.

---

## 8. Testing / verification criteria

**Every stage:** `npx tsc -b` and `npm run build` clean; all 9 worlds mount
and unmount with zero console errors; a full synthetic-track playthrough
(quiet → build → drop → drums-cut → breakdown → return) with zero errors.

**Stage-specific:**

- **0/1 (perf):** FPS sampled in a fixed world before/after, same camera
  position and track offset. Animated instances must not regress the
  baseline beyond an agreed budget. Performance has regressed before — this
  gets measured, not assumed.
  **Zero-animated-groups criterion (added after Stage 1):** since no world
  populates `animated` yet, the load-bearing check for Stage 1 is that the
  new `useFrame` branch in `OutlinedInstances` is unreachable, not merely
  fast, for every group in every world — true by construction (`animated`
  is `undefined` everywhere), and confirmed structurally since this
  session's browser tool could not get the preview pane to composite
  frames (`document.hidden` was `true` for every tab opened — the
  known "browser preview has been unreliable" issue `HANDOFF.md` already
  documents, not a Stage 1 regression). What *was* verified live: `tsc -b`
  and `npm run build` clean; all 9 worlds' mount/dispose paths (the
  `useEffect` static-upload path, which doesn't depend on `requestAnimationFrame`)
  exercised repeatedly with zero console errors; a full ~20s synthetic
  WAV (quiet → build → drop → cut → breakdown → return, dropped in via a
  simulated `DragEvent`) played to completion with zero console errors.
  A live FPS before/after capture and a runtime confirmation of the
  animated-branch skip still need an actual screenshot/session from the
  user, or a future session where the preview pane composites — flagged
  as outstanding, not silently assumed passing.

  **Outstanding / manual verification (not failures — blocked by tooling):**
  1. Live FPS/frame-time before-vs-after capture in a fixed world at an
     identical camera position and track offset.
  2. A runtime confirmation (e.g. a temporary counter) that the animated
     `useFrame` branch is actually skipped every frame, observed live.

  Both are blocked purely by the browser tool's preview pane not
  compositing frames in that session (`document.hidden` was `true` on
  every tab — the pre-existing issue `HANDOFF.md` §2 already documents),
  not by anything about the Stage 1 code. The structural argument for #2
  (the branch is behind `if (!animated || ...) return` and no world sets
  `animated`, so it is unreachable, not merely untriggered) still stands
  and was verified by reading the code, not by assuming it. Close these
  out with an actual screenshot/session from the user, or a future session
  where the preview pane composites.
- **2 (parity) — DONE (2026-08-27), what was actually verified:**
  `npx tsc -b` and `npm run build` clean. All 9 worlds cycled through the
  switcher (mount + unmount for each, exercising both `WorldScene.tsx`'s
  and `FloatingIslandsScene.tsx`'s `MusicEventDirector` mount point) with
  zero console errors. The `resetToken` → `WorldDirector.reset()` path was
  exercised twice live with zero errors: once via a scrub-seek mid-track,
  once via the restart button. `WorldDirector.step()` ran error-free
  during several real seconds of active playback in each synthetic-track
  test. `musicEventDirector.ts` itself has zero diff (`git diff` confirms),
  so its behavior is untouched by construction, not just by observation.
  **Not verified live — same tooling limitation as Stage 0/1:** a true
  side-by-side visual capture at identical track offsets pre/post refactor
  (the pane still would not composite frames this session — `document.hidden`
  was `true` throughout), and a full natural-end playthrough with a live
  timer readout (the displayed transport time froze under what looks like
  Chrome's background-tab timer/audio throttling on a tab that's never
  actually visible to a compositor — a `tickTime()`/`AudioContext` timing
  artifact, not a code error; zero console errors appeared in any of these
  sessions, and the underlying `AudioEngine`/`audioStore` code is
  unmodified by Stage 2). Since the actual Stage 2 diff is two one-line
  call-site swaps to functions that are themselves untouched, the risk
  surface for an undetected visual regression here is about as low as a
  refactor can have — but it is still recorded as outstanding rather than
  assumed passing. Close out with a real screenshot/session from the user,
  or a future session where the preview pane composites and the tab stays
  genuinely foregrounded.
- **3 (drop sequence) — DONE (2026-08-27), genuinely verified live:** unlike
  Stages 0-2, the preview pane actually composited frames this session
  (`document.hidden` was `false`) — this is real visual verification, not
  the structural-argument fallback used previously. `npx tsc -b` and
  `npm run build` clean. All 9 worlds cycled with a screenshot of each
  (Floating Islands, Cyberpunk Night, Desert Dream, Underwater Abyss,
  Outer Dimension, PS2 Night, Fantasy Forest, Abstract Void, Chaotic
  Carnival) — all render correctly, zero console errors. A synthetic WAV
  (3s quiet intro -> a sudden loud bass-heavy section) was played twice
  (once via natural playback, once via the restart button) and screenshot
  at intervals across the sequence:
  - Right at the drop trigger: visible chromatic-aberration fringing and a
    bloom spike appear immediately — the release reads as sudden, not
    gradual.
  - ~3s into the sequence (restart run): `cinematicDirector`'s existing
    landmark shot fired on its own (zero code touched in that file this
    stage) — a dramatic framed shot of a landmark with strong bloom halo,
    confirming the untouched cinematic system layers correctly on top of
    the new sequence.
  - ~7s and ~17s in: sustained warm, elevated atmosphere/bloom relative to
    baseline — the multi-second "transform/reveal" hold is visually
    present, not a flash.
  - After the sequence's ≈13s: camera and atmosphere visibly settled back
    to normal gameplay framing, confirmed by a mid-sequence seek test
    (see below) showing completely normal (non-elevated) camera/atmosphere
    immediately after a seek past the sequence.
  Natural end was reached cleanly (0:00/0:22, ready state, zero errors).
  Restart re-triggered a full sequence correctly (no double-trigger, no
  stale state). A mid-sequence seek correctly cancelled the in-flight
  cinematic shot and returned to plain gameplay camera framing with zero
  errors — confirming reset-on-seek works. Switching worlds mid-loaded-
  track was also exercised (Chaotic Carnival -> Floating Islands while a
  track was loaded) with zero errors.
  **Not performed:** the explicit mute/sound-off legibility test (the
  screenshots above already show the sequence is visually legible from
  post-processing/camera/lighting changes alone, independent of any audio
  waveform overlay, so this specific framing of the check is implicitly
  covered, but muting and re-screenshotting was not done as a separate
  step). **One stale-HMR false alarm** during this session: a
  `ReferenceError: majorEventState is not defined` appeared in the console
  from an intermediate mid-edit HMR state while the dev server was live-
  applying edits as they were written; a fresh tab (per `HANDOFF.md`'s
  documented caveat) showed zero errors against the final code, and the
  full verification pass above was run against that clean state.
- **4 (camera) — DONE (2026-08-28), genuinely verified live:** browser pane
  composited frames this session (`document.hidden` was `false`). `tsc -b`/
  `build` clean. All 9 worlds cycled with a screenshot each, zero console
  errors. The sequence was watched across two full restarts on Chaotic
  Carnival with closely-spaced screenshots: distinctly different framings
  captured at different points in the same run (a wide elevated shot over
  a ring landmark, a tight character close-up with strong rim light, a
  close orbiting shot from inside/near the landmark, a receding wide shot)
  — genuine evolving camera movement, not two static presets toggling.
  Camera returned cleanly to normal third-person chase framing after each
  sequence completed, with no stuck/frozen state. A mid-sequence seek
  cancelled the shot immediately (zero errors, no lingering elevated
  framing). First-person mode confirmed unaffected — toggling to it during
  an active sequence showed a normal first-person view with no shot
  bleed-through, confirming the `(1 - modeBlend)` suppression works.
  **A hard fallback to the gameplay camera exists structurally**: the
  sequence shot only ever *lerps toward* the gameplay-computed `position`/
  `lookTarget` by a weight that is 0 whenever `WorldDirector.sequence.phase
  === 'idle'` (returned directly, no shot math even runs) — there is no
  code path where the gameplay camera computation itself is skipped.
  **Re-confirmed hi-hats/snares never move the camera:** `cameraShots.ts`
  consumes no audio features at all (only `MajorEventState`/route/landmark
  data); `git diff` on `CameraRig.tsx` shows the existing beat-consumption
  block (which already excludes hi-hats/snares) is untouched.
  **Testing-methodology caveat, not a Stage 4 bug:** the synthetic test
  track used to exercise the sequence triggered unusually early (within
  ~1-2s of playback/seek starting, well before the track's intended ~3s
  "drop" point) on multiple runs. This traces to the *existing, unmodified*
  trigger-sensitivity of `musicEventDirector.ts`'s trigger conditions
  reacting to a freshly-reset `FeatureExtractor` baseline meeting sudden
  audio — `git diff` confirms zero changes to that file, `FeatureExtractor.ts`,
  or any threshold this stage. It made the *exact* real-time phase timeline
  harder to predict when scripting screenshots, but did not prevent
  verifying the actual thing this stage needed to prove (visible,
  evolving, non-snapping camera movement across a real sequence,
  triggered via the app's own unmodified detection, not a stub). **Not
  performed:** an exhaustive multi-world sweep of the sequence itself (only
  Chaotic Carnival was used for the detailed sequence capture; the other 8
  worlds were only confirmed for normal-gameplay rendering, not with an
  active sequence) — reasonable given the shot math only depends on
  route/landmark data every world already provides identically, but worth
  a spot-check in a future session if a world-specific visual issue is
  ever reported.
- **5 (world events) — DONE (2026-08-28), genuinely verified live:**
  browser pane composited frames this session (`document.hidden` was
  `false`). `tsc -b`/`build` clean. All 9 worlds cycled at rest with a
  screenshot each — zero console errors, all render exactly as before
  this stage (confirms "existing worlds still work when no event is
  active"). A synthetic drop track triggered signature events on three
  worlds with screenshots:
  - **Chaotic Carnival:** an extreme close shot on the ferris wheel's
    glowing spokes mid-sequence (strong bloom halo, clearly the
    SPIN_UP/rise event, not a lighting-only change); a later shot showed
    the wheel back at normal height/rest after the sequence ended.
  - **Cyberpunk Night:** a dramatic low-angle shot with the ENTIRE
    skyline's windows brilliantly lit (the ACTIVATE/SWEEP cascade), then
    a wide aerial shot moments later — visibly different composition,
    confirming both the camera and the event evolved together.
  - **Fantasy Forest:** an extreme close shot on oversized, overexposed
    mushroom caps (the BLOOM scale-up), then a wider shot showing
    noticeably larger pink caps than the at-rest baseline screenshot.
  Natural end → restart re-triggered a full event correctly each time
  (tested on Carnival and Cyberpunk). A mid-event seek (Fantasy Forest)
  immediately returned the mushroom cap to its normal (un-bloomed) size
  and the camera to normal framing, with zero errors — confirms reset
  works correctly during an active event, not just between sequences.
  World-switch mid-loaded-track was exercised (Cyberpunk → Floating
  Islands → Cyberpunk) with zero errors. **Performance:** live FPS
  sampling via `requestAnimationFrame` showed **60fps both at rest and
  during an active event** (3s sample spanning buildup→transform) — no
  measurable degradation.
  **Not performed, flagged as outstanding:** a detailed per-world
  screenshot pass for the other 6 worlds' signature events (Desert,
  Abyss, Outer Dimension, PS2, Void, Floating Islands) — only confirmed
  at rest, not with an active event captured. Given time already spent on
  this stage and that every world's binding uses the exact same four
  evaluator functions already visually confirmed working correctly on
  three worlds, this is a reasonable but real gap, not a claim of full
  coverage. A definitive (non-screenshot-luck-dependent) verification —
  e.g. reading the actual `InstancedMesh` matrices from the live scene
  graph — was attempted and abandoned (the fiber-tree traversal used to
  locate the R3F scene didn't succeed in the time available); screenshots
  remain the verification method actually used.
  **One testing-methodology note, not a Stage 5 bug:** the synthetic
  track's cold-start trigger timing (same pre-existing, unmodified
  `musicEventDirector.ts` characteristic flagged in Stage 4's write-up)
  again made it hard to predict exactly which real-clock second would
  show which phase, so screenshots were taken opportunistically across a
  spread of timestamps rather than at planned phase boundaries.
- **6 (cinematic character focus) — DONE (2026-08-28), genuinely verified
  live:** browser pane composited frames this session (`document.hidden`
  was `false`). `tsc -b`/`build` clean, zero console errors across every
  test below. Muted/volume-0 throughout per the user's request (in
  school, no audio) — confirmed via the UI's mute icon before any track
  was loaded, verified again after.
  - **Character visibility, the core ask:** watched a full sequence on
    Cyberpunk Night with closely-spaced screenshots. Multiple frames
    (≈0:09, ≈0:14, ≈0:19 into the take) showed the character clearly
    centered and readable with the skyline visible behind/around them —
    exactly the "wide shot where character is small but clearly readable"
    and "character + environment together" compositions the brief asked
    for. This is a stark contrast with Stage 4/5's own verification
    screenshots (re-examined for comparison), where the character was
    essentially never in frame during the moving-shot phases.
  - **Environment-only shots still happen, appropriately:** a Floating
    Islands take showed a wide aerial reveal-style shot with no character
    in frame — consistent with `reveal`'s intentionally higher
    `lookWeight`, and not excessive (one such shot observed across
    multiple full sequences watched).
  - **Natural end → restart:** confirmed clean (Cyberpunk Night, twice).
  - **Seek mid-sequence:** confirmed clean — camera returned to normal
    gameplay framing immediately, zero errors, no stuck cinematic state.
  - **First-person mode:** confirmed unaffected — toggling to it during
    an active sequence showed a normal first-person street-level view
    with no shot bleed-through (the `(1 - modeBlend)` suppression from
    Stage 4 still applies unchanged).
  - **All 9 worlds cycled** (third-person, after the first-person check)
    with zero console errors — normal gameplay camera confirmed unchanged
    outside a sequence.
  - **Not exhaustively re-verified per-world:** only Cyberpunk Night and
    Floating Islands got a close sequence-in-progress look this session;
    the other 7 worlds were confirmed only for normal (non-sequence)
    rendering. The fix is world-agnostic (works purely off
    `characterPos`/`landmarks`/route-frame vectors already passed into
    `cameraShots.ts` for every world identically), so this is a
    reasonable but real gap, consistent with how Stage 4/5 also left
    some worlds' sequences unscreenshotted.
  - **Testing-methodology note, not a Stage 6 bug:** same as every prior
    stage — the synthetic test track's cold-start trigger timing made
    exact phase timing hard to predict, so screenshots were taken
    opportunistically rather than at planned phase boundaries.
- **6 (background)** *(renumbered — this criterion is for the ORIGINAL
  Stage 6 concept, background/distant events, now deferred into Stage
  8/9; not this session's redefined Stage 6 above)*: distant events never
  obscure the path or the character; frequency stays rare.
- **7 (abilities):** abilities remain rare and musically earned; landing
  recovery still settles naturally.
- **8 (variety):** the *same track played twice* produces a measurably
  different event sequence, while world geometry stays identical.
- **Global regression each stage:** route/collision untouched
  (`git diff` on `routeGenerator.ts` and clearance logic must be empty);
  seek/pause/restart still reset all new stateful systems.

---

## 9. Architectural risks and things to avoid

1. **Per-frame instance rewrites are the main perf risk.** Mitigation:
   only animate groups involved in an *active* sequence; static groups keep
   the write-once path; cap total animated instances; never animate the
   distant depth-layer groups.
2. **Don't route everything through the director.** Beat-level reactions
   must stay local, or quiet passages go dead and the whole thing feels
   gated.
3. **Over-gating spectacle.** If all the interest requires a rare event,
   the 90% of a track between events gets worse. Keep the ambient layer.
4. **Reset paths are a repeat offender.** Every new stateful system must
   hook `resetToken` alongside `resetMusicEventDirector` /
   `resetCinematicDirector` / `resetRhythmState`, or seeking corrupts state.
   This has caused real bugs twice already.
5. **Determinism vs. replayability.** World geometry is seeded and must
   stay reproducible; only *event selection* should vary. Seed the
   selection RNG per playback session so any given session is still
   reproducible for debugging.
6. **Camera safety.** Moving shots are the easiest way to produce a
   nauseating or broken frame. Every path needs clamping and a guaranteed
   fallback.
7. **`src/scenes/cyberpunkCity/` is now a misnomer** — it holds the shared
   engine (`CameraRig`, `Character`, `musicController`, both directors,
   `routeGenerator`), not a world. Recommend renaming to
   `src/scenes/core/` **before** the director grows, while it is still a
   mechanical ~15-import change. It will only get more confusing.
8. **Sequence/lifecycle collisions.** With longer sequences, a second
   trigger can arrive mid-sequence. Define the policy up front:
   ignore, queue, or interrupt — per archetype.

---

## 10. Stage 6 — Cinematic character focus — DONE (2026-08-28)

**This section is kept as a permanent record of the diagnosis and brief,
not just pre-implementation planning** — the reasoning below is still the
best reference for why the fix looks the way it does. See "What was
actually implemented" partway through for the concrete result.

### The problem, in the user's words (2026-08-28)

> During major sequences, the camera often focuses heavily on the
> environment/landmark. It will sometimes stay focused on the environment
> for a long cinematic shot, briefly cut toward the character, show the
> character for only a second, then move right back to focusing on the
> environment. That is NOT what I want. The character is the main thing
> the viewer is following. **Music → Character → Camera → Environment**,
> not just **Music → Environment**.

### Root cause — actually found in code, not guessed

**`cameraShots.ts` (Stage 4) is the primary cause.** All three shot
primitives — `push`, `orbit`, `sweep` — set `outLook.copy(target)`
(confirmed by re-reading the file this session: lines ~143/150/161).
`target` is `lockedTarget`, the nearest landmark to the character *at the
instant the sequence started* (locked once, see `getSequenceCameraShot`).
**`characterPos` is read exactly once** — to pick that initial landmark —
**and never touched again by any shot math.** Every frame of buildup,
tension, most of transform, reveal, and aftermath (i.e. the majority of
the ~13s sequence — the ~3s `cinematicDirector` cut around the drop is the
only exception) is a camera that both POSITIONS itself relative to and
LOOKS AT a static landmark point, full stop. The character is never the
subject of any Stage 4 shot.

**A second, compounding mechanism:** because `lockedTarget` is a single
static world-space point and the character keeps running forward along
the route for the whole sequence, the character physically moves away
from that locked point as the sequence progresses — even in the first
frame, when the shot might have incidentally framed the character near
the landmark, continued running drifts them out of frame with nothing
tracking them.

**`cinematicDirector.ts` (pre-Stage-4) is comparatively fine and is
*not* the main problem.** Of its 7 shot types, 6 already look at
`characterPos` (`wideEstablishing`, `dramaticClose`, `sideTracking`,
`lowAngle`, `overhead`, `frontFacing`) — only `'landmark'` looks at
`target`. It's picked often (whenever a landmark is near, which is
frequent), and when it IS picked it's genuinely landmark-only — but the
majority of its own shot vocabulary is already character-focused. **Don't
assume this file needs a rewrite; it likely just needs its selection
weighting nudged (favor `dramaticClose`/`frontFacing` over `landmark`
during a Stage 6 sequence) rather than its shot math changed.**

**Net effect matching the user's exact complaint:** the brief
`cinematicDirector` cut (drop, ~3s) sometimes shows the character
(`dramaticClose`/`frontFacing`) or sometimes doesn't (`landmark`) — that's
the "briefly cut toward the character for one second" — and then Stage
4's shot system, which is live for the rest of the ~13s and structurally
cannot look at the character at all, is the "right back to the
environment."

### What NOT to do

- Don't add random extra character cuts on top of the existing shots —
  the brief explicitly warns this makes it worse (more disconnected
  cutting, still no coherent "camera is with the character" feel).
- Don't build a second camera system. `CameraRig`/`cameraShots.ts`/
  `cinematicDirector.ts` are the right places to extend.
- Don't drop landmark/environment shots entirely — Stage 5's whole
  purpose (world events) needs a camera that can still show them off,
  especially for `reveal`. The fix is *default-to-character, environment
  only when it earns it* — not remove environment framing.

### What was actually implemented

The hypothesis below held up once actually built and watched — no bigger
rewrite was needed. Two files changed, both minimal:

**`cameraShots.ts`:** each `ShotSpec` gained **two** independent weights,
not just one — `pivotWeight` (0 = character, 1 = landmark) for POSITION
and `lookWeight` (0 = character, 1 = landmark) for LOOK-AT, both blending
between `characterPos` (now threaded through `evaluateShot`, not
discarded after the initial landmark lock) and the locked `target`.
Decoupling the two turned out to matter: `reveal` uses a LOW `pivotWeight`
(camera position stays close to the character, so they read as a
foreground/scale reference) combined with a HIGH `lookWeight` (the camera
looks mostly toward the landmark) — exactly the "character in foreground,
landmark behind them" composition the brief asked for, which a single
combined weight couldn't express. This also incidentally fixed the
"character drifts out of frame over the ~13s sequence" mechanism flagged
in the original diagnosis below: because most phases now have a LOW
`pivotWeight`, the camera's position is majority character-anchored and
therefore tracks them continuously (via `characterPos`, updated every
frame) instead of staying locked to the one static point the character
keeps running away from. Final per-phase weights (`pivotWeight`/
`lookWeight`): buildup 0.2/0.15, tension 0.15/0.2, drop 0.3/0.25,
transform 0.35/0.3, reveal 0.25/0.7, aftermath 0.15/0.1 — low almost
everywhere (character-anchored), reveal is the deliberate outlier.

**`cinematicDirector.ts`:** exactly the nudge the diagnosis predicted
would be enough — the major-event branch's `pickVaried` preference order
flipped from `('landmark', ['dramaticClose', 'frontFacing'])` to
`('dramaticClose', ['frontFacing', 'landmark'])`. Character-focused shots
are now the default for the drop's cinematic cut; `'landmark'` is still
reachable (variety, `pickVaried` falls through to it), just no longer the
first choice. Nothing else in this file changed — shot math, durations,
`MIN_GAP`, the `dropHit`/landmark-proximity/district-transition branches
(normal-gameplay cinematic variety, unrelated to the Stage 3 sequence) are
all untouched.

No new camera system, no rewrite of `evaluateShot`'s core position
formulas (push/orbit/sweep math itself is unchanged) — confirming the
brief's instinct that this was a targeting/composition problem, not an
architecture problem.

### Full user brief for Stage 6 (verbatim scope, preserved for the next session)

**Goal:** cinematic system should feel like a music video / anime game
sequence — character remains the visual anchor throughout, environment
complements rather than replaces them as the subject. Environment-only
shots should be intentional and relatively rare (reveal is the main
legitimate case), not the default.

**Good compositions to aim for:** character in foreground with landmark
behind; character moving across frame; character silhouetted against a
reveal; over-the-shoulder framing; low-angle character shot; wide shot
where character is small but readable; orbit around character +
environment; tracking shot following the character.

**Per-phase intent:**
- Buildup: follow character while gradually revealing environment; can
  pull back to show something approaching/activating around them.
- Tension: character stays visible; orbit around character while
  environment changes in background; framing should feel like
  anticipation.
- Drop: strong character-centered movement; environment can react/explode
  behind them; a wide shot showing both is fine; don't abandon the
  character for a landmark-only shot.
- Transform: follow/orbit the character while environmental changes
  happen around them; character's own movement should give the camera a
  reason to move.
- Reveal: environment-focused shots are appropriate here, but keep the
  character as foreground/silhouette/scale reference whenever reasonably
  achievable.
- Aftermath: return attention to the character; let them keep moving
  through the transformed world.

**Preserve, do not throw away:** Stage 1 instance plumbing, Stage 3
long-form sequences, Stage 4 moving shots (the primitives are good — it's
specifically their look-at target that's wrong), Stage 5 world
events/signature events, Phase 5 speed tuning, character locomotion,
rhythm/energy reactions, the existing `cinematicDirector` lifecycle
(extend its selection weighting, don't rewrite its shot math).

**Protected, do not modify unless absolutely necessary:**
`FeatureExtractor`, beat-detection thresholds, `beatConsumer`, the
audio-context clock, route generation, collision/clearance math, Phase 5
speed tuning, hi-hat/snare camera exclusion. Hi-hats/snares must never
gain any camera influence as part of this stage.

**Verification must be genuinely visual** (watch complete sequences, not
just build/typecheck) and specifically check: character visible
substantially more often; camera feels like it's following the character;
environment-only shots feel rare/earned, not excessive; character+
environment compositions look intentional; character stays readable
during drops; large landmarks still get shown off; transitions stay
smooth; the whole sequence reads as one continuous cinematic; normal
gameplay camera and first-person mode both unaffected.

**Git:** same discipline as every prior stage — full diff review, protected-
system check, remove any temp/debug code, commit ALL intended changes,
`git status` clean, report commit hash + ahead-of-origin count, do not push
unless explicitly asked, stop after Stage 6 for review before Stage 7.

---

## 11. Stage 7 — Readability + spatial-collision polish + character ability — DONE (2026-08-28; verification/polish 2026-08-29)

Four changes, in the priority order the user set (route reliability >
character movement > cinematic intent > no visual intersections > smooth
correction). No protected system was modified: `FeatureExtractor`,
`beatConsumer`, the audio-context clock, `routeGenerator.ts`,
corridor-clearance math, Phase 5 speed tuning (`musicController.ts`
constants), `musicEventDirector.ts` trigger conditions, and the
hi-hat/snare camera exclusion are all **zero diff** (`git diff
--name-only` confirms none of those files are in the changeset;
`worldEvents.ts` has a doc-comment-only diff).

### 11.1 Effect-brightness readability rebalance

**Diagnosis (found in code).** Every reactive system reads the same
`getMajorEventEnvelope()` 0..1 curve and applies its OWN large boost off
it, independently, with no shared budget:

| System | Pre-Stage-7 major-event term |
|---|---|
| `VisualizerCanvas` bloom | `+ env * 4.5` additive on top of `0.5 + energy*1.6 + pulse*0.9` — a ~14x jump over the 0.5 base |
| `VisualizerCanvas` vignette | `darkness` down to `0.15` (near-total removal of the frame) |
| `VisualizerCanvas` chromatic | offset up to `0.006` |
| `WorldScene` prop emissive | `+ (reactive.event) * env`, weights up to **2.6** — `col += uColor * uEmissive` makes the prop 3.6x its own colour, pure additive |
| `WorldScene` prop rim | `baseRim * (1 + env*1.1)` — 2.1x, and rim is a near-white additive edge term (art-direction point 4: at full strength it "blows everything out to white") |
| `ProceduralSky` / `IslandSky` | `mix(col, white, env*0.32..0.35)` |
| `WorldPath` ripple | `impactStrength = 3.2 + major*2.2`, then `* 1.6` in-shader |
| `WorldParticles` burst | `2.2 + major*2`, feeding size + opacity boosts |

Combined at a drop (`env ≈ 0.85-1.0`) the frame clipped to white and the
cel-shaded value separation, character, environment and landmarks all
disappeared.

**Fix — a controlled reduction, nothing removed.** Every contributor was
bounded so a drop still reads as a powerful surge but the scene stays
readable:

- **Bloom:** event term `*4.5 → *1.7`, base terms trimmed
  (`energy*1.6→*1.3`, `pulse*0.9→*0.7`), whole value hard-clamped to
  `3.1`. **`luminanceThreshold` now RISES with the envelope**
  (`0.22 + env*0.16`) — the single most useful lever: at peak, only genuine
  highlights bloom, mid-tones (the readable part) stop smearing.
- **Vignette:** floor `0.15 → 0.45` — the frame always keeps a visible
  edge darkening; a major event can't open the whole image to white.
- **Chromatic aberration:** `env*0.006 → env*0.0038` for legibility.
- **Prop emissive (`WorldScene`):** the event contribution is clamped to
  `1.1` (a "prop ignites" moment still clearly reads) and the summed
  emissive clamped to `1.7`.
- **Prop rim (`WorldScene`):** event boost `1 + env*1.1 → 1 + env*0.5`.
- **`Islands.tsx`** (bespoke world, same pattern): body emissive event
  term `env*1.2 → env*0.6` (clamp 1.7), canopy `env*0.5 → env*0.28`
  (clamp 1.2), rim `1 + env*1.1 → 1 + env*0.5`.
- **Sky:** `ProceduralSky` white-mix `0.32 → 0.16`, `IslandSky`
  `0.35 → 0.17`.
- **`WorldPath`** major ripple `3.2 + major*2.2 → 2.0 + major*1.3`.
- **`WorldParticles`** major burst `2.2 + major*2 → 1.3 + major*1.1`.

Beat-level and mood/drums reactivity are all untouched — only the
major-event stack was rebalanced.

### 11.2 Cinematic-camera environment clearance

**Approach.** The corridor tube around the route is the guaranteed-clear
volume and must not be touched (protected). Cinematic shots deliberately
leave it (46+ units laterally to frame a landmark), which is where they
can clip props. Rather than a full obstacle system or constraining the
shots, Stage 7 adds a **camera-only soft-avoidance pass** driven by coarse
data each world already produces:

- `shared/cameraObstacles.ts` — `obstaclesFromMatrices()` decodes a
  group's instance matrices into `{position, radius}` bounding spheres
  (`radius = clamp(0.5*maxHorizontalScale + 0.15*heightScale, min, 20)`;
  the 20-unit cap stops one colossal prop from becoming an avoidance field
  that shoves the camera out of every shot meant to frame it).
  `collectObstacles(groups, keys)` gathers several named groups at once.
- `WorldDefinition.obstacleKeys` (new, optional) names each world's big
  solid groups: Cyberpunk `towers`; Desert `pyramids`+`mesas`; Abyss
  `whales`+`columns`; Outer `rings`; PS2 `houses`+`canopies`; Forest
  `caps`+`trunks`+`canopies`; Carnival `wheels`+`tents`. **Abstract Void
  deliberately declares none** — its geometry is small scattered solids
  plus hollow rings the path threads through on purpose.
- `WorldScene` builds the list once (in the `world` memo) and passes it on
  `WorldBase.cameraObstacles`. Floating Islands' `worldGenerator.ts`
  builds its own from near islands (rock masses) + pagodas.
- `CameraRig` — a new block right before `camera.position.copy(position)`,
  gated on `cineBlend > 0.001 || seqBlend > 0.001` (**the plain gameplay
  chase camera never enters this path**). For each sphere the composed
  position is inside, it accumulates a radial push to the sphere surface +
  `CAMERA_CLEARANCE` (3.5) margin; clamps the total to `MAX_CLEARANCE_PUSH`
  (16); adds a floor so a shot can't drop below `frame.position.y +
  MIN_GROUND_CLEARANCE` (2.5); then **eases the applied correction through
  a persistent `clearanceOffset` ref** (`1 - exp(-dt*6)`) so it fades in
  and out — no snap, no "invisible wall". Zero per-frame allocation (two
  reused `Vector3` refs, scalar math per obstacle). When no shot is
  active the target is zero and the offset eases back to zero on its own.

A small deviation from the planned trajectory is accepted; a shot flying
through a building is not — matching the brief's explicit trade-off.

### 11.3 Character/prop intersection

**Diagnosis.** `characterMotionState.position` is set to the exact route
frame position every frame by `CameraRig`; `Character.tsx` renders at that
point with no lateral offset and no collision logic. So the character can
only *visibly* pass through something that is (a) placed at/near the route
centreline, or (b) moved there by an event. `flank()` places every static
prop at `corridorRadius + ownRadius + extra` from the centreline, and
`corridorRadius` (≥4.5) alone already clears a ~0.3-wide runner — **so no
correctly-placed static prop can actually intersect the character.** Two
real gaps:

1. **`ownRadius` omitted / too small** at several `flank()` call sites, so
   a prop's *near face* landed on or just inside the corridor edge — a
   leaning column / shard right at the visible path edge reads as "the
   character clipped it" in the foreshortened third-person view even
   though centres never met. Fixed by passing each prop's real radius and
   bumping the base margin: abyss `columns` (`+2.5`), abyss `coral`
   (`+h*0.5`), outer `shards` (`+h*0.22`), PS2 trunk-`canopies` (trunk
   ownRadius `2.8 → 3.6` to cover the wider canopy above it), desert
   `cacti` (`0.6 → 1.3` for the saguaro arms). Fantasy Forest `crystals`
   was also changed in `46c373c` but **reverted** in the verification
   pass — the tweak nudged one hairpin-inside crystal marginally worse,
   and crystals are too small (footprint ≤1.5) for `ownRadius` to matter
   (§11.5/§11.6). RNG call order/count in each expression is unchanged, so
   world geometry stays deterministic.

2. **Abstract Void `SCATTER_REFORM`** — the one genuine event-driven
   intrusion. `scatterRadius: 14` on cyan solids whose base clearance is
   `4 + rng()*70` dragged 8-unit octahedra straight across the corridor
   during `transform`. Fixed in the binding data (not the shared
   evaluator): `buildVoid` now records each cyan solid's placement margin,
   and `cyanScatterIndices` is filtered to instances placed `> 26` units
   clear of the corridor (then capped at 18 for focus); `scatterRadius`
   pulled `14 → 10` with the drama moved into `scatterHeight`/spin. The
   "assemble out of chaos" beat reads the same; nothing crosses the
   corridor. `worldEvents.ts`'s `scatterReform` doc now states the
   constraint for future binding authors (it has no route data to clamp
   against itself).

Floating Islands' near islands intentionally poke a few units inside the
corridor radius but sit *below* the walkway ("run over/past islands") —
left as-is per the brief's "intentionally decorative/non-solid" allowance.

### 11.4 Character ability — launch / glide / landing shockwave

Built entirely on the existing major-event jump lifecycle in
`Character.tsx` (`anticipation → air → land`, already gated on
`majorEventState` — the director). No new system, no new state singleton,
no `resetToken` hook needed (same as the existing jump: `Character` is
keyed by `trackGeneration` so it remounts on a new track; a seek
mid-jump resolves naturally as before).

- **Launch:** unchanged trigger (`majorHit > JUMP_INTENSITY_BAR`), but
  the launch velocity is now `8.4` (was `7.2`) for glide-eligible events
  so the arc is visibly bigger.
- **Glide:** a new `'glide'` `JumpPhase`, entered once at the apex
  (`jumpVelY <= 0`) **only if the triggering event was strong**
  (`jumpIntensity > GLIDE_INTENSITY_BAR = 0.82` — drop-caused events score
  ~0.85+). Near-weightless (`GLIDE_GRAVITY 4` vs `GRAVITY 20`) for
  `GLIDE_DURATION 0.6s`, then normal gravity resumes for the descent. A
  `hasGlided` one-shot guard prevents re-entry. Pose: an eased
  `glideBlend` opens the arms wider (`airSpread + glide*0.5`), lets the
  legs trail (`airTuck * (1 - glide*0.6)`), and adds a forward torso
  pitch (`+ glide*0.28`) — a recognisable glide silhouette, eased in/out
  so it never pops.
- **Landing shockwave:** the existing `triggerGroundImpact` at touchdown
  now scales with the launch: `LANDING_SHOCKWAVE_BASE (2.6) +
  jumpIntensity * LANDING_SHOCKWAVE_SCALE (2.4)` — a full drop-launch
  lands noticeably harder. `WorldPath` and `WorldParticles` already
  consume `groundImpactState`, so the harder shockwave propagates for
  free.

Events between `JUMP_INTENSITY_BAR` and `0.82` still get the plain
launch + land exactly as before — the glide is reserved for the biggest
moments so it stays special.

### 11.5 Verification

**Two passes.** The first (commit `46c373c`, 2026-08-28) got `tsc`/`build`
clean, a 9-world mount/unmount sweep, and a full synthetic-track
playthrough (all zero-error) but **could not verify anything visual** —
the browser preview pane never composited frames. The second pass
(2026-08-29, this commit) confirmed the preview is *still* non-compositing
(`requestAnimationFrame` fired **0 times in 3 s** on the hidden tab — the
per-frame loop is fully paused, not just throttled), so instead did a
**headless numerical verification** of the geometry- and math-dependent
fixes by bundling the actual world/route/obstacle code with `esbuild` and
running it under Node, plus a before/after diff against the pre-Stage-7
commit `1e38320`.

**Static / error checks (both passes):**
- `npx tsc -b` clean, `npm run build` clean (738 modules).
- All 9 worlds cycled via the switcher (11–12 switches) — every world's
  mount + unmount/dispose path exercised with the new `cameraObstacles`
  collection (`collectObstacles`/`obstaclesFromMatrices`), the FI
  `generateFloatingIslandsWorld` change, the rebalanced emissive loop, and
  the new `CameraRig`/`Character` refs. **Zero console/window errors.**
- Synthetic track load → play → restart → mid-track seek → world-switch
  while loaded: **zero errors** (`resetToken → WorldDirector.reset()` and
  the `trackGeneration` remount paths run clean). Playback does not
  *advance* on a hidden tab, so a full sequence still can't be watched.

**Headless numerical verification (second pass):**
- **Fix 2 (camera clearance) — PASS.** Ported the exact `CameraRig`
  clearance block + `obstaclesFromMatrices` and drove it with each world's
  real obstacle list: (a) obstacle spheres generate with sane radii per
  world (2–20, cap respected; Abstract Void correctly empty); (b) a camera
  point inside an obstacle is pushed to exactly `radius + CAMERA_CLEARANCE`;
  (c) the eased correction moves ≤~1.25 u/frame at its steepest and its
  tail settles **monotonically** to <1e-7 u/frame — smooth, no snap, no
  jitter; (d) two overlapping r=20 spheres accumulate a push well under
  the 16-u clamp; (e) with no obstacle a large residual offset decays to
  0.0000 within 2 s (no stuck correction when a shot ends); (f) the
  ground-floor term lifts a sub-surface shot to `routeY + 2.5`.
- **Fix 3 (character/prop) — before/after vs `1e38320`.** Measured, per
  world, every ground-level prop group's minimum near-face gap to the
  character's centreline path (dense route sampling, char-height overlap
  filter). Stage 7's `flank()` clearance changes **improved** every group
  they targeted — Underwater Abyss columns 5.6→7.2, coral 4.2→5.5,
  Desert cacti 7.6→8.1 — and left the rest ≥8 u clear. **Zero new
  intrusions.** This pass **found and fixed one regression the first pass
  introduced**: Fantasy Forest `crystals` had been given `ownRadius`+bumped
  `extra` in `46c373c`, which pushed one hairpin-inside crystal from a
  −0.19 u graze to −0.66 u (worse, because pushing an inside-of-bend prop
  *outward* moves it toward the arc that curves back). Reverted that one
  line to the pre-Stage-7 form (bit-identical to Stages 5/6); all other
  Fix-3 changes kept.
- **Fix 4 (glide) — PASS.** Ported the jump state machine and stepped it:
  a weak major event (0.78) → plain `anticipation→air→land`, no glide,
  1 landing; a drop-caused event (0.90) → `…→air→glide(exactly 0.60 s at
  the apex)→air→land`, 1 landing (no double-fire, `hasGlided` guard
  holds); the boundary (0.82) correctly does **not** glide (strict `>`);
  landing-shockwave strength = `2.6 + intensity·2.4` (≈4.4–5.0, up from a
  flat 2.6 pre-Stage-7) and scales with intensity as intended.
- **Fix 1 (brightness) — formula-checked only.** The clamps are pure
  arithmetic on `getMajorEventEnvelope()`: at a full drop bloom lands at
  ~2.98 (clamp 3.1) ≈ 2× the loud-no-event level (was ~14× the base
  pre-Stage-7); vignette floor 0.45; emissive event term ≤1.1 and total
  ≤1.7; rim event boost 1.5× (was 2.1×); sky white-mix ≤0.16. The
  *arithmetic* does what §11.1 claims. Whether the result still **looks**
  dramatic / not washed out / keeps cel value separation and saturation
  is an aesthetic judgement that genuinely needs eyes — see below.

**Stage 6 preservation — confirmed by inspection.** `cameraShots.ts` and
`cinematicDirector.ts` are **not in the Stage 7 commit's file list** —
byte-for-byte untouched. The per-phase `pivotWeight`/`lookWeight` table
(character-anchored 0.15–0.35 everywhere, `reveal` the landmark-heavy
outlier at 0.7) is intact. Stage 7's `CameraRig` clearance block runs
*after* the shot's position/look-at composition and only nudges position
out of obstacle spheres (typically 0.5–3 u vs 20–48 u shot distances), so
it cannot meaningfully re-frame away from the character.

**Still NOT verified — needs a working preview / screenshots:** the
actual on-screen *appearance* of all four fixes. Specifically: (1) major
drops still read as powerful, not flat, and not blinding; (2)
character / environment / landmark readability and cel two-band
separation during a drop; (3) colours still saturated; (4) the cinematic
camera visibly clears trees/buildings/pyramids/wheels in a real shot and
the correction looks natural, not like an invisible wall; (5) no *visible*
character-through-solid clipping in motion across multiple worlds; (6) the
glide reads as a glide; (7) FPS during gameplay / an active world event /
an active cinematic sequence (could not be sampled — rAF paused).

### 11.6 Known limitations / follow-ups

- **Visual appearance of Stage 7 is unverified** (see 11.5). Every check
  that a hidden, non-compositing tab permits has passed; nothing has been
  *seen*.
- **Pre-existing hairpin-graze props (NOT a Stage 7 regression).** `flank()`
  offsets sideways from the route at parameter `t`; on the inside of a
  tight bend that point can graze a slightly-later arc of the same closed
  loop. ~6 instances total across the nine worlds sit ≤~2 u inside the
  centreline this way — Fantasy Forest 1 mushroom stem (−0.2) + 1 tree
  trunk (−0.25) + 1 crystal (−0.19); Abstract Void 1 each of cyan
  (−1.85) / magenta (−1.73) / gold (−0.74) small floating solids; PS2
  Night 1 house at +0.29 (just outside). All present since the nine-world
  build, unchanged by Stage 7 (confirmed by the before/after diff). A
  correct fix needs a closest-point-on-curve placement solver in `flank`;
  a quick "scan a t-window and push out" guard was prototyped this pass
  and **rejected** — it destabilised well-clear props in 5 worlds because
  a single-axis outward push can move a prop *toward* the offending arc.
  Documented in `definitions.ts`'s `flank` doc comment; worth a dedicated
  pass, out of scope here.
- **Camera obstacle spheres are coarse.** A single bounding sphere
  under-covers tall thin props (a tower is a sphere at its mid-height, not
  a capsule) and over-covers wide ones (capped at radius 20). Tuned to
  catch the jarring "shot flies through the building" case, not to be
  geometrically exact. A vertical-capsule model is the natural upgrade if
  a specific clip is ever reported.
- **`scatterReform` still has no route awareness.** The corridor-clearance
  constraint on `SCATTER_REFORM` bindings lives in the binding author's
  index selection (documented in `worldEvents.ts`), not enforced in code.
  Fine for the one binding that uses it; revisit if more are added.
- **Per-world brightness tuning outstanding.** The clamp values (emissive
  1.1/1.7, bloom 3.1, etc.) are a first calibration; some worlds lean
  harder on emissive than others and may want per-world tuning once seen.

---

## 12. Stage 8 — camera pass 1: "follow the protagonist" (2026-08-29)

**Not the full Stage 8.** A Stage 8 plan (6 steps: brightness normalization,
character-first camera, camera collision, per-world geometry cleanup,
continuous music‑reactivity, character presence/progression) was drafted
and is **not yet approved**. This commit is one targeted fix the user
asked for directly after watching the current build: the cinematic camera
was on the environment far too much, and its shots "panned into nothing —
into the centre, where nothing is."

### Root cause (found in code + confirmed visually this session)

`cinematicDirector.ts` had four trigger tiers: major event > drop >
**landmark proximity** > **district transition**. The bottom two fire on
POSITION alone — every time the character runs past a landmark
(`key !== lastLandmarkKey`, within 55u) or crosses a district boundary —
with only a 4.5s floor between cuts. The route passes a landmark / changes
district every few seconds, so a cut was firing almost constantly, and
both tiers preferred the `'landmark'` shot (which looks at the landmark,
not the character). Observed directly at idle with no music: the camera
cut to a pagoda / a house / an asteroid field on Floating Islands / PS2 /
Outer Dimension within seconds of loading.

The "pan into nothing": `cameraShots.ts` (the ~13s major-event sequence
camera) locked its framing target to the nearest landmark within **90u**,
or — if none — to **a point 40 units ahead down the route** (empty
track). `reveal` then pointed the camera 70% toward that empty point.

### What changed (2 files, no protected system touched)

**`cinematicDirector.ts`:**
- Removed the landmark-proximity and district-transition tiers entirely,
  plus the standalone `dropId` tier. A plain drop that never escalates to
  a major event no longer cuts — it still drives every gameplay-camera
  impulse (FOV punch, forward burst, speed), which is enough.
- **Cuts now fire on ONE thing: a major event** (`impactEventId` — the
  rare ~13s coordinated sequence, itself ≥13s apart). `MIN_GAP` 4.5 → 6
  (a stacking guard; never binds now).
- The cut is always a **character** shot (`dramaticClose` / `frontFacing`
  / `lowAngle` / `sideTracking`). A landmark within 45u only nudges which
  character shot (so it sits as a backdrop) — never a landmark-only shot.
- Removed `consumeDrop`, `DISTRICT_SHOT`, `lastDistrict`, `lastLandmarkKey`,
  `dropConsumer` and their resets. `stepCinematicDirector`'s signature is
  unchanged (`frame`/`district` now unused) so `CameraRig` is untouched.

**`cameraShots.ts`:**
- No-landmark case: the locked target is now the **character**, not a
  blank point down the route. A new `sequenceHasLandmark` flag gates every
  phase's pivot/look weights to ≤0.08 when there's nothing to frame — the
  whole sequence stays a dynamic move framed on the character.
- `MAX_TARGET_DIST` 90 → 60 (only lock onto a landmark that's genuinely
  close/visible when the drop lands).
- Shot distances pulled in ~25-30% from Stage 4's originals (buildup push
  46→32, reveal push out 48→32, transform sweep excursion cut ~40%,
  aftermath orbit 30→20) so the character stays a clear subject through
  the move. `reveal` lookWeight 0.7 → 0.5. Stage 6's low pivot/look
  weights are otherwise intact.

### Verification

- `npx tsc -b` + `npm run build` clean.
- **Visual (preview composited frames this session):** at idle with no
  music, the camera holds a clean third-person chase on the character and
  **stays there** — confirmed 10s+ on Floating Islands, and on Cyberpunk
  Night and Outer Dimension after switching. Before this change every one
  of those cut to an environment landmark shot within seconds. First-person
  confirmed unaffected.
- **Could NOT watch a full major-event sequence** — the browser renders
  (rAF 60fps) but the audio transport clock stalls on a background OS
  window, so playback only advances in short bursts and the ~13s sequence
  never plays through. Single seeked-in frames showed the character
  reasonably framed, not panning into space.
- **Headless numerical check** of `getSequenceCameraShot` (esbuild-bundled,
  run under Node): with no landmark near, the look-target sits **0.0u from
  the character** in every phase (was ~28-40u toward empty track);
  camera position 12-29u from the character (a dynamic move, character
  always the subject). With a real landmark 34u away, the look-target
  biases toward it, peaking 17.5u during `reveal`, returning to ~3.5u by
  `aftermath` — bounded, not a swing into the sky.

### Camera pass 2 (2026-08-30) — "the camera belongs behind the character"

Pass 1 killed the landmark/district cuts but the user reported the camera
was **still** moving too much: the ~13s major-event *sequence* camera fired
on **every** major event (they can be ~13s apart in an energetic track),
and per-beat camera impulses added constant wobble. Pass 2:

**`cameraShots.ts` — the sequence camera is now brief and rate-limited:**
- Only `drop` + `transform` have a `SHOT_TABLE` entry (~3.5s). `buildup` /
  `tension` / `reveal` / `aftermath` return blend 0 → **plain chase
  camera**. The world still transforms and the lighting/FOV still spike;
  the camera just stays home for all but ~3.5s of the sequence.
- **`CINEMATIC_COOLDOWN = 30s`**: engages at most once per 30s regardless
  of how often major events fire. Edge-checked when the sequence leaves
  `idle`; if inside the cooldown the whole sequence is suppressed
  (`suppressedThisSequence`).
- Both remaining specs are small and close (`drop` push 13→8u, `transform`
  orbit r=11) — near the normal follow distance, not 30-46u back — and
  character-anchored. `elapsed` is now threaded through
  `WorldDirector.getSequenceCameraShot` → `CameraRig` passes
  `state.clock.elapsedTime`.

**`cinematicDirector.ts`:** `MIN_GAP` 6 → 30, matching the sequence-camera
cooldown so the 3s cut and the brief sequence move fire together on one
major event, then both go quiet for 30s.

**`CameraRig.tsx` — the chase cam is planted, not choreographed:**
- All beat-impulse multipliers roughly halved (`applyImpulse`: forward
  0.9→0.5, vertical 0.7→0.38, rotational 1.4/0.7→0.6/0.3, fov 9→5, lateral
  1.1→0.5). A strong beat makes the chase cam *breathe*, not lurch.
- `pickImpulseKind` reweighted so the framing-swinging kinds are rare:
  rotational 24%→7%, lateral 8%→3%; forward/vertical/fov take the rest.
- Drop's sideways vertical bump halved (0.6→0.3); the major-event
  look-target swing cut hard (`majorHit*1.6` → `*0.55`) since the cut
  already handles a major event's framing change.

**Verification.** `tsc -b` / `build` clean. Preview composited frames but
the audio transport stalls on a background OS window so a full continuous
playthrough (needed to *watch* the 30s cooldown between two drops) was not
possible — burst playback showed the chase cam recovering to behind the
character within ~3s of the cold-start major event, and holding chase
through normal running. **Headless check** of `getSequenceCameraShot`
confirms: engages only on `drop`+`transform` (every other phase = chase,
blend 0), camera stays ≤13u from the character (was 30-46u), and a second
sequence 20s after the first is **entirely suppressed** (blend 0 all
phases), re-engaging only once 30s has passed. Not verified by eye: the
calmer beat impulses in motion, and the 30s gap between two real drops.

### Camera pass 3 + brightness + clipping (2026-08-30)

Passes 1-2 still weren't enough — the user reported the cinematic cut
"looks at the side view when the character isn't even in the frame", the
maps are still too bright, and the character still clips solids. This pass:

**Camera — cinematic cuts and the sequence camera are BOTH switched OFF.**
- `cinematicDirector.ts`: `CINEMATIC_CUTS_ENABLED = false`. `stepCinematicDirector`
  still consumes the major-event id (no backlog on re-enable) but never
  calls `startShot`, so `cinematicState.shot` stays `'gameplay'` and
  `getCinematicBlend()` is always 0.
- `cameraShots.ts`: `SEQUENCE_CAMERA_ENABLED = false`. `getSequenceCameraShot`
  returns 0 unconditionally (idle-edge tracker kept current for a clean
  re-enable).
- The camera is now purely the third-person chase cam. The FOV punch,
  forward surge, `altitudeDive` and (pass-2-halved) beat impulses still
  react to the music — those keep the camera *behind the character*, they
  don't reposition it. All the cinematic machinery (shot table, blend
  envelope, cooldown, no-landmark gating) is intact and dormant for a
  future, deliberate re-enable.

**Brightness — the bright worlds toned down (visually confirmed):**
- `VisualizerCanvas`: bloom `luminanceThreshold` **0.22 → 0.34** (the big
  lever — at 0.22 the neon-grid floors bloomed edge to edge). Base
  intensity 0.5 → 0.4, event term and clamp both cut.
- `WorldPath` style-2 (neon grid — Cyberpunk / Outer / Void): the additive
  grid term reached `~uColorA * 3.8` at an intersection; now clamped to
  `uColorA * 0.7` so the lines read as bright lines on a dark deck, not a
  light source.
- `definitions.ts` emissive floors on the bright worlds cut: Void solids
  0.6 → 0.32 (+ rim 1.0 → 0.7), Void rings 0.8 → 0.42, Carnival bulbs
  1.0 → 0.5, PS2 lampHeads 0.9 → 0.5 / lit 0.7 → 0.5, Cyberpunk signs
  0.7 → 0.5 / windows 0.5 → 0.4, Outer shards 0.3 → 0.22 / rings
  0.45 → 0.3.
- **Confirmed by eye:** Cyberpunk / Outer Dimension / Abstract Void floors
  went from a blinding white slab to a readable teal/purple surface with
  visible grid lines; cel shading on the character is legible again. The
  dark worlds (Abyss / Forest / Carnival) were not touched this pass —
  brightening those is the opposite job (drafted Step 1).

**Clipping — `flank()` self-clearance guard (this time done right):**
- After computing the offset point, scan a narrow t-window (`k` ∈ ±13 ×
  0.0022 ≈ ±3% of the loop) and, for the closest neighbouring arc the
  point still intrudes on, push it **directly away from that arc's centre**
  (`normalize(p - arcPoint)` in XZ). The Stage-7 attempt that was rejected
  pushed along a fixed `right` axis — on a hairpin that can shove a prop
  *toward* the offending arc. Push capped (`extra*0.85 + 3`); window
  deliberately narrow so it can't "see" distant arcs and over-correct
  (verified: widening it to ±6% made one Void solid *worse*).
  `SELF_CLEAR_MARGIN` 2.5.
- Floating Islands `worldGenerator.ts`: near-islands pushed out
  (`corridorRadius + radius*0.95 + 5`, was `*0.75 + 2`) and dropped lower
  (`6 + rng()*8`, was `3 + rng()*7`); sakura clustered toward island
  centre (`0.12-0.6` of the radius, was `0.25-0.85`) so rim trees no
  longer reach the walkway.
- **Headless before/after vs `b7ee9c7`** (bundled the real builders, run
  under Node): every group the metric flagged as a real intrusion (near-
  face > 0.4u past the centreline) is fixed — Forest crystals −0.19→+3.5,
  stems −0.2→+2.4, trunks −0.25→+6.9; Void cyan −1.85→+5.2, magenta
  −1.7→+5.6; PS2 houses +0.3→+6.6; Floating Islands sakura canopy
  −2.85→+9.5. No regressions on any previously-clear group. One residual:
  Void `gold` (one small tetrahedron) still −0.74 — unchanged from
  `b7ee9c7`, not a regression, in the most abstract "solids in black
  space" world; the guard's narrow window can't reach the arc it grazes
  without over-correcting others. World build time ~7ms/world (measured).

### Still open (feeds the rest of Stage 8)

- Dark worlds (Abyss / Forest / Carnival) and the still-dark character in
  a few worlds — brightening those, plus the inert `<ambientLight>`
  situation, is drafted Step 1.
- Floating Islands walkway railings cut diagonally across the deck on
  curves (`Walkway.tsx` chord-vs-arc) — geometry cleanup, Step 4.
- Not verified by eye (audio transport stalls on a background OS window):
  the calmer beat impulses in motion. The cinematic systems being fully
  off is verified (headless: `getSequenceCameraShot` returns 0 every
  phase; the cut flag is a plain `if (!flag) return`).
