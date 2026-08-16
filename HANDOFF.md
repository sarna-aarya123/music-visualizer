# HANDOFF — Music-Reactive Visualizer

> This is a continuity document for another Claude session picking up this
> project cold. It is not a summary for the human user — it is written so
> a new session can be productive immediately without re-deriving context
> from git history or asking the user to re-explain the vision.
>
> Written 2026-08-16, at commit `6ade2b5` on `main`, working tree clean.

---

## 1. PROJECT OVERVIEW

This is **not** a traditional music visualizer (waveforms, circular spectrum
bars, particles-that-pulse-to-bass). It is an attempt to build a **procedurally
generated, stylized, anime/video-game-style 3D world that a black stick-figure
character runs through, where the music acts as the director** — controlling
speed, camera cuts, environmental spectacle, and pacing.

**The core creative analogy, repeated throughout the project's history:**

> Imagine a Mario Kart level, except the track, speed, camera behavior,
> environment, lighting, and world events are all controlled by the music.
> The camera is the viewer/cinematographer. The character is the player.
> The world is the level. The music is the controller.

The intended end-user experience: upload a song → a seeded, deterministic
game world is generated → a stylized black silhouette character runs a
closed-loop route through it, third-person, with the camera occasionally
cutting to cinematic shots → speed, lighting, particles, and rare "major
event" spectacle are all driven by real-time audio analysis of the track.

**Why this matters for anyone continuing the work**: the single most
repeated piece of user feedback across this project's history is *"this
still looks like a procedural 3D city with visualizer effects, not a video
game."* Visual art direction and spectacle are the persistent weak point —
not the underlying systems, which are mature and (per the user) "good
enough." See §10 and §14.

---

## 2. CURRENT TECH STACK

Verified directly from `package.json` — do not trust memory, this list is
exact as of this commit:

```json
"dependencies": {
  "@react-three/drei": "^9.114.3",
  "@react-three/fiber": "^8.17.10",
  "@react-three/postprocessing": "^2.16.3",
  "postprocessing": "^6.36.4",
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "three": "^0.169.0",
  "zustand": "^4.5.5"
},
"devDependencies": {
  "@types/react": "^18.3.12",
  "@types/react-dom": "^18.3.1",
  "@types/three": "^0.169.0",
  "@vitejs/plugin-react": "^4.3.3",
  "typescript": "^5.6.3",
  "vite": "^5.4.10"
}
```

- Build tool: **Vite** (`npm run dev`, `npm run build` = `tsc -b && vite build`, `npm run preview`)
- No routing library, no CSS framework — a single `App.css` for the minimal UI overlay
- Audio: **native Web Audio API** (`AudioContext`, `AnalyserNode`) — no audio library
- No testing framework is installed
- `.claude/launch.json` exists — configures the `music-visualizer-dev` preview target (`npm run dev`, port 5173) for the Claude Code browser-preview tooling

---

## 3. CURRENT FILE / ARCHITECTURE MAP

```
src/
  main.tsx, App.tsx, App.css        — React entry + minimal UI shell
  audio/
    types.ts                        — AudioFeatureFrame contract (the audio↔visual boundary)
    featureFrame.ts                 — the singleton mutable AudioFeatureFrame instance
    AudioEngine.ts                  — Web Audio lifecycle: decode/play/pause/seek
    FeatureExtractor.ts             — the DSP: FFT → bands → flux → adaptive onset detectors
    beatConsumer.ts                 — exactly-once event consumption helper
  state/
    audioStore.ts                   — zustand: playback status/time (UI-facing, low-frequency)
    viewModeStore.ts                — zustand: 'third' | 'first' person toggle (rare, user-driven)
  core/
    VisualizerCanvas.tsx            — <Canvas> root + PostFX (bloom/vignette/chromatic aberration)
    FeatureUpdater.tsx              — runs FeatureExtractor inside the R3F frame loop
  ui/
    UploadPanel.tsx, TransportControls.tsx — plain HTML overlay, minimal
  scenes/
    types.ts                        — SceneProps = { featureFrame, route, world }
    cyberpunkCity/                  — the (only) scene. Name is a historical leftover from
                                       the very first iteration; the world is no longer
                                       purely "cyberpunk" (districts vary — see §7).
      layout.ts                     — FOG_COLOR, WORLD_SEED (=1337, fixed for now)
      CyberpunkCityScene.tsx        — top-level scene composition, generates route+world once
      CameraRig.tsx                 — OWNS route progress `t`, speed, camera framing (§5)
      Character.tsx                 — the black silhouette humanoid + its animation (§6)
      MusicEventDirector.tsx         — thin wrapper that steps the major-event state machine
      Buildings.tsx                  — building rendering + facade shader (§8)
      Landmarks.tsx                  — reactor rings + giant spires (rare, large, distinct)
      Ground.tsx                     — road ribbon + terrain skirts + impact ripple shader
      CityAtmosphere.tsx             — sky dome, moon, fog, ambient/directional lights
      BackgroundSkyline.tsx          — distant haze-blended silhouette ring (sells scale)
      StreetProps.tsx                — streetlamps along the route edge
      Particles.tsx                  — ambient motes + camera-relative foreground dust
      world/                         — pure logic, no JSX; the "engine" layer
        seededRandom.ts              — mulberry32 PRNG (deterministic world generation)
        routeGenerator.ts            — the closed-loop route + districts (§7)
        worldGenerator.ts            — walks the route, places every building/landmark (§7)
        musicController.ts           — the character/camera SPEED model (§5)
        musicEventDirector.ts        — the rare "major event" lifecycle state machine (§4/§9)
        cinematicDirector.ts         — the cinematic camera-cut trigger/shot system (§5)
        cameraMotionState.ts         — singleton: published camera speed (for parallax elsewhere)
        characterMotionState.ts      — singleton: published character ground frame + speed
```

