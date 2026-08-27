# HANDOFF — music-visualizer

Everything a fresh session needs to work on this project. Read this first,
then `PLAN.md` for what comes next.

---

## 1. What this is

A browser music visualizer: you upload a track, and a stylised 3D world is
generated that a character runs through while the world reacts to the
music. Nine hand-designed worlds, all sharing one animated/cel-shaded art
direction, matching a reference concept-art sheet (`public/reference.png`).

**Stack:** React + TypeScript + Vite · three.js via
`@react-three/fiber` + `@react-three/drei` · `@react-three/postprocessing`
· `zustand` · Web Audio API.

**Status:** feature-complete and visually signed off by the user. The next
phase — **Phase 6: Spectacle, Events & the World Director** — is under way;
see `PLAN.md`. Stages 0-3 are done (dynamic instance-matrix plumbing, a
`WorldDirector` facade, and a real 10-15s multi-phase major-event sequence
replacing the old ~2.57s flash). Stage 4 onward (moving cinematic shots,
world-event archetypes, anything visual/new-geometry) has **not** started
and needs approval before work resumes.

---

## 2. Run and verify

```bash
npm run dev      # vite dev server on :5173
npm run build    # tsc -b && vite build  — MUST pass before any commit
npx tsc -b       # typecheck only
```

**The verification routine used throughout this project** (do all of it
before claiming anything works):

1. `npx tsc -b` and `npm run build` clean.
2. Load the app; cycle **all nine worlds** via the 🌍 button; confirm zero
   console errors. Worlds mount *and unmount*, so switching exercises
   disposal paths.
3. Play a track through a full arc (quiet → build → drop → drums-cut →
   breakdown → return) and confirm zero errors.
4. If the change is visual, **get a screenshot from the user**. The
   in-tool browser preview has been unreliable — do not claim a visual
   result you have not actually seen.

**Console-log caveat:** the browser tool's console buffer is cumulative and
retains stale entries (including old HMR errors with old `?t=` timestamps).
If you see errors that look stale, **open a fresh tab** to get a clean read
before believing them.

**Testing with audio:** generate a synthetic WAV with known structure and
drop it in via a simulated `DragEvent` on `.upload-panel`. Always check
`document.querySelector('.filename')` first — the shared browser tab is
sometimes the user's own live session, and you must not disturb it. Clean
up any test file from `public/` afterwards.

---

## 3. Architecture — how data flows

```
AudioEngine (Web Audio)
   └─> FeatureExtractor  ──> featureFrame (mutable singleton)
                                  │
        FeatureUpdater (useFrame) ┘   also owns the resetToken effect
                                  │
   ┌──────────────────────────────┼───────────────────────────────┐
   │                              │                               │
rhythmState              WorldDirector (facade)          musicController
(drumPresence,          step()/reset() -> wraps           (travel speed,
 energyTrend)            musicEventDirector (a rare        section
                         ~13s major-event SEQUENCE:         multipliers;
                         buildup->tension->drop->           reads
                         transform->reveal->aftermath)      WorldDirector
                         sequence/phaseDurations getters     .sequence for
                                  │                          its own dip)
   │                              │                               │
   └──────────────┬───────────────┴───────────────┬───────────────┘
                  │                               │
             CameraRig  ──> cinematicDirector   Character
                  │         (shot selection)        │
       characterMotionState / cameraMotionState ────┘
                  │
        World render components (per world)
```

