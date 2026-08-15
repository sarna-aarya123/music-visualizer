import { CameraRig } from './CameraRig';
import { CityAtmosphere } from './CityAtmosphere';
import { BackgroundSkyline } from './BackgroundSkyline';
import { Ground } from './Ground';
import { Buildings } from './Buildings';
import { StreetProps } from './StreetProps';
import { Particles } from './Particles';
import type { SceneProps } from '../types';

/**
 * Anime-inspired futuristic city at night — the first (and for now only)
 * scene. Purely procedural: no external models/textures.
 *
 * Layered back-to-front for depth: BackgroundSkyline (distant, hazy)
 * → Buildings (the detailed midground corridor) → StreetProps (foreground,
 * close to the camera path) → Particles (span all three layers).
 */
export function CyberpunkCityScene({ featureFrame }: SceneProps) {
  return (
    <>
      <CameraRig featureFrame={featureFrame} />
      <CityAtmosphere featureFrame={featureFrame} />
      <BackgroundSkyline featureFrame={featureFrame} />
      <Ground featureFrame={featureFrame} />
      <Buildings featureFrame={featureFrame} />
      <StreetProps featureFrame={featureFrame} />
      <Particles featureFrame={featureFrame} />
    </>
  );
}
