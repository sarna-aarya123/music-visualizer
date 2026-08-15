import { CameraRig } from './CameraRig';
import { CityAtmosphere } from './CityAtmosphere';
import { Ground } from './Ground';
import { Buildings } from './Buildings';
import { Particles } from './Particles';
import type { SceneProps } from '../types';

/**
 * Anime-inspired futuristic city at night — the first (and for now only)
 * scene. Purely procedural: no external models/textures.
 */
export function CyberpunkCityScene({ featureFrame }: SceneProps) {
  return (
    <>
      <CameraRig featureFrame={featureFrame} />
      <CityAtmosphere featureFrame={featureFrame} />
      <Ground featureFrame={featureFrame} />
      <Buildings featureFrame={featureFrame} />
      <Particles featureFrame={featureFrame} />
    </>
  );
}
