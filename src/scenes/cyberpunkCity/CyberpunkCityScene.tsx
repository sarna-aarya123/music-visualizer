import { useMemo } from 'react';
import { MusicEventDirector } from './MusicEventDirector';
import { CameraRig } from './CameraRig';
import { CityAtmosphere } from './CityAtmosphere';
import { BackgroundSkyline } from './BackgroundSkyline';
import { Ground } from './Ground';
import { Buildings } from './Buildings';
import { Landmarks } from './Landmarks';
import { StreetProps } from './StreetProps';
import { Particles } from './Particles';
import { generateRoute } from './world/routeGenerator';
import { generateWorld } from './world/worldGenerator';
import { WORLD_SEED } from './layout';
import type { AudioFeatureFrame } from '../../audio/types';

/**
 * Anime-inspired futuristic game-level city — a closed-loop route the
 * camera rides, with the world (buildings, landmarks, ground, props) built
 * around it. Route and world are generated once, deterministically from
 * WORLD_SEED, and threaded down to every component that needs them.
 */
export function CyberpunkCityScene({ featureFrame }: { featureFrame: AudioFeatureFrame }) {
  const route = useMemo(() => generateRoute(WORLD_SEED), []);
  const world = useMemo(() => generateWorld(route, WORLD_SEED), [route]);

  return (
    <>
      <MusicEventDirector featureFrame={featureFrame} />
      <CameraRig featureFrame={featureFrame} route={route} world={world} />
      <CityAtmosphere featureFrame={featureFrame} route={route} world={world} />
      <BackgroundSkyline featureFrame={featureFrame} route={route} world={world} />
      <Ground featureFrame={featureFrame} route={route} world={world} />
      <Buildings featureFrame={featureFrame} route={route} world={world} />
      <Landmarks featureFrame={featureFrame} route={route} world={world} />
      <StreetProps featureFrame={featureFrame} route={route} world={world} />
      <Particles featureFrame={featureFrame} route={route} world={world} />
    </>
  );
}
