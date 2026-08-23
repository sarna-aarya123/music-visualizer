import { useMemo } from 'react';
import { MusicEventDirector } from '../cyberpunkCity/MusicEventDirector';
import { RhythmState } from '../cyberpunkCity/RhythmState';
import { CameraRig } from '../cyberpunkCity/CameraRig';
import { Character } from '../cyberpunkCity/Character';
import { generateRoute } from '../cyberpunkCity/world/routeGenerator';
import { generateFloatingIslandsWorld } from './world/worldGenerator';
import { IslandSky, ISLAND_FOG_COLOR } from './IslandSky';
import { Islands } from './Islands';
import { Walkway } from './Walkway';
import { Petals } from './Petals';
import type { AudioFeatureFrame } from '../../audio/types';
import { useAudioStore } from '../../state/audioStore';

const SEED = 8821;

/**
 * Floating Islands as a real 3D environment — a sky you fly through, a
 * plank walkway you run along, islands with pagodas and sakura passing on
 * both sides. Built to match the reference panel's design rather than
 * displaying the reference image.
 *
 * Every shared system (camera, character, music event/rhythm state) is
 * imported unchanged; only the world content is new.
 */
export function FloatingIslandsScene({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const route = useMemo(() => generateRoute(SEED), []);
  const world = useMemo(() => generateFloatingIslandsWorld(route, SEED), [route]);
  const trackGeneration = useAudioStore((s) => s.trackGeneration);

  return (
    <>
      {/* Pushed far back (was 55) — fog starting close is what desaturated
          everything into mud. Only the distant depth layers should
          dissolve into the sky; near geometry stays crisp and colourful,
          which is essential to the animated-game look. */}
      <fog attach="fog" args={[ISLAND_FOG_COLOR, 130, 380]} />
      <ambientLight intensity={0.75} color="#ffd6ef" />

      <MusicEventDirector featureFrame={featureFrame} />
      <RhythmState featureFrame={featureFrame} />

      <IslandSky featureFrame={featureFrame} />
      <Islands featureFrame={featureFrame} world={world} />
      <Walkway featureFrame={featureFrame} route={route} />
      <Petals featureFrame={featureFrame} />

      <CameraRig key={`camera-${trackGeneration}`} featureFrame={featureFrame} route={route} world={world} />
      <Character key={`character-${trackGeneration}`} featureFrame={featureFrame} />
    </>
  );
}