**Key architectural pattern used throughout**: several **singleton mutable objects**
(`featureFrame`, `cameraMotionState`, `characterMotionState`, `majorEventState`,
`cinematicState`) are written by one "owning" component inside its `useFrame`
and read by many other components inside *their* `useFrame` callbacks. This is
deliberate — putting 60fps data into React state/props would force constant
re-renders. Only two pieces of state are ordinary React/zustand state:
`audioStore` (playback UI) and `viewModeStore` (the first/third-person toggle)
— both are low-frequency, user-facing, and fine to be reactive.

---

## 4. AUDIO ANALYSIS SYSTEM

All of this lives in `audio/FeatureExtractor.ts`, consumed via the
`AudioFeatureFrame` contract in `audio/types.ts`. It is intentionally
**decoupled from Three.js/rendering** — `FeatureExtractor` only touches an
`AnalyserNode` and writes into a plain data object.

### Pipeline (every frame, via `core/FeatureUpdater.tsx`)

1. `analyser.getByteFrequencyData()` → raw FFT bins, sliced into 4 bands by
   frequency range: `bass` (20–150Hz), `lowMid` (150–500Hz), `mid`
   (500–2000Hz), `high` (2000–9000Hz).
2. **Continuous band energies** (`frame.bass/lowMid/mid/high/energy`) —
   smoothed amplitude with fast attack (rate 20/s) and slower release (rate
   5/s), all via frame-rate-independent exponential smoothing
   (`1 - exp(-rate*dt)`), not fixed per-frame constants.
