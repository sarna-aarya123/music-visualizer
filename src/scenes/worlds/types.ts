import * as THREE from 'three';
import type { SkyConfig } from '../shared/ProceduralSky';
import type { ToonSpec } from '../shared/toon';
import type { RouteData } from '../cyberpunkCity/world/routeGenerator';
import type { AnimatedInstances } from '../shared/OutlinedInstances';

/**
 * A world is data: a sky, a fog/light mood, a path to run along, and a set
 * of instanced prop groups placed relative to the route. `WorldScene`
 * renders any of these, so a new environment is one generator file plus a
 * registry entry — no new rendering code.
 */

export interface PropGroup {
  key: string;
  geometry: THREE.BufferGeometry;
  toon: ToonSpec;
  matrices: THREE.Matrix4[];
  /** Emissive terms that should ride the music (lantern glow, neon, fire).
   *  Left undefined for inert scenery. */
  reactive?: {
    /** Added in proportion to the slow section mood. */
    mood?: number;
    /** Added in proportion to drum presence. */
    drums?: number;
    /** Added in proportion to the major-event envelope. */
    event?: number;
  };
  /** Opt-in: a subset of this group's instances recomputed every frame
   *  instead of baked once. Omit for the plain static path — see
   *  `OutlinedInstances`'s `AnimatedInstances` doc for the per-frame
   *  contract. Phase 6 Stage 5: worlds populate this via
   *  `worldEvents.ts`'s `createSignatureEventAnimated` for their
   *  signature major-event props. */
  animated?: AnimatedInstances;
}

export interface PathConfig {
  /** Half-width of the walkable ribbon, clamped by the corridor radius. */
  halfWidth: number;
  /** Base surface colours. */
  colorA: string;
  colorB: string;
  /** Glow colour used for the beat/landing impact ripple. */
  glow: string;
  /** 0 planks · 1 smooth (road/sand/seabed) · 2 glowing grid (void/neon) */
  style: 0 | 1 | 2;
  /** Adds railing posts along both edges. */
  railings?: boolean;
  railToon?: ToonSpec;
}

export interface ParticleConfig {
  color: string;
  count: number;
  size: number;
  /** 0 falling (petals/snow) · 1 rising (embers/bubbles) · 2 drifting motes */
  motion: 0 | 1 | 2;
  spread: number;
  height: number;
  opacity: number;
}

export interface BuiltWorld {
  groups: PropGroup[];
  landmarkPositions: THREE.Vector3[];
}

export interface WorldDefinition {
  id: string;
  name: string;
  seed: number;
  sky: SkyConfig;
  fog: { color: string; near: number; far: number };
  ambient: { color: string; intensity: number };
  path: PathConfig;
  particles?: ParticleConfig;
  outline: { width: number; color: string };
  build: (route: RouteData<string>, seed: number) => BuiltWorld;
}
