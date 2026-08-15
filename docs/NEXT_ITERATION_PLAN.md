# Music-Reactive Visualizer — Next Major Iteration (planned, not yet implemented)

> Saved verbatim from the user on 2026-08-15. Do NOT implement until the user
> explicitly asks to run this plan. When they do, treat this file as the
> spec for that session.

We've tested the latest version with multiple real tracks. The current implementation is a good technical foundation, but there are still three major problems:

1. The camera is constantly moving and is annoying to watch.
2. The world still doesn't actually look/feel animated enough.
3. The music reactions are still too subtle and don't create enough "holy shit" moments.

Do NOT throw away the current architecture. The audio detection, world generation, route system, event director, beat consumers, toon shading, etc. are all valuable.
This iteration should focus on polish and art direction, not rebuilding the entire architecture.

## 1. CAMERA STABILITY IS THE HIGHEST PRIORITY

The camera currently moves constantly:

* lateral movement
* small direction changes
* continuous banking
* constant positional changes
* frequent camera impulses

Even though the movement technically works, it makes the visualizer tiring to watch.

I want the camera to feel like a cinematic racing-game camera.

Think: Mario Kart camera + anime music video
NOT: shaky procedural camera.

The camera should have a stable baseline.

**Baseline camera behavior** — during normal sections:

* smooth forward travel
* stable horizon
* minimal lateral movement
* minimal rotation
* very little banking
* no random direction changes
* no constant camera shake
* no unnecessary FOV movement

The environment should move around the camera rather than the camera constantly moving around itself.

The viewer should be able to comfortably watch the scene.

## 2. REMOVE RANDOM CAMERA MOVEMENT

This is extremely important.

The camera should NEVER move simply because the procedural system decided to move it.

Avoid:

* random lateral sine waves
* random look-at changes
* random direction changes
* random altitude changes
* constant banking
* constant camera shake
* arbitrary waypoint changes

Every meaningful camera movement should have a reason. That reason should be one of:

**A. Route choreography** — the world route naturally turns, rises, falls, etc.
**B. Music** — a musical event causes a deliberate reaction.
**C. Cinematic transition** — a major section transition intentionally changes the camera behavior.

There should be no "noise" movement just for the sake of making the camera look alive.

## 3. STABLE HORIZON

The horizon should remain mostly stable.

Do NOT allow the camera to:

* randomly tilt
* point upward
* point downward
* flip
* roll
* rotate excessively

Banking should be:

* subtle during normal turns
* moderately stronger during high-energy sections
* dramatic only during major events

Even during intense sections, the camera should remain readable.

## 4. CAMERA MOVEMENT SHOULD HAVE A HIERARCHY

Think of movement in levels.

**Level 0 — Normal.** Almost completely stable: smooth forward motion, stable camera, no shake.

**Level 1 — Regular beat.** Very small: FOV punch, tiny camera impact, subtle banking. The viewer should notice the music but NOT feel nauseous.

**Level 2 — Strong 808.** Short: forward acceleration, small camera punch, stronger FOV, brief shake. Then immediately return to stability.

**Level 3 — Drop.** This is where we can go crazy: strong acceleration, aggressive but controlled banking, FOV expansion, major trajectory change, large environmental reaction. But even here, the camera should remain readable and stable enough to watch.

**Level 4 — Major musical event.** A full cinematic sequence can happen: sudden camera dive, dramatic acceleration, tunnel entry, sweeping turn, large altitude change, environment transformation. Then return to stable cruising.

## 5. IMPORTANT: DON'T MAKE EVERYTHING MOVE

The previous versions kept trying to make the visualizer feel alive by constantly moving the camera. That's not necessary.

A scene can feel extremely alive while the camera is relatively stable if the WORLD is animated. This is the direction I want now.

Instead of: camera constantly moving + static world
I want: stable camera + living world

## 6. THE WORLD NEEDS TO ACTUALLY LOOK ANIMATED

This is currently the second biggest problem.

The toon shading helped, but the environment still largely looks like "procedurally generated 3D buildings."

I want "an actual stylized video-game level."

Think: Mario Kart, Pokémon, anime games, futuristic racing games, stylized game environments.

The world should feel authored, not generated.

## 7. BUILDINGS NEED MORE PERSONALITY

Do NOT just add more boxes. Create distinct architectural archetypes.

**Cyberpunk tower** — giant angled roof, glowing vertical strips, animated signs, rooftop machinery, exaggerated silhouette.

**Futuristic plaza building** — curved walls, giant arches, floating elements, holographic displays.

**Industrial building** — pipes, tanks, vents, machinery, moving components.

**Anime-style tower** — exaggerated proportions, giant antenna, unusual geometry, strong color accents.

**Landmark** — large structures that immediately stand out from normal buildings. The viewer should be able to remember "Oh shit, that's the giant tower" instead of "That's another building."

## 8. ADD ACTUAL ANIMATION TO THE ENVIRONMENT

This is critical. The world should visibly move even when the camera isn't doing much.

