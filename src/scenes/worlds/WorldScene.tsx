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
  useFrame(() => {
    const env = getMajorEventEnvelope();
    for (const g of built.groups) {
      if (!g.reactive) continue;
      const m = materials[g.key];
      if (!m) continue;
      const base = (m.userData.baseEmissive as number) ?? 0;
      m.uniforms.uEmissive.value =
        base +
        (g.reactive.mood ?? 0) * featureFrame.sectionMood +
        (g.reactive.drums ?? 0) * rhythmState.drumPresence +
        (g.reactive.event ?? 0) * env;
      m.uniforms.uRimStrength.value = ((m.userData.baseRim as number) ?? 0.5) * (1 + env * 1.1);
    }
  });

  const world = useMemo(
    () => ({ landmarkPositions: built.landmarkPositions }),
    [built]
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
