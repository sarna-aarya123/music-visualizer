import * as THREE from 'three';
import type { ComponentType } from 'react';
import type { AudioFeatureFrame } from '../../audio/types';

/**
 * The minimal contract every environment's generated world must satisfy so
 * genuinely environment-agnostic systems (CameraRig's cinematic-shot
 * landmark lookup, today; potentially others later) can work across any
 * environment without knowing its specific geometry types. Deliberately
 * tiny — everything else about a world (buildings vs. mushrooms vs.
 * whatever) stays entirely up to the environment itself. A real
 * environment's own world-layout interface (e.g. cyberpunkCity's
 * `WorldLayout`) extends this structurally; no explicit `implements`
 * needed since TypeScript checks it by shape.
 */
export interface CameraObstacle {
  /** World-space centre of the mass. */
  position: THREE.Vector3;
  /** Coarse bounding-sphere radius (already clamped by the builder). */
  radius: number;
}

export interface WorldBase {
  /** Every landmark's position, flattened into one list regardless of what
   *  kind of landmark it is — this is ALL the shared camera/cinematic
   *  system needs to know ("is there something worth framing nearby"). */
  landmarkPositions: THREE.Vector3[];
  /** Phase 6 Stage 7: coarse bounding spheres of the world's big solid
   *  props, for the cinematic camera's environment-clearance pass (see
   *  `CameraRig`). Optional — a world that omits it contributes no camera
   *  correction. NOT collision and NOT corridor-clearance: purely a
   *  camera-only "don't sail a moving shot through that building" hint,
   *  built from already-computed instance matrices (see
   *  `shared/cameraObstacles.ts`). */
  cameraObstacles?: CameraObstacle[];
}

/**
 * Route/world scale shared across every environment — NOT because the
 * curve-building code itself is shared (each environment currently writes
 * its own `generateRoute`, deliberately duplicated rather than forced
 * through a generic to keep cyberpunk's existing deterministic seed
 * behavior completely unrisked — see the Fantasy Forest investigation
 * notes), but because Phase 5's speed/camera/character tuning (cruise
 * speed range, FOV/follow-distance anchoring, movement-state thresholds)
 * was all calibrated against ONE specific route length. A new environment
 * built at a wildly different scale would silently need its own Phase-5-
 * equivalent retuning; reusing these exact numbers means it doesn't.
 */
export const ROUTE_ANCHOR_COUNT = 30;
export const ROUTE_BASE_RADIUS = 260;
export const ROUTE_RADIUS_JITTER = 0.24;
export const ROUTE_ANGLE_JITTER = 0.09;
export const ROUTE_MAX_HEIGHT_DELTA_PER_ANCHOR = 13;

/**
 * One registered environment: a self-contained route generator, world
 * generator, and top-level scene component (which mounts its own render
 * components alongside the shared CameraRig/Character/MusicEventDirector/
 * RhythmState — see cyberpunkCity/CyberpunkCityScene.tsx for the pattern
 * every environment's own SceneComponent follows). `id`/`name` are for a
 * future environment picker; nothing reads them yet beyond identification.
 */
export interface EnvironmentDefinition {
  id: string;
  name: string;
  SceneComponent: ComponentType<{ featureFrame: AudioFeatureFrame }>;
}
