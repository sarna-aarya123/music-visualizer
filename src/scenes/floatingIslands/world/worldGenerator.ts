import * as THREE from 'three';
import { createRng, type Rng } from '../../cyberpunkCity/world/seededRandom';
import type { CameraObstacle, WorldBase } from '../../shared/environment';
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
  // Stage 8: sits clearly beyond the corridor and well BELOW the walkway,
  // so the player runs over/past islands, never into them or their trees.
  // Was `corridorRadius + radius*0.75 + 2` / `3 + rng()*7` — the top rim
  // poked ~3 units *inside* the corridor and rim-clustered sakura could
  // clip the runner. Now the rim clears the corridor edge by ~5 units and
  // the island drops 6-14 below the deck.
  const lateral = corridorRadius + radius * 0.95 + 5;
  const drop = 6 + rng() * 8;
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

  // Sakura clustered toward the island's centre (Stage 8: was 0.25-0.85 of
  // the radius, which put rim trees right at the route edge; 0.12-0.6 now
  // keeps them over the island, not over the walkway).
  const treeCount = 2 + Math.floor(rng() * 5);
  for (let i = 0; i < treeCount; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * (0.12 + rng() * 0.48);
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

  // Stage 7: coarse bounding spheres of the near islands' rock masses (and
  // the pagodas standing on them) for CameraRig's cinematic-camera
  // clearance pass — so a moving shot doesn't fly straight through an
  // island or pagoda. Distant silhouette islands are omitted (far enough
  // out that the camera never reaches them). Not collision — the walkway/
  // corridor still governs the character exactly as before.
  const cameraObstacles: CameraObstacle[] = [];
  for (const isl of islands) {
    if (!isl.isNear) continue;
    cameraObstacles.push({
      position: new THREE.Vector3(isl.x, isl.y - isl.depth * 0.4, isl.z),
      radius: Math.min(isl.radius, 20),
    });
  }
  for (const p of pagodas) {
    cameraObstacles.push({ position: new THREE.Vector3(p.x, p.y + 4, p.z), radius: Math.min(4 * p.scale, 20) });
  }
  // Sakura canopies — the chase cam swinging wide on a bend runs into these
  // (they sit near the island rims, closest thing to the walkway).
  for (const t of trees) {
    cameraObstacles.push({
      position: new THREE.Vector3(t.x, t.y + t.trunkHeight + t.canopyRadius * 0.4, t.z),
      radius: Math.min(t.canopyRadius + 0.8, 12),
    });
  }

  return { islands, pagodas, trees, torii, landmarkPositions, cameraObstacles };
}