Examples: animated neon signs, rotating holograms, pulsing billboards, moving lights, animated machinery, rotating antennas, moving energy rings, animated streetlights, drifting fog, moving clouds, animated water, particle streams, moving light trails, environmental energy systems, animated vegetation, distant flying objects if performance permits.

These shouldn't all react to the music. Some should simply have continuous animation loops. The goal is to make the world feel alive.

## 9. CREATE GAME-LEVEL SET PIECES

This is where I want the biggest visual improvement.

The route shouldn't just be: road → buildings → road → buildings.

Instead, create memorable areas such as:

* **Neon downtown** — dense futuristic buildings, signs, holograms.
* **Giant bridge** — camera travels across an enormous bridge with a huge skyline.
* **Tunnel** — a dramatic enclosed section with lights rushing past.
* **Industrial zone** — large machines, pipes, factories, energy systems.
* **Canyon** — massive stylized cliffs with structures built into them.
* **Plaza** — huge open space with a giant central landmark.
* **Elevated city** — roadway above the city with distant skyline underneath.
* **Underground section** — completely different lighting and atmosphere.

The camera should feel like it is discovering a world.

## 10. MUSIC SHOULD ACTIVATE THE WORLD

This is where we combine the audio system with the new animation. The music shouldn't just control particles — it should control the environment itself.

**Regular beat** — small synchronized reactions: lights pulse, windows flash, signs flicker, particles respond.

**808** — strong: buildings pulse, ground wave, lights intensify, camera impact, environment scale pulse.

**Snare / clap** — sharp: light flash, sign flash, particle burst, brief camera snap.

**Hi-hat** — fine details: sparks, tiny particles, small light flickers.

## 11. BIG DROPS SHOULD CREATE CRAZY EVENTS

This is where the visualizer should become special. A major drop should feel like the entire game level just reacted to the song.

**Before drop**: camera slows, environment becomes darker, fewer particles, anticipation.

**Drop**: BOOM — massive camera acceleration, giant FOV punch, skyline lights activate simultaneously, buildings pulse, giant ground wave, particles explode outward, fog reacts, bloom spikes, neon signs activate, major landmark lights up.

**Then**: post-drop cruising — camera settles, environment stays energized, world continues reacting to the new section.

The important part is that the event should be visually unmistakable.

## 12. USE THE EXISTING AUDIO DETECTION SYSTEM

The previous iteration added: bass/808 detection, snare detection, hi-hat detection, spectral flux, frequency distribution change, drop detection, breakdown detection, impact score, MusicEventDirector.

Keep all of this. Do not replace it unless there is an actual bug.

The next step is to make the consumers much more visually meaningful.

## 13. AUDIO DETECTION SHOULD REMAIN FREQUENCY-AWARE

Continue separating: sub bass, 808/bass, kick, low-mid, snare/clap, high frequencies, spectral changes.

The important thing is: a huge 808 should be recognized as an 808 even if overall loudness doesn't change dramatically. Likewise, a beat switch should be recognized even if the song's volume stays similar.

Continue using: spectral flux, adaptive thresholds, rolling averages, frequency distribution comparison, transient detection, local peaks.

Do not fall back to simply `volume > threshold`.

## 14. MAKE THE WORLD'S REACTION MORE PRONOUNCED

Right now the system technically reacts to music, but sometimes the reaction is something I have to consciously look for. That needs to change.

If there's a massive musical event: I should immediately see it. Don't be afraid to exaggerate. The project is a music visualizer — it is okay for the environment to behave unrealistically.

## 15. BUT DON'T MAKE THE CAMERA THE ONLY SOURCE OF ENERGY

This is important. Previously we tried to make things feel more exciting primarily by moving the camera faster. That isn't the answer.

Instead:

* Camera = controlled
* World = energetic
* Music = conductor

The camera should give the viewer a good cinematic perspective while the environment does the crazy stuff.

## 16. CAMERA + WORLD SHOULD WORK TOGETHER

**Huge 808** — Camera: tiny forward punch. World: buildings pulse, ground wave, lights flash.

**Major drop** — Camera: dramatic acceleration. World: skyline activates, giant landmark explodes with light, particles burst, road reacts, environment changes.

**Beat switch** — Camera: controlled transition into a new area. World: new color palette, different architecture, different animation style, different atmosphere.

This makes the music feel like it's driving the level.

## 17. MAKE DIFFERENT MUSICAL SECTIONS FEEL DIFFERENT

The world should not look identical throughout the entire song.

* **Intro** — quiet, dark, sparse, slow.
* **Build** — more lights, more movement, more particles, increasing activity.
* **Drop** — high energy, intense lighting, dramatic movement, major event.
* **Verse** — controlled, moderate activity.
* **Beat switch** — different environment/palette, new visual language.
* **Breakdown** — slow, spacious, atmospheric.

This makes the visualizer feel like an actual music video rather than a reactive screensaver.

## 18. KEEP THE WORLD PHYSICALLY COHERENT

