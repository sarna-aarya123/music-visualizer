import * as THREE from 'three';
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MusicEventDirector } from '../cyberpunkCity/MusicEventDirector';
import { RhythmState } from '../cyberpunkCity/RhythmState';
import { CameraRig } from '../cyberpunkCity/CameraRig';
import { Character } from '../cyberpunkCity/Character';
import { generateRoute } from '../cyberpunkCity/world/routeGenerator';
import { getMajorEventEnvelope } from '../cyberpunkCity/world/musicEventDirector';
import { rhythmState } from '../cyberpunkCity/world/rhythmState';
import { ProceduralSky } from '../shared/ProceduralSky';
import { OutlinedInstances } from '../shared/OutlinedInstances';
import { collectObstacles } from '../shared/cameraObstacles';
import { makeToon, makeOutline } from '../shared/toon';
import { WorldPath } from './WorldPath';
import { WorldParticles } from './WorldParticles';
import type { WorldDefinition } from './types';
import type { AudioFeatureFrame } from '../../audio/types';
import { useAudioStore } from '../../state/audioStore';

/**
 * Renders any world definition: procedural sky, the traversable path, the
 * world's instanced cel-shaded prop groups, ambient particles, and the
 * shared camera/character/music systems — all imported unchanged.
 *
 * Adding an environment means writing a generator, not renderer code.
 */
export function WorldScene({
  featureFrame,
  def,
}: {
  featureFrame: AudioFeatureFrame;
  def: WorldDefinition;
}) {
  const route = useMemo(() => generateRoute(def.seed), [def.seed]);
  const built = useMemo(() => def.build(route, def.seed), [def, route]);
  const trackGeneration = useAudioStore((s) => s.trackGeneration);

  const outline = useMemo(
    () => makeOutline(def.outline.width, def.outline.color),
    [def.outline]
  );

  const materials = useMemo(() => {
    const map: Record<string, THREE.ShaderMaterial> = {};
    for (const g of built.groups) map[g.key] = makeToon(g.toon, def.fog);
    return map;
  }, [built, def.fog]);

  useEffect(
    () => () => {
      outline.dispose();
      Object.values(materials).forEach((m) => m.dispose());
    },
    [outline, materials]
  );

  // Music-reactive emissive per prop group — lantern glow, neon, fire.
  //
  // Phase 6 Stage 7 readability pass: the per-group `event` weights in the
  // world data run as high as ~2.6, and `col += uColor * uEmissive` is a
  // straight additive term — an emissive of 2.6 pushes a prop to ~3.6x its
  // own colour and clips to white during a drop. The event contribution is
  // now clamped (so a "prop ignites" moment still clearly reads, up to
  // ~1.1 additive, but can't nuke the value structure), the summed
  // emissive is clamped too, and the major-event rim boost is halved
  // (`1 + env*1.1` -> `1 + env*0.5`): rim at 2.1x base blew every
  // silhouette edge to white, exactly the failure mode art-direction
  // point 4 warns about. Nothing here is removed — only bounded.
  useFrame(() => {
    const env = getMajorEventEnvelope();
    for (const g of built.groups) {
      if (!g.reactive) continue;
      const m = materials[g.key];
      if (!m) continue;
      const base = (m.userData.baseEmissive as number) ?? 0;
      const eventEmissive = Math.min((g.reactive.event ?? 0) * env, 1.1);
      m.uniforms.uEmissive.value = Math.min(
        base +
          (g.reactive.mood ?? 0) * featureFrame.sectionMood +
          (g.reactive.drums ?? 0) * rhythmState.drumPresence +
          eventEmissive,
        1.7
      );
      m.uniforms.uRimStrength.value = ((m.userData.baseRim as number) ?? 0.5) * (1 + env * 0.5);
    }
  });

  const world = useMemo(
    () => ({
      landmarkPositions: built.landmarkPositions,
      // Stage 7: coarse bounding spheres of this world's big solid props,
      // for CameraRig's cinematic-camera clearance pass. Undefined for
      // worlds that declare no obstacleKeys.
      cameraObstacles: def.obstacleKeys ? collectObstacles(built.groups, def.obstacleKeys) : undefined,
    }),
    [built, def.obstacleKeys]
  );

  return (
    <>
      <fog attach="fog" args={[def.fog.color, def.fog.near, def.fog.far]} />
      <ambientLight intensity={def.ambient.intensity} color={def.ambient.color} />

      <MusicEventDirector featureFrame={featureFrame} />
      <RhythmState featureFrame={featureFrame} />

      <ProceduralSky featureFrame={featureFrame} config={def.sky} />

      {built.groups.map((g) => (
        <OutlinedInstances
          key={g.key}
          geometry={g.geometry}
          material={materials[g.key]}
          outline={outline}
          matrices={g.matrices}
          animated={g.animated}
        />
      ))}

      <WorldPath
        featureFrame={featureFrame}
        route={route}
        config={def.path}
        fog={def.fog}
        outlineCfg={def.outline}
      />

      {def.particles && <WorldParticles featureFrame={featureFrame} config={def.particles} />}

      <CameraRig key={`camera-${trackGeneration}`} featureFrame={featureFrame} route={route} world={world} />
      <Character key={`character-${trackGeneration}`} featureFrame={featureFrame} />
    </>
  );
}
