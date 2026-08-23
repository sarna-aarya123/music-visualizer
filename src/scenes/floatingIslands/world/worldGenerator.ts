import * as THREE from 'three';
import { createRng, type Rng } from '../../cyberpunkCity/world/seededRandom';
import type { WorldBase } from '../../shared/environment';
import type { RouteData } from '../../cyberpunkCity/world/routeGenerator';

/**
 * Floating Islands — a real traversable 3D world built to match the
 * reference panel's DESIGN (pink/violet sky, a huge moon, sky islands
 * capped with grass, silhouetted pagodas, sakura, a plank walkway between
 * them), rather than the reference image shown as a backdrop.
 *
 * Everything is placed relative to the route, always at or beyond the
 * corridor radius, so geometry can never intrude on the camera's path —
 * the same clearance guarantee the other environments use.
 */

export interface SkyIsland {
  x: number;
  y: number;
  z: number;
  radius: number;
  depth: number;
  rotationY: number;
  seed: number;
  /** Islands close to the route get grass caps and props; distant ones are
   *  pure silhouette mass, which is what builds the layered depth the
   *  reference has. */
  isNear: boolean;
}

export interface Pagoda {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationY: number;
  tiers: number;
}

export interface SakuraTree {
  x: number;
  y: number;
  z: number;
  trunkHeight: number;
  canopyRadius: number;
  seed: number;
}

export interface Torii {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationY: number;
}

export interface FloatingIslandsWorld extends WorldBase {
  islands: SkyIsland[];
  pagodas: Pagoda[];
  trees: SakuraTree[];
  torii: Torii[];
}

const NEAR_ISLAND_SAMPLES = 46;
const FAR_ISLAND_COUNT = 90;

function buildNearIsland(
  rng: Rng,
  route: RouteData<string>,
  t: number,
  islands: SkyIsland[],
  pagodas: Pagoda[],
  trees: SakuraTree[],
  torii: Torii[]
): void {
  const frame = route.getFrameAt(t);
  const { corridorRadius } = route.getDistrictInfoAt(t);
  const side = rng() < 0.5 ? -1 : 1;
  const radius = 7 + rng() * 13;
  // Sits just beyond the corridor and slightly BELOW the walkway, so the
  // player runs over/past islands rather than into them — the reference's
  // "bridge threading between islands" read.
  const lateral = corridorRadius + radius * 0.75 + 2;
  const drop = 3 + rng() * 7;
  const pos = frame.position
    .clone()
    .addScaledVector(frame.right, side * lateral)
    .addScaledVector(frame.up, -drop);

  const island: SkyIsland = {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    radius,
    depth: radius * (1.3 + rng() * 0.9),
    rotationY: rng() * Math.PI * 2,
    seed: rng(),
    isNear: true,
  };
  islands.push(island);

  // A pagoda on the larger islands — the reference's hero silhouette.
  if (radius > 12 && rng() < 0.75) {
    pagodas.push({
      x: pos.x,
      y: pos.y + 0.4,
      z: pos.z,
      scale: 1.1 + rng() * 0.8,
      rotationY: rng() * Math.PI * 2,
      tiers: 3 + Math.floor(rng() * 2),
    });
  } else if (rng() < 0.3) {
    torii.push({
      x: pos.x,
      y: pos.y + 0.3,
      z: pos.z,
      scale: 1.6 + rng() * 1.2,
      rotationY: rng() * Math.PI * 2,
    });
  }

  // Sakura clustered around the island's rim.
  const treeCount = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < treeCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * (0.25 + rng() * 0.6);
    trees.push({
      x: pos.x + Math.cos(a) * r,
      y: pos.y + 0.3,
      z: pos.z + Math.sin(a) * r,
      trunkHeight: 2.2 + rng() * 3.4,
      canopyRadius: 1.8 + rng() * 2.6,
      seed: rng(),
    });
  }
}

export function generateFloatingIslandsWorld(
  route: RouteData<string>,
  seed: number
): FloatingIslandsWorld {
  const rng = createRng(seed ^ 0x2c1a9f31);

  const islands: SkyIsland[] = [];
  const pagodas: Pagoda[] = [];
  const trees: SakuraTree[] = [];
  const torii: Torii[] = [];

  for (let i = 0; i < NEAR_ISLAND_SAMPLES; i++) {
    const t = i / NEAR_ISLAND_SAMPLES + (rng() - 0.5) * 0.008;
    buildNearIsland(rng, route, ((t % 1) + 1) % 1, islands, pagodas, trees, torii);
  }

  // Distant silhouette islands scattered far out on both sides and well
  // below — pure depth layering, the thing that makes the reference read
  // as a vast sky rather than a thin strip of scenery.
  for (let i = 0; i < FAR_ISLAND_COUNT; i++) {
    const t = rng();
    const frame = route.getFrameAt(t);
    const side = rng() < 0.5 ? -1 : 1;
    const radius = 10 + rng() * 34;
    const lateral = 45 + rng() * 190;
    const drop = 10 + rng() * 90;
    const pos = frame.position
      .clone()
      .addScaledVector(frame.right, side * lateral)
      .addScaledVector(frame.up, -drop);
    islands.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      radius,
      depth: radius * (1.4 + rng() * 1.2),
      rotationY: rng() * Math.PI * 2,
      seed: rng(),
      isNear: false,
    });
  }

  const landmarkPositions = pagodas.map((p) => new THREE.Vector3(p.x, p.y + 8, p.z));

  return { islands, pagodas, trees, torii, landmarkPositions };
}