`WorldDirector` (Phase 6 Stages 2-3) is the sole entry point for
*advancing*/*resetting* the major-event sequence, and the sole place
`CameraRig`/`musicController` read its raw phase/timing from. Everything
else that only needs the smoothed 0..1 envelope
(`getMajorEventEnvelope()`) still imports it directly from
`musicEventDirector.ts` — deliberately not rerouted; see that file's and
`worldDirector.ts`'s doc comments.

**The golden rule:** per-frame data never goes through React state. It
lives in mutable module-level singletons that components read inside
`useFrame`. React state is reserved for rare user-driven changes (view
mode, active environment, transport).

---

## 4. File map

### Audio (`src/audio/`) — treat as stable, don't rewrite
| File | Role |
|---|---|
| `AudioEngine.ts` | Playback. Source nodes are one-shot, so play/seek both create a fresh node via a shared `startSourceAt`. |
| `FeatureExtractor.ts` | AnalyserNode → `AudioFeatureFrame`. All onset/drop/breakdown detection. Has `reset()`. |
| `types.ts` | The `AudioFeatureFrame` contract — the only thing scenes may read. |
| `featureFrame.ts` | The shared mutable frame instance. |
| `beatConsumer.ts` | **Exactly-once event consumption.** Each consumer keeps its own `BeatConsumerState`; comparing `lastId` against the frame's id guarantees no event is missed or double-counted. |

### Core (`src/core/`)
| File | Role |
|---|---|
| `VisualizerCanvas.tsx` | The R3F `<Canvas>`, post-processing (bloom/vignette/chromatic/noise), and mounts the active environment keyed by id. |
| `FeatureUpdater.tsx` | Steps the extractor each frame (gated on `isPlaying()`), and owns the `resetToken` effect that resets every stateful director. |

### State (`src/state/`)
`audioStore.ts` (status, time, volume, `resetToken`, `trackGeneration`),
`viewModeStore.ts` (first/third person), `environmentStore.ts` (active
world id).

- `resetToken` bumps on **new track *and* seek** → resets audio-derived state.
- `trackGeneration` bumps on **new track only** → remounts camera/character
  so a new song starts a fresh lap. A seek deliberately does *not* reset
  route position.

### ⚠️ `src/scenes/cyberpunkCity/` — **this is the shared engine, not a world**
The folder name is a leftover misnomer. It contains no world any more:

| File | Role |
|---|---|
| `CameraRig.tsx` | Owns route progress `t`, the speed model, publishes `characterMotionState`, frames third/first person, applies cinematic shots. |
| `Character.tsx` | The runner: pose state machine, layered secondary motion, jump, per-world appearance, cel shading + outline. |
| `MusicEventDirector.tsx` / `RhythmState.tsx` | Thin non-rendering `useFrame` mounts that step their singletons. |
| `world/routeGenerator.ts` | Closed-loop Catmull-Rom route + per-region corridor radius. Generic over region name. |
| `world/musicController.ts` | Speed model + `speedPerceptionFrac` (shared "how fast does this feel"). |
| `world/worldDirector.ts` | The `WorldDirector` facade — `step()`/`reset()` advance/clear the major-event sequence; `sequence`/`phaseDurations` getters expose its raw phase/timing to the two consumers that need it. |
| `world/musicEventDirector.ts` | Rare major events: a real 6-phase (buildup/tension/drop/transform/reveal/aftermath), ≈13s sequence — intensity, origin, exactly-once `impactEventId`, continuous envelope. Driven only via `worldDirector.ts`. |
| `world/rhythmState.ts` | `drumPresence`, `energyTrend`. |
| `world/cinematicDirector.ts` | Shot types, selection priority, blend envelope, shot transforms. |
| `world/{camera,character}MotionState.ts`, `groundImpactState.ts` | Cross-system singletons. |
| `world/seededRandom.ts` | mulberry32 — deterministic world generation. |

**Renaming this to `src/scenes/core/` is recommended in `PLAN.md`** before
the next phase grows it further.

### Shared world kit (`src/scenes/shared/`)
| File | Role |
|---|---|
| `toon.ts` | `ToonSurfaceMaterial`, `ToonOutlineMaterial`, `makeToon`, `makeOutline`. The art direction lives here. |
| `OutlinedInstances.tsx` | An instanced prop family + its ink-line shell. **Uploads matrices once — see PLAN.md §2(a).** |
| `ProceduralSky.tsx` | Configurable sky: 3-stop gradient, celestial body, band modes (0 none / 1 clouds / 2 god rays / 3 stars+galaxy / 4 caustics). |
| `environment.ts` | `WorldBase` (just `landmarkPositions`), `EnvironmentDefinition`, shared route-scale constants. |
| `characterAppearance.ts` | Per-world outfit/hair/headgear/cape data. |

### Worlds
- `registry.tsx` — the environment registry (id → name → SceneComponent).
- `defaultEnvironment.ts` — the default id. **Dependency-free on purpose**,
  to break a `Character → environmentStore → registry → Character` cycle.
- `floatingIslands/` — the one bespoke world (built and approved first).
- `worlds/` — the data-driven system: `types.ts` (contracts),
  `definitions.ts` (all eight worlds as data), `geometry.ts` (shared
  primitives), `WorldScene.tsx` (renders any definition), `WorldPath.tsx`,
  `WorldParticles.tsx`.

---

## 5. The nine worlds

Floating Islands (bespoke) · Cyberpunk Night · Desert Dream · Underwater
Abyss · Outer Dimension · PS2 Night · Fantasy Forest · Abstract Void ·
Chaotic Carnival.

**Adding a world = adding data, not code.** Write a `build()` that returns
prop groups + landmark positions, add a `WorldDefinition` to
`definitions.ts`, and it appears automatically. Nothing in the render path
changes.

A `WorldDefinition` is: `sky`, `fog`, `ambient`, `path` (half-width,
colours, style 0 planks / 1 smooth / 2 neon grid, optional railings),
`particles` (0 falling / 1 rising / 2 drifting), `outline`, and `build()`.

A `PropGroup` is `{ key, geometry, toon, matrices, reactive? }` where
`reactive: { mood, drums, event }` drives emissive from the music.

**Clearance rule:** props must be placed at
`corridorRadius + ownRadius + margin`. The `flank()` helper takes
`ownRadius` for exactly this — omitting it caused large scenery to cut
through the walkway.

---

## 6. Core patterns (follow these)

- **Exactly-once events:** always consume `beatId`/`dropId`/`impactEventId`
  etc. through `beatConsumer`, with a dedicated state per consumer.
- **Impulse language:** instant floor-raise then exponential decay —
  `x = Math.max(x, hit)` then `x *= Math.exp(-rate*dt)`.
- **Frame-rate-independent easing:** `x += (target - x) * (1 - Math.exp(-rate*dt))`.
  Never a raw lerp factor.
- **Integrate time-varying rates.** If a rate can change, accumulate
  `clock += dt * rate`. **Never `elapsed * rate`** — that recomputes the
  whole angle from t=0 each frame and jumps whenever the rate changes.
  This exact bug appeared three separate times.
- **`dt` is always clamped:** `Math.min(rawDelta, 0.05)`.
- **Musical hierarchy:** sectionMood (slow baseline) → drumPresence →
  energyTrend → beats (accents) → major events (rare, coordinated).
  Fast reactions layer *on top of* slow baselines, never replace them.

---

## 7. Art direction (hard-won — don't undo these)

The animated/video-game look comes from these specific choices. Earlier
attempts failed because they used smooth realistic shading.

1. **Hard light bands, wide value gap.** Two bands with a narrow half-tone
   at the terminator. Continuous falloff reads as "3D render"; a hard
   terminator reads as *drawn*. Bands that are too close in value (the
   first attempt used 1.18/0.94/0.82) look flat.
2. **Shadows are hue-shifted, not darkened.** Shadow side mixes ~62%
   toward a contrasting tint at ~55% brightness. Multiplying toward black
   is what produced "muddy".
3. **Saturated, high-key base colours.** Cel shading darkens the shadow
   side itself, so "correct" mid-tone bases end up muddy.
4. **Restrained rim light**, only in a narrow band at the silhouette edge.
   At full strength it blows everything out to white.
5. **Ink outlines on everything** (inverted hull, back-faces only, divided
   by instance scale so line weight is consistent). This is the single most
   recognisable trait — geometry without it reads as generic 3D even when
   correctly cel-shaded.
6. **Fog starts far away** so near geometry stays crisp and saturated.

---

## 8. Protected — do not change without explicit instruction

- **Hi-hats and snares must never move the camera.** They may drive world
  reactions only. `CameraRig` consumes bass/beat/drop/major-event only.
- Route generation, corridor-clearance math, world-scale constants.
- The audio-context clock as sole time source.
- `FeatureExtractor` detection logic and beat thresholds.
- `beatConsumer`'s exactly-once behaviour.
- `musicEventDirector`'s TRIGGER conditions and gating (the three trigger
  sources, thresholds, `MIN_EVENT_GAP`) — unchanged since before Phase 6.
  The sequence's phase *durations*/*count* were deliberately grown in
  Phase 6 Stage 3 (see `PLAN.md`) and may be tuned further with
  instruction, but the WHEN-does-a-sequence-start logic is protected.