Continue the previous fix for floating buildings. Everything should sit on: terrain, roads, platforms, foundations, cliffs, sidewalks.

Avoid: floating buildings, disconnected structures, impossible road geometry — unless something is deliberately floating as a clearly intentional sci-fi element.

## 19. DO NOT OVERDO RANDOMNESS

The previous problem was that the camera sometimes felt random. Do not replace that with a world that is also randomly doing things.

Use deterministic, music-driven choreography. The same song should produce approximately the same visual sequence every time.

Same song → same world seed → same route → same major event locations → same general choreography.

This will eventually become very important for rendering/exporting videos.

## 20. PERFORMANCE

Keep the existing performance architecture. Do not introduce unnecessary per-frame React state. Avoid excessive allocations. Reuse buffers. Keep Three.js rendering efficient. Use instancing where appropriate.

The environment can become significantly richer, but maintain a reasonable performance budget.

## 21. PRIORITY ORDER

Do NOT try to make everything equally important. Implement in this order:

1. **Camera stability** — make the camera comfortable and controlled.
2. **World animation** — make the environment visibly alive.
3. **Game-level visual design** — create memorable structures, landmarks, tunnels, plazas, etc.
4. **Major music events** — make drops and beat switches visually insane.
5. **Fine polish** — particles, post-processing, lighting, small details.

## 22. DO NOT JUST ADD MORE EFFECTS

This is very important. If the result is still "buildings + particles + bloom + camera shake" then the iteration failed.

The goal is a world. I want the viewer to look at it and think: "This looks like an actual video game level." Then when the music hits: "Holy shit, the entire level reacted."

## 23. THE OVERALL VISION

The best mental model is: Mario Kart level + anime/video-game art direction + futuristic world + music video + music-reactive environment.

The camera is the player. The world is the level. The music is the controller. The beat controls the rhythm. The drop controls the spectacle.

The camera should be stable enough to enjoy the world while the world itself becomes increasingly insane as the music demands.

## FINAL SUCCESS CRITERIA

When I upload a song, I should see:

A stable, cinematic camera
→ flying through a huge stylized game world
→ with animated environments and memorable landmarks
→ while the music controls the world
→ with obvious reactions to 808s, snares, and beats
→ and genuinely insane coordinated events during major drops

The camera should not constantly shake or wander. The world should not look like generic procedural buildings. The environment should not feel static. And the music should not feel like it's merely controlling particles.

The final feeling should be: "I'm flying through an anime/Mario-Kart-style video game world, and the entire level is being conducted by my song."

---

## Implementation notes for whoever picks this up (context from the current codebase)

Not part of the user's prompt — my own notes for continuity, since this plan
will likely be executed in a future session that needs to re-orient quickly.

- **Camera stability is a rebalancing job, not a rewrite.** `CameraRig.tsx` +
  `world/musicController.ts` already separate speed (structural,
  drop/breakdown-driven) from impact (beat/snare-driven decay refs) from
  banking (curvature + a small beat term). The fix is almost entirely
  turning down `lateralOffset`'s weave amplitude/frequency (currently a
  continuous sine, driven by nothing musical — exactly the "random lateral
  movement" complaint), reducing `beatBank`/`snareSnap` magnitudes toward
  near-zero at Level 0/1, and reserving today's magnitudes for Level 3/4.
  The route's own curvature-driven banking should stay — that's category A
  (route choreography), not noise.
- **`getMajorEventEnvelope()` and `majorEventState`** (`world/musicEventDirector.ts`)
  already give every consumer a shared anticipation→impact→reaction→recovery
  lifecycle — reuse this for Level 4 camera sequences and "insane drop"
  choreography rather than inventing a second event system.
- **Section-level "feel different" (item 17)** has a natural home: `dropId`/
  `breakdownId` already exist in `AudioFeatureFrame`; district palette/props
  in `worldGenerator.ts`/`routeGenerator.ts` could read a "current section
  mood" singleton (similar to `cameraMotionState`) written once by whichever
  component processes drop/breakdown, rather than every consumer
  re-deriving section state independently.
- **Determinism (item 19)** is already true for world generation (seeded
  RNG in `world/seededRandom.ts`) but NOT yet true for camera/event timing,
  since beat/drop detection depends on live playback timing, not the seed.
  If literal reproducibility matters for export later, that's a bigger
  question (pre-analysis pass vs. live analysis) worth a dedicated
  conversation before building on it.
- **Building archetypes (item 7)** — current `worldGenerator.ts` has one
  procedural building generator with shape-family variety (setbacks, low-
  rise, wedge roofs, spires). Distinct *archetypes* (cyberpunk tower vs.
  industrial vs. plaza) likely means a small archetype-selection layer
  choosing among a few generator variants per building, keyed off district,
  rather than one generator with more randomized parameters.
- Don't re-run the full architecture rewrite — `RouteGenerator`,
  `WorldGenerator`, `MusicEventDirector`, `FeatureExtractor`'s multi-band
  detection, and the beat-consumer exactly-once pattern are all explicitly
  called out as worth keeping.