3. **Spectral flux** (`frame.bassFlux/midFlux/highFlux/spectralFlux`) — sum
   of *positive* frame-to-frame differences per band (i.e. "how much did
   this band's content just increase", ignoring decay tails). This is the
   foundation for onset detection — flux catches transient attacks that
   pure amplitude can miss, and is resistant to a track's overall loudness/
   mastering level.
4. **Adaptive onset detection** — one shared class, `FluxOnsetDetector`,
   instantiated 4 times (kick/snare/hihat/spectral-shift). Each tracks a
   rolling mean+variance of its own input signal and fires when the signal
   spikes `sensitivity` standard deviations above its own recent baseline.
   This is what makes detection track-relative instead of using a fixed
   threshold (a quiet acoustic track and a loud, heavily-compressed track
   both work).
5. **Discrete events**, each a `(idCounter, intensity)` pair on
   `AudioFeatureFrame` — `beatId`/`beatIntensity` is the increment-once-per-
   detection counter pattern (see `audio/beatConsumer.ts`) that guarantees a
   consumer never silently misses an event regardless of frame timing.

### The six detectors

| Signal | Input | Notes |
|---|---|---|
| `beatId`/`beatIntensity` | `bassFlux` | THE bass/808/kick detector. `beatInterval` (smoothed seconds-between-beats) is also updated here — a live tempo estimate. |
| `snareHitId`/`Intensity` | `midFlux*0.4 lowMid + 0.6 mid` combined with `highFlux` | A separate adaptive baseline from the kick — snares/claps read as their own event, not a weaker kick. |
| `hihatId`/`Intensity` | `highFlux` alone | Fast refractory (0.05s min interval) — meant to fire often, for fine detail only. |
| `spectralShiftId`/`Intensity` | Distance between current normalized band-energy proportions and a **slow** (rate 0.5/s) EMA baseline of those proportions | Detects the track's frequency *distribution* changing (a beat switch) independent of loudness. The distance signal itself is smoothed before being fed to the onset detector, which approximates "persisted for a few frames" without explicit frame-counting. Deliberately rare (2.5s min interval). |
| `dropId` | Fast (2.2/s) vs. slow (0.4/s) energy envelope trend, `trend > 0.16` while slow envelope was already `> 0.22` | One-shot, 4s cooldown. |
| `breakdownId` | Same envelopes, `trend < -0.16` while slow envelope was `> 0.28` (i.e. falling from a genuinely high-energy state) | One-shot, 4s cooldown. |

Plus a continuous **`impactScore`** (0..1): each of bassFlux/mid+highFlux/
highFlux normalized against its *own* detector's adaptive baseline
(`flux / (mean + 2·std)`), weighted 0.4/0.35/0.25 and combined — "how
musically significant is this instant," used to gate rare major events
without needing a dedicated detector for every possible cause.

### THE CRITICAL DESIGN RULE — which signals may touch which visual systems

This rule was arrived at only after several iterations of the user
explicitly rejecting hi-hat/snare-driven camera movement as "annoying" and
"side-to-side too much." **Do not relitigate this without a very good
reason — it took multiple passes to get right and the user is now happy
with it.**

- **Only `beatId`/`beatIntensity` (bass/808) and the events built on top of
  it (`dropId`, and the "major event" derived from `impactScore`/`dropId`/
  `spectralShiftId`) may physically move the camera.** See §5.
- **Hi-hats and snares are never consumed by `CameraRig.tsx` at all** —
  not gated, not dampened, literally never read there. They drive
  `Buildings.tsx`/`Particles.tsx`/`Ground.tsx`/`CityAtmosphere.tsx`
  instead (illumination pulses, particle bursts, sign flicker).
- There is a real, previously-fixed **indirect path** worth knowing about:
  `impactScore` blends in mid/high flux (~60% weight combined), so a pure
  hi-hat/snare flurry could historically cross the major-event trigger bar
  and *indirectly* move the camera through the major-event system. Fixed
  in `musicEventDirector.ts` by requiring `frame.energy > 0.4` alongside
  the `impactScore` spike before a major event can trigger from that path.
  **If you ever add a new consumer of `impactScore` or `majorEventState`,
  re-check this gate is still sufficient.**
- Regular (sub-`STRONG_BEAT_BAR`) beats get almost no camera reaction by
  design — see the tiered thresholds in §5.

---

## 5. CAMERA SYSTEM

Lives entirely in `scenes/cyberpunkCity/CameraRig.tsx`, with supporting pure
logic in `world/musicController.ts` (speed) and `world/cinematicDirector.ts`
(shot selection). **This is the most iterated-on system in the project —
read this section carefully before touching it.**

### What CameraRig owns

`CameraRig` is the single owner of:
- `t` — the character/camera's progress around the closed-loop route (0..1)
- the music-driven `SpeedState` (from `musicController.ts`)
- publishing `characterMotionState` (ground frame + speed) every frame, for
  `Character.tsx` to read
- the third-person/first-person blend and the cinematic-shot blend

### Speed model (`world/musicController.ts`)

Three layers, explicitly NOT "every audio fluctuation maps to velocity":

1. **Continuous `energy`** sets a *subtle* cruise-speed range
   (`MIN_SPEED = 4` to `MAX_SPEED = 15`) — most of a song is spent here.
2. **`sectionMultiplier`**, driven only by `dropId`/`breakdownId` (not raw
   energy, not individual beats): a drop snaps the multiplier to `2.3×` and
   holds for 4.5s before easing back to `1×`; a breakdown drops it to
   `0.4×` and holds 5s. This produces the "cruise → build → DROP → fast
   section → settle" curve rather than "fast → faster → faster."
3. **Additive bursts** — `applyBeatBurst` only for beats above
   `STRONG_BEAT_BAR` (0.72), `applyMajorLaunch` for major events.
4. A small, recently-added **anticipation dip**: during
   `majorEventState.phase === 'anticipation'`, target speed is multiplied
   by `0.7` — the world "holds its breath" right before a drop lands.

`MAX_SPEED_CAP = 60` is the hard ceiling `state.current` is clamped to.

### Camera reaction tiers (in `CameraRig.tsx`)

```
REACT_BAR = 0.55        // below this: literally zero camera reaction
STRONG_BEAT_BAR = 0.72   // "a real 808/kick" — speed burst + a real (but modest) punch
VERY_STRONG_BAR = 0.88   // combines TWO distinct impulse kinds
```

Five distinct **impulse kinds** (`forward`/`vertical`/`rotational`/`fov`/
`lateral`), chosen by weighted random pick (`pickImpulseKind`) — **lateral/
banking is deliberately rare (~8-12%)** so a reaction doesn't always look
like "tilt sideways," which was explicit prior user feedback. `rotational`
is implemented as a small clamped nudge to the *look-at target only*, never
`camera.up` — this is what makes it structurally impossible for a
rotational impulse to contribute to a flip.

Curvature-driven banking (from the route's own turns) is always present at
a low baseline, scaled up by `energy` and by the major-event envelope, but
kept subtle — this is legitimate "route choreography," not noise, and was
explicitly kept even while everything else was toned down.

### Third-person / first-person

- **Third-person (default)**: a *lagged* chase camera — `chaseLag` is a
  `Vector3` that `lerp`s toward an ideal position (behind + above the
  character) at rate 5/s, rather than rigidly attaching. Deliberately
  **stays level** — banking a chase cam with the road read as nauseating
  during testing, so curvature bank is scaled by `modeBlend` (0 in pure
  third-person).
- **First-person**: camera at the character's own head height
  (`HEAD_HEIGHT = 1.75`), looking straight down the route, inherits full
  banking and the rotational-glance impulse. This mode was explicitly
  deprioritized in later iterations ("don't spend this pass on it") — it
  still exists and works, toggled via the `V` key or a UI button
  (`state/viewModeStore.ts`), but has not been iterated on recently.
- The two blend via `modeBlend`, eased continuously (`MODE_BLEND_RATE =
  1.6/s`) — never a snap, even mid-toggle.

### Cinematic camera director (`world/cinematicDirector.ts`)

**This is the newest major system (added the iteration before this
handoff).** Philosophy: the default gameplay camera (third-person chase,
above) never changes; a separate director occasionally cross-fades to one
of seven short alternate shots, always for a *reason*, never a timer.

Shot types: `wideEstablishing`, `landmark`, `dramaticClose`,
`sideTracking`, `lowAngle`, `overhead`, `frontFacing` — each a pure
function of the character's current route frame (`computeShotTransform`).

Triggers, in priority order, each gated by a **hard 4.5s minimum gap**
between any two cuts:
1. Major event enters `impact` → `landmark` shot if one is within 82.5
   units, else `dramaticClose`.
2. `dropId` → `landmark` (if nearby) or `wideEstablishing`.
3. Crossing within 55 units of an unvisited landmark → `landmark` shot.
4. District changes → `bridge`→sideTracking, `tunnel`→lowAngle,
   `canyon`→overhead, everything else→wideEstablishing.

Entry/exit of every shot eases over 0.4s (`getCinematicBlend`). Cinematic
shots only ever blend on top of third-person (`cineBlend * (1 -
modeBlend)`) — first-person is untouched by this system.

**Known allocation note**: `findNearestLandmark` does a per-frame linear
scan with small `Vector3` allocations. Landmark counts are tiny (a handful
per lap), so this is accepted as negligible rather than optimized — flagged
in a code comment, not a bug.

---

## 6. CHARACTER SYSTEM

`scenes/cyberpunkCity/Character.tsx`. Reads `characterMotionState`
(published by `CameraRig`) — does not own any route/speed logic itself.

### Construction

Deliberately primitive: a single shared unlit `MeshBasicMaterial` (`color:
'#000000'`) — pure flat black silhouette, no toon shading, no texture, no
face. Body = box torso + sphere head + two box legs + two box arms, each
limb in its own pivot `<group>` (offset so the mesh hangs below the pivot,
the standard technique for limb-swing rotation).

### Movement state machine

Four states — `idle`/`walk`/`run`/`sprint` — classified from
`characterMotionState.speed` against thresholds relative to
`MIN_SPEED`/`MAX_SPEED` (imported from `musicController.ts`, not
duplicated), **plus** an independent `forceSprintTimer` set by strong
beats/drops/major events so the character visibly surges with the music
rather than only passively tracking speed.

**There are no animation clips** — each state has a target `Pose` (stride
frequency/amplitude, arm-swing amplitude, lean, crouch, idle-breathe
weight), and every frame the *current* pose smoothly interpolates toward
the target (rate `1 - exp(-dt*6)`). This interpolation **is** the
transition mechanism; there is no separate cross-fade system.

### Jump sequence

`anticipation` (0.14s crouch) → `air` (real gravity-integrated vertical
offset, `GRAVITY = 20`, launch velocity 7.2) → `land` (0.18s compression) →
`none`. Triggered **only** by a major event impact — deliberately rare, a
"special action," not a platformer mechanic and not a dance move.

### What still needs improvement (per the user's own repeated framing)

- Limbs are single-segment (no knee/elbow joints) — reads as stiff/robotic
  up close even though it's readable from a distance.
- No idle-specific micro-animation beyond the breathing sway.
- Landing/jump poses are minimal (a tuck offset), not a distinct silhouette.
- The character has not been revisited since the animation-state-machine
  pass — everything since has been camera/world work.

---

## 7. WORLD GENERATION

Two files: `world/routeGenerator.ts` (the path) and `world/worldGenerator.ts`
(everything placed relative to it). Both are pure functions of a seed
(`WORLD_SEED = 1337` in `layout.ts`) via `world/seededRandom.ts`'s
mulberry32 PRNG — **fully deterministic**, same seed → same world, every
time. This matters for future reproducibility/export/sharing features.

### Route (`routeGenerator.ts`)

A **closed loop** — `THREE.CatmullRomCurve3` with `closed: true` through 30
anchor points arranged around a circle of `BASE_RADIUS = 260` (±24% radius
jitter, ±angle jitter). Each anchor carries a `District` and a
`corridorRadius`. Anchors are grouped into contiguous runs of 3-4 assigned
to the same district (`buildDistrictSequence` shuffles once then repeats,
guaranteeing every district appears at least once per lap).

**8 districts**: `downtown`, `boulevard`, `towerDistrict`, `plaza`,
`industrial`, `bridge`, `tunnel`, `canyon` — each a `DistrictProfile`
(`corridorRadius`, `heightBias`, `buildingDensity`, `heightRange`). `tunnel`
is the tightest/densest (no literal tube geometry — density alone reads as
a compressed passage); `canyon` is narrow/sparse/very tall.

**Collision safety is structural, not checked**: `getFrameAt(t)` returns
`{position, tangent, right, up}` — `right` is `worldUp × tangent`
(guarded against the degenerate near-vertical case, which
`MAX_HEIGHT_DELTA_PER_ANCHOR = 13` per-anchor slope cap is specifically
tuned to prevent from ever actually occurring). Every piece of world
geometry is placed at `routePosition + right * (corridorRadius + margin)` —
it is mathematically impossible for geometry generation to place something
inside the corridor, because the offset is always ≥ the corridor's own
radius at that point. This is *the* reason flying-through-buildings has
never recurred since it was fixed.

### World (`worldGenerator.ts`)

Walks 205 samples around the route (`SAMPLE_COUNT`, scaled to route
circumference). At each sample, per side, with probability
`profile.buildingDensity`: places a building via `buildBuilding()`.

**Buildings** are procedural multi-segment stacks (a `Segment` = position +
`rotationY` + optional `tiltX/tiltZ` for roof wedges + scale + `seed` +
`hueShift`):
- A foundation plinth (wider than the body) so it visually sits on the
  ground instead of floating — ties into `Ground.tsx`'s terrain skirt at
  the same base elevation.
- 1-4 stacked, narrowing, offset segments (setback towers), or a
  low-rise/wide variant (~22% chance).
- Optional roof: spire (faceted cone), pyramid cap, or a giant tilted
  "wedge" roof slab — probabilities biased per-district (`DISTRICT_FLAVORS`
  → `wedgeBias`).
- Optional cantilevered suspended platform (~16% for tall non-low-rise).
- Antennas, rooftop machinery (probability boosted 2.2× in `industrial`),
  signs — each its own small `InstancedMesh` type, rendered in
  `Buildings.tsx`.

**Landmarks** (rare, large, distinct — not more boxes): at each anchor
that starts a new district group, `pickLandmarkKind` chooses `gateway`
(existing pillars+beam, everywhere), `reactorRing` (industrial-leaning, a
`THREE.TorusGeometry` with orbiting energy-node spheres and a world-aligned
energy beam that fires on major events), or `giantSpire`
(tower/canyon-leaning, a colossal freestanding cone 55-100 units tall with
a pulsing beacon and a tilted orbiting accent band). Landmarks are rendered
in `Landmarks.tsx` as individual (non-instanced) meshes — there are only a
handful per lap, so this is fine.

**Ground** (`Ground.tsx`) is a ribbon mesh (not a flat plane) that follows
the route's centerline/width/elevation exactly, plus two wider
"terrain-skirt" ribbons flanking it (coarser grid, darker) so buildings
read as standing on continuous ground rather than ending in void.

**Background** (`BackgroundSkyline.tsx`) scatters 90 large silhouette
buildings in a ring (380-620 units radius — deliberately well outside the
route's max bounding radius, ~320 units) around the *entire* loop, since
it's a closed loop rather than a corridor with one distant end.

**District color identity**: each `Segment` carries a `hueShift` (0 =
default cool, 0.5 = warm/industrial rust-orange, 1 = vivid canyon/plaza
magenta), baked in at generation time from `DISTRICT_HUES`, consumed by
`Buildings.tsx`'s shader via an `aHue` instanced attribute.

---

## 8. VISUAL STYLE / ART DIRECTION

**This is the area with the most remaining work, per repeated, explicit
user feedback across many iterations.** The target has been stated
consistently: anime-inspired, video-game-like, stylized, cel/toon shaded,
strong silhouettes, exaggerated — explicitly **not** photorealistic,
**not** "generic AI-generated 3D buildings," **not** "realistic cyberpunk,"
**not** a "basic neon city."

### What's actually implemented (as of this commit)

- **Cel/toon shading** on building facades (`Buildings.tsx`'s
  `BuildingMaterial`): hard 3-band lighting from face-normal-vs-key-light
  (`1.0 / 0.5 / 0.16` — recently darkened for more contrast), combined with
  a 4-band vertical posterization of the base color — genuine light/dark
  *planes* per face, not a smooth gradient.
- **Toon outlines** (added this session) via the inverted-hull technique:
  a second `InstancedMesh` sharing the main segments' exact instance
  matrices (copied via `instanceMatrix.copyArray`, not recomputed), pushed
  outward along each vertex normal by a **world-space-constant** thickness
  (`uOutlineWidth / instanceScale`, compensating per-axis for each
  building's own non-uniform scale — this correction is necessary, a naive
  fixed object-space push would make outlines absurdly thick on
  tall/thin segments), rendered `BackSide`-only.
- **Stylized rim lighting** (fresnel-based, tuned cool-accent color) on
  building silhouette edges.
- **Posterized/hashed window pattern** with a per-building "brightness
  hierarchy" (some buildings mostly dark, some densely lit — hashed from
  each building's own seed, not uniform).
- **Roof-shape variety**: faceted low-poly spires, pyramid caps, tilted
  wedge slabs — biased per-district.
- **Landmarks**: reactor rings (torus + orbiting nodes + energy beam),
  giant spires (colossal cones + pulsing beacon + tilted accent ring) — see
  §7.
- **Always-on ambient animation** (independent of any audio event, so the
  world reads as alive even when the music is quiet and the camera is
  calm): rooftop machinery continuously rotates; antenna/sign materials
  pulse opacity via layered sines; ground grid has a slow traveling energy
  flow; sky horizon has a slow shimmer; a slow light-scan band travels up
  every building facade.
- **Beat-switch reactivity**: `Buildings.tsx` now also consumes
  `spectralShiftId`, feeding the same illumination-pulse mechanism
  beats/snares use — a beat switch visibly flashes the skyline.
- **District color identity** (§7) and **atmospheric perspective** (fog
  distance-based blend toward `uFogColor` in every custom shader).
- **Cinematic post-processing**: bloom (energy + beat-pulse + major-event
  driven), vignette (lifts during major events), chromatic aberration
  (pulses on major events only).

### What still feels weak (honest, per the user's own repeated framing)

- The user's core, repeated complaint has been some version of: *"it still
  looks like a procedural 3D city with visualizer effects."* The outline
  pass (this session) is explicitly framed as one meaningful step, not a
  finished answer.
- No curved walls, no true arches (the "gateway" landmark is a rectangular
  frame, not an arch), no genuinely asymmetrical/organic architecture —
  everything is still fundamentally box-based (setback stacks, wedges,
  cones on top of boxes).
- No dedicated industrial-archetype geometry (pipes, tanks, cranes) — the
  industrial district is currently just "more rooftop machinery + wedge
  roofs + a warm palette + reactor rings," a parameter bias on the same
  generator, not a distinct visual language.
- Districts are recognizable by corridor width/height/color, but not by
  fundamentally different geometry systems (explicitly scoped out multiple
  times as "a larger, dedicated effort").
- No true set-piece "the world transforms" moments beyond lighting/particle
  spectacle — no literal building-opens, gate-opens, or structural
  transformation animation.
- The outline technique is only applied to the main `Buildings.tsx`
  segments mesh — roof caps, landmarks, and props do not have outlines,
  which may read as visually inconsistent up close.

---

## 9. MUSIC → VISUAL DESIGN PHILOSOPHY

The world should feel **conducted** by the song — not "reacting to" it in
the sense of individual effects triggering, but genuinely paced by it.
The hierarchy (rarer event = bigger reaction) is a hard rule, established
over many iterations of the user rejecting "everything shakes/flashes
constantly":

```
HI-HAT / SNARE  → environment only (particles, sign flicker, small flashes)
                   NEVER the camera.

REGULAR BEAT    → camera: almost nothing (tiered, see §5 REACT_BAR).
                   World: an illumination pulse (small).

STRONG 808      → camera: a real but modest, VARIED impulse (forward/
                   vertical/rotational/FOV — rarely lateral).
                   Speed: a burst. World: a bigger pulse.

DROP            → speed: sectionMultiplier surge (2.3x, held ~4.5s).
                   Camera: forward+vertical+FOV combined impulse.
                   World: bigger ground ripple, particle burst.
                   Cinematic: often triggers a shot cut.

SPECTRAL SHIFT  → world: skyline flash (via the same pulse mechanism).
(beat switch)      Rare (2.5s min interval) by design.
                   Can also trigger a major event / cinematic cut.

MAJOR EVENT     → rare (7s min gap), coordinated: camera gets its biggest
(anticipation→     launch + altitude dive, buildings surge to near-full
impact→reaction→   illumination, ground fires a much bigger ripple,
recovery)           particles explode, atmosphere flashes hard + fog
                    pulls back, bloom/vignette/chromatic-aberration spike,
                    cinematic camera very likely cuts to landmark/dramatic-
                    close. A brief anticipation dip (dimmer lighting,
                    slightly slower world) precedes it.
```

The `majorEventState` singleton (`world/musicEventDirector.ts`) is the
shared source of truth for this lifecycle — **every** system that
participates in a major event reads either `majorEventState.impactEventId`
(via `consumeEvent`, exactly-once) for one-shot triggers, or
`getMajorEventEnvelope()` (continuous 0..1, safe to read every frame from
anywhere) for smooth surge-and-fade scaling. Do not build a second event
system for this — extend this one.

---

## 10. CURRENT PROBLEMS (honest assessment)

In rough priority order, based on actual code inspection and the pattern of
user feedback across iterations:

1. **Visual style is still the single biggest gap.** Despite the outline/
   posterization/toon-shading work, the world is still fundamentally
   "procedurally arranged boxes with a stylized shader" rather than
   "authored game architecture." This has been the top note in nearly
   every user message for the last several iterations.
2. **Districts are parametrically distinct but not architecturally
   distinct** — same generator, different knobs. A player moving through
   `industrial` vs `downtown` sees different colors/density/roof-bias but
   the same fundamental box-stack language.
3. **Major events are visually loud (bloom/flash/ripple/particles) but not
   narratively "insane"** — there's no moment where something structural
   actually happens (a gate opening, a building transforming). The
   reactor ring is the closest thing to this and it's one landmark type.
4. **Character animation is functional but not expressive** — no joints,
   minimal pose variety beyond the 4 states + jump.
5. **No genuine set-piece geometry** (arches you pass under as an event,
   bridges as literal traversable structures, tunnels as literal enclosed
   geometry) — districts imply these via corridor tightness/height, not
   actual matching geometry.
6. **The outline pass is inconsistent** — only the main building segments
   have it; roof caps, landmarks, and small props don't, which will read
   as visually mismatched on close inspection.
7. **`findNearestLandmark` in `cinematicDirector.ts` allocates per-frame**
   — accepted as negligible given tiny landmark counts, but worth knowing
   if landmark density ever increases substantially.
8. **First-person mode has not been iterated on in several sessions** —
   it still works (verified) but all recent camera work has been
   third-person/cinematic-focused per explicit user instruction.

---

## 11. RECENT DEVELOPMENT HISTORY

Chronological, from `git log`. Each entry: commit hash — what — why (from
commit message intent, condensed).

- `8d93d31` **Initial commit** — React+Vite+R3F foundation: audio decode/
  playback pipeline, a single cyberpunk-city scene with procedural
  buildings/ground/atmosphere/particles, camera driven directly by audio
  features (no route yet).
- `4db10d9` **Rework city scene** — stylized architecture pass, depth
  layers (fore/mid/background), "reliable beats" (early exactly-once
  event consumption), first cinematic camera attempt.
- `f3850e2` **Camera choreography system** — replaced ad hoc camera
  reactions with a more structured system; shape/palette stylization pass.
- `955b589` **Replace free-floating camera with a route/world system**
  — THE foundational architecture shift: from "camera flies wherever" to
  "there is a route, the camera rides it" (Mario Kart model). Introduced
  `routeGenerator`/`worldGenerator` in their earliest form.
- `ca87e71` **Musically-aware audio analysis + MusicEventDirector** —
  replaced simple amplitude-threshold beat detection with the current
  spectral-flux/adaptive-threshold system; introduced the major-event
  lifecycle (`anticipation→impact→reaction→recovery`).
- `20086c5` **Rebalance camera speed, cel/toon shading, bigger world with
  new districts** — first toon-shading pass; districts expanded; camera
  speed tuning began (an early sign the speed model needed real
  iteration).
- `2a74cb0` **Save next-iteration plan** — a large plan was drafted and
  explicitly saved (not implemented) for a later session, per user
  request to pause and preserve context (a precedent for *this* document).
- `a553319` **Camera stability overhaul + always-on world animation +
  district character** — first serious push on "camera moves too much";
  introduced always-on ambient animation (machinery rotation, sign pulse,
  etc.) as a philosophy: "the world should feel alive without the camera
  doing anything."
- `bc44845` **Remove hi-hat/snare camera reactions, add landmark shapes +
  district color** — established the hard rule in §4/§9: hi-hats/snares
  never touch the camera. Introduced the reactor-ring/giant-spire landmark
  system and per-district `hueShift`.
- `8a9f939` **Low-frequency-only camera with varied impulses + landmark
  spectacle** — the tiered `REACT_BAR`/`STRONG_BEAT_BAR`/`VERY_STRONG_BAR`
  system and the 5-kind weighted-random impulse picker (this is still the
  current design, largely unchanged since).
- `3c174ea` **Add a playable-looking character + third/first-person camera
  toggle** — introduced `Character.tsx`, `characterMotionState.ts`,
  `viewModeStore.ts`. First version of the character had one looping run
  animation only.
- `9fe8462` **Character animation state machine + automatic cinematic
  camera director** — replaced the single loop with the current
  idle/walk/run/sprint pose-interpolation system + jump sequence;
  introduced `cinematicDirector.ts` and the shot-cut system (§5). Also
  reframed third-person as the *default*, first-person as secondary.
- `6ade2b5` **(current HEAD) Toon outlines, stronger posterization,
  beat-switch reactivity, pre-drop dip** — the inverted-hull outline
  technique, darkened toon bands, `spectralShiftId` now feeds the
  building-pulse mechanism, and the anticipation-phase speed dip in
  `musicController.ts`.

**Pattern to notice**: almost every iteration after `955b589` has been
"the camera does too much / the wrong things" followed by a correction,
until `bc44845`→`8a9f939` established the current stable rule set — after
which the user's focus shifted decisively toward "the world doesn't look
like a game" (this is the throughline of the last 3-4 iterations and this
handoff's own §10 priority #1).

---

## 12. CURRENT GIT STATE

```
Branch:          main (tracking origin/main, up to date)
Working tree:    clean
Latest commit:   6ade2b5ea313f02cdd855846ddb07d97c846cd90
Author:          Aarya Sarna <aarya.sarna@gmail.com>
Date:            Sun Aug 16 00:34:28 2026 -0500
Subject:         Toon outlines, stronger posterization, beat-switch reactivity, pre-drop dip
Remote:          https://github.com/sarna-aarya123/music-visualizer (private)
```

All commits on this project have been authored solely as `Aarya Sarna
<aarya.sarna@gmail.com>` — no co-author lines. Keep this convention.

---

## 13. WHAT NOT TO BREAK

These systems are working, have been explicitly validated by the user
across multiple iterations, and should be **improved in place**, not
rewritten, absent a demonstrated bug:

- **The low-frequency-only camera rule** (§4, §5) — hi-hats/snares must
  never gain a path to camera position/rotation/FOV/banking, direct or
  indirect (re-check `impactScore`'s energy gate if you touch it).
- **The tiered beat-reaction system and 5-kind impulse picker** in
  `CameraRig.tsx` — specifically the "lateral is rare" weighting.
- **Route collision safety** — the `corridorRadius`-offset placement
  guarantee in `worldGenerator.ts`. Never place geometry without an
  offset ≥ the local corridor radius.
- **Grounded buildings** — the foundation-plinth + terrain-skirt pairing.
  Don't reintroduce floating geometry.
- **Seeded/deterministic world generation** — every `Math.random()` in
  world-generation code should be going through an `Rng` from
  `seededRandom.ts`, not the global `Math.random`. (Note: a few files
  outside `world/` — `BackgroundSkyline.tsx`, `StreetProps.tsx` — still use
  raw `Math.random()` for decorative placement; this is pre-existing and
  not part of the core deterministic world, but be aware if "same seed,
  same world" ever needs to extend to *everything* visible.)
- **The exactly-once event consumption pattern** (`beatConsumer.ts`) — any
  new discrete audio event should follow this pattern (its own
  `idCounter`/`intensity` pair, a typed `consumeX` wrapper), not a boolean.
- **The `majorEventState` lifecycle** as the single source of truth for
  coordinated "everything reacts together" moments.
- **The character/camera relationship** — `CameraRig` owns `t`/speed and
  publishes `characterMotionState`; `Character.tsx` is a pure reader. Don't
  invert this or duplicate route-progress ownership.
- **The cinematic director's "reasons only, never a timer" rule**, and its
  hard minimum gap between cuts.
- **Build/typecheck cleanliness** — `npx tsc -b` and `npm run build` have
  been kept clean (zero errors) at every single commit in this project's
  history. Do not merge/leave a broken build.

---

## 14. NEXT DEVELOPMENT DIRECTION (roadmap, not a task list — do not implement without discussing with the user first)

Priorities, matching the user's own stated priority letters:

**A. World geometry that reads as *authored*, not *generated*.** The
highest-leverage next step is almost certainly extending the outline
technique to more mesh types (roof caps, landmarks) for visual consistency,
then introducing at least one genuinely different shape *primitive* beyond
box-stacks — e.g. an actual curved/arched form (a lathe or extruded curve
geometry) used sparingly as a signature shape for one district, rather than
another parametric variation of the existing box generator.

**B. Music-driven spectacle that feels structural, not just lighting.**
The reactor ring (rotating nodes + beam) is the template — the next step
is probably 1-2 more landmark types with genuine *motion* (not just
emissive pulsing) tied to `majorEventState`, e.g. something that visibly
opens, rises, or reconfigures. Keep it rare (reuse the existing 7s+ gap).

**C. District identity beyond palette/density.** If pursued, this likely
means each district's `buildBuilding` call routes through a *different*
shape-generation function (still procedural, still seeded) rather than one
function with district-biased parameters. This is a bigger lift — treat it
as its own focused iteration, not a bolt-on.

**D. Character expressiveness.** Lower priority than A/B per the user's own
sequencing (world > character, repeatedly). If picked up: knee/elbow joints
would be the highest-value single change for how "stiff" the character
currently reads.

**E/F/G. Cinematic storytelling, memorable moments, synchronization
polish.** These are explicitly framed by the user as *outcomes* of doing
A/B/C well, not separate systems to build. Do not add a "memorable moment
generator" subsystem — memorable moments should fall out of better
geometry and better-choreographed major events.

**Explicitly avoid**: adding new one-off visual effects that don't compose
with the existing systems (§15 has the permanent rule against this);
touching the camera reaction hierarchy again without a specific, named
complaint from the user (it has been iterated on more than any other
system and the user has said it's "good enough" — see §16); rebuilding
audio analysis without a demonstrated bug.

---

## 15. DEVELOPMENT RULES (permanent, cross-iteration)

1. Do not make the camera constantly move. Stable-by-default is a feature.
2. Hi-hats/snares never move the camera — direct or indirect path.
3. Low frequencies/808s are the primary camera signal; regular beats get
   almost nothing.
4. Drops must feel significantly more powerful than ordinary strong beats.
5. Major events must stay rare (currently ≥7s apart) to stay spectacular.
6. No movement — camera, character, or otherwise — without a musical or
   route-choreography justification. No "make it feel alive" via random
   jitter; use deliberate, sourced motion (route curvature, a specific
   audio event, an always-on deterministic animation loop).
7. Prefer stylized/authored-looking shapes over more randomized box
   variations. If a change makes the generator more complex without
   changing the *silhouette language*, it's probably not worth it.
8. Prioritize anime/game aesthetics over realism, always.
9. Keep the world comfortable to watch — don't sacrifice stability for
   spectacle (this is a direct, repeated user instruction).
10. Don't add features to raise feature count. The user has repeatedly
    said they'd rather have "5 amazing landmarks than 50 generic ones."
11. Build reusable systems (see `majorEventState`, `beatConsumer.ts`, the
    district-flavor tables) rather than hardcoding one-off effects.
12. Keep audio analysis decoupled from rendering — `FeatureExtractor`
    should never import from `scenes/` or `three`.
13. Keep the world deterministic from its seed (`WORLD_SEED`) — new
    generation code should use `seededRandom.ts`'s `Rng`, not raw
    `Math.random()` (see the caveat in §13 about existing exceptions).
14. Maintain typecheck/build cleanliness — verify with `npx tsc -b` and
    `npm run build` before considering any change complete.

---

## 16. IMPORTANT CREATIVE REFERENCE

> Imagine a Mario Kart level, except the music controls the intensity,
> speed, animation, environmental effects, and cinematic moments.

The character is *intentionally* a simple black stick figure — this is a
deliberate, repeated, explicit choice, not a placeholder waiting to be
replaced with a detailed model. **Do not add realistic skin, clothing,
texture, or a detailed face to the character.** The simplicity is the
point: it lets the *world* be the visual subject.

Mario Kart / Pokémon / anime games are referenced only for:
- an authored, designed-game-world *feeling* (not literal recreation)
- readable, strong silhouettes
- exaggerated, stylized animation
- colorful, intentional (not realistic) environments
- cinematic, purposeful camera movement
- visual clarity over chaos

If a proposed change pushes toward realism, subtlety, or "more particles/
more effects" as a substitute for actual geometric/architectural
improvement, it is very likely moving in the wrong direction for this
project.

---

## 17. HOW THE NEXT CLAUDE SHOULD WORK

- **Inspect before changing.** Read the actual current file content before
  editing — this project has been through ~15 iterations and file contents
  drift from what any summary (including this one) says. This document is
  a map, not a substitute for reading the territory.
- **Typecheck and build after every change** (`npx tsc -b`, `npm run
  build`) — this project has maintained a zero-error build at every commit;
  don't be the first to break that.
- **Verify visually** using the browser-preview tooling
  (`mcp__Claude_Browser__preview_start` with the `music-visualizer-dev`
  launch config) after any change that affects rendering — screenshot it,
  don't just trust the type checker.
- **Don't rewrite working systems.** If something in §13 needs to change,
  that's a strong signal to slow down and confirm the reasoning is sound,
  not a routine refactor.
- **Make one coherent improvement at a time.** Every past iteration in this
  project's history has been scoped to a specific, named problem the user
  raised. Resist the urge to bundle unrelated improvements into one pass.
- **Prioritize the actual creative goal over literal instruction-following**
  when they conflict in a small way — e.g. if a user request would reopen
  a settled problem (like camera hi-hat reactions), it's worth a brief
  clarifying note rather than silently reintroducing a rejected pattern.
- **Before adding any new subsystem, ask**: does this make the visualizer
  look more like a stylized video game, or does it just add complexity?
  If it's not clearly the former, it's very likely not worth building this
  session — this project has an explicit, repeated bias toward depth and
  polish on existing systems over feature count (§14, §15 rule 10).
- Commits in this repo are authored solely as `Aarya Sarna
  <aarya.sarna@gmail.com>`, no co-author trailer — follow this convention
  unless told otherwise.

---

## CURRENT PROJECT STATE

The project is a working, deployable (locally, via `npm run dev`) React +
Three.js/R3F music visualizer with a mature, decoupled audio-analysis
pipeline (spectral-flux-based adaptive onset detection for kick/snare/
hi-hat/spectral-shift/drop/breakdown, plus a composite impact score), a
fully deterministic seeded world generator (a closed-loop route through 8
procedurally-varied districts, with collision-safety guaranteed by
construction rather than checked), a stable and carefully-tiered camera
system (third-person default with an automatic, event-driven cinematic
shot director; first-person available but not recently iterated), a
minimalist black-silhouette character with a real animation state machine
(idle/walk/run/sprint + a gravity-simulated jump sequence, all tied to the
same music hierarchy as the camera), and a growing set of stylized
rendering techniques (cel/toon-shaded facades, inverted-hull outlines,
per-district color identity, always-on ambient world animation, and a
coordinated rare "major event" spectacle system). The build is clean
(`tsc -b` and `vite build` both pass with zero errors) and the working
tree is clean at commit `6ade2b5` on `main`, pushed to
`github.com/sarna-aarya123/music-visualizer`.

The camera and character systems are considered **settled and working
well** by the user as of this commit — further iteration should not
revisit their fundamental reaction rules without a specific, new complaint.
The **dominant open problem, repeated across nearly every recent user
message, is visual/architectural art direction**: the world is
functionally excellent (fast, deterministic, safe, richly reactive to
music) but still reads more as "a stylized procedural city" than "an
authored anime/video-game level." The highest-value next work is almost
certainly deeper geometric/silhouette authorship (new shape primitives, not
more parametric variation of the existing box-stack generator) and
structural (not just lighting-based) spectacle for major musical events.
