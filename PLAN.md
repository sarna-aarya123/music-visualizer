# PLAN — Next Phase: Spectacle, Events & the World Director

> **Status: PROPOSED, NOT APPROVED. No implementation has started.**
> The user asked for this investigation while away and wanted to review it
> before any coding begins. Do not start building without their go-ahead.
>
> **Read `HANDOFF.md` first** for current architecture, conventions,
> protected systems and known pitfalls.
>
> **Two questions still open for the user:** (1) which stages to start
> with, and (2) whether Stage A (offline audio pre-analysis) is in scope.

Read-only investigation. No code written. Prepared for review.

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

**Stage 0 — Perf spike (read-only + throwaway).** Measure the cost of
rewriting instance matrices per frame at realistic counts in the heaviest
world. Establishes the animated-instance budget before anything is designed
around it.

**Stage 1 — Dynamic prop animation.** `OutlinedInstances` supports dynamic
matrices; `PropGroup` gains an optional animation channel. Static groups
keep the existing write-once path. *No new visual features yet.*

**Stage 2 — Director core + parity refactor.** Introduce `WorldDirector`
and the `Sequence` model; port the existing major-event trigger and
cinematic selection onto it. **Behaviour must be visually identical to
today** — this is a pure refactor, verified as such.

**Stage 3 — Long-form drop sequence.** Replace the 2.57s lifecycle with a
10–15s multi-phase sequence using *only existing effects*. Proves the
structure feels bigger before any new content exists.

**Stage 4 — Moving cinematic shots.** Camera paths over time; director
drives the camera channel.

**Stage 5 — Event archetype library + per-world bindings.** The nine
worlds' signature events.

**Stage 6 — Background/distant event layer.**

**Stage 7 — Character abilities** (launch / glide / landing shockwave),
triggered by the director.

**Stage 8 — Variety, history, weighted selection, replayability.**

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
- **2 (parity):** side-by-side capture at identical track offsets pre/post
  refactor; events fire at the same times with the same intensities. Any
  visual difference is a bug.
- **3 (drop sequence):** a drop must read as a *sustained* multi-second
  event, not a flash. Verify the mute test — the drop's shape should be
  legible with sound off.
- **4 (camera):** no shot clips through geometry; the character is framed
  or deliberately absent in every shot; a hard fallback to the gameplay
  camera always exists; **re-confirm hi-hats/snares never move the camera**
  (grep + runtime).
- **5 (world events):** each world's signature events fire at appropriate
  moments; nothing intersects the walkway; every event returns cleanly to
  rest state.
- **6 (background):** distant events never obscure the path or the
  character; frequency stays rare.
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