- First/third-person camera architecture.
- Phase 5's speed tuning (`MIN_SPEED 10`, `MAX_SPEED 34`,
  `MAX_SPEED_CAP 95`) — calibrated against the measured route length
  (~2189 units) so a lap completes within a typical song.

---

## 9. Bugs that have actually happened (avoid repeating)

1. **Undisposed resources.** `useMemo(() => new XMaterial())` is *not*
   tracked by R3F's auto-dispose (only JSX-declared materials are). Every
   imperatively created material/geometry needs a cleanup `useEffect`.
   Missing this leaked GPU memory on every world switch and degraded
   whichever world you were looking at.
2. **Circular imports.** `Character → environmentStore → registry →
   Character` crashed with a temporal-dead-zone error. Fixed by isolating
   the default-environment constant in a dependency-free module.
3. **`elapsed * rate` discontinuities** (see §6).
4. **Missing `resetToken` hooks.** Every new stateful system must reset on
   seek/new-track or state corrupts. Bitten twice.
5. **Prop clearance** (see §5).
6. **Vite dev server returns HTTP 200 with an HTML body for missing
   files.** A "does this URL load?" probe reports success for files that
   don't exist — check the MIME type instead.
7. **ImageBitmap textures render vertically flipped** in three.js. Load
   through `TextureLoader` from an object URL instead.

---

## 10. Git state

- Branch `main`, synced with `github.com/sarna-aarya123/music-visualizer`.
- Recent history (newest first): Phase 6 Stage 3 (long-form sequences),
  Stage 2 (parity director refactor), Stage 1 (instance-matrix plumbing),
  the `HANDOFF.md`/`PLAN.md` rewrite, the next-phase plan, the nine
  cel-shaded worlds (the big rebuild). Run `git log --oneline` for exact
  hashes rather than hand-tracking them here.
- Check `git status` for whether the working tree is clean and whether
  local commits are ahead of `origin/main` — pushes are not automatic.

`public/reference.png` is the concept sheet all nine worlds were designed
against. No code reads it any more (the art-backdrop approach was replaced
by real 3D worlds), but it's kept as the visual source of truth.

---

## 11. What's next

See **`PLAN.md`** for the full stage-by-stage plan and history. Current
state (2026-08-27): Stages 0-3 done and committed —

- **Stage 0:** investigation (perf/architecture for animatable instances).
- **Stage 1:** `OutlinedInstances`/`PropGroup` gained opt-in per-frame
  instance animation (`animated?: AnimatedInstances`) — plumbing only, no
  world uses it yet.
- **Stage 2:** the `WorldDirector` facade (`step()`/`reset()`), wrapping
  `musicEventDirector.ts` by pure delegation — a parity-only refactor.
- **Stage 3:** the major-event lifecycle became a real ≈13s multi-phase
  sequence (buildup → tension → drop → transform → reveal → aftermath),
  built entirely from existing effects (camera FOV/altitude, existing
  landmark cinematic shots, world prop emissive/rim, post-processing) —
  see `PLAN.md` §7 for exact timing and what changed.

**Stage 4 (moving cinematic shots) has NOT been approved or started.**
Neither has anything beyond it (event archetypes, background/distant
events, character abilities, Stage A pre-analysis). **Do not start coding
further stages without explicit go-ahead.**
