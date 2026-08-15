import * as THREE from 'three';
import { createRng, type Rng } from './seededRandom';
import { DISTRICT_PROFILES, type RouteData } from './routeGenerator';

/**
 * Walks the route and places every piece of world geometry *relative to
 * it* — always starting at or beyond that sample's corridor radius. This
 * is the "build the world around the route" guarantee: geometry is never
 * placed independently and then hoped to avoid the camera's path.
 */

export interface Segment {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  sx: number;
  sy: number;
  sz: number;
  seed: number;
}

export interface Antenna {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  color: THREE.Color;
}

export interface Machinery {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  sx: number;
  sy: number;
  sz: number;
}

export interface Sign {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  width: number;
  height: number;
  color: THREE.Color;
}

export interface RoofCap {
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
  rotationY: number;
}

export interface WorldLayout {
  segments: Segment[];
  antennas: Antenna[];
  machinery: Machinery[];
  signs: Sign[];
  roofCaps: RoofCap[];
}

const ANTENNA_COLORS = ['#ff5577', '#ffe08a', '#8fd8ff'];
const SIGN_COLORS = ['#ffb35c', '#7ef2ff', '#ff6fa0', '#ffe08a'];

const SAMPLE_COUNT = 150;
const CLEARANCE_MARGIN = 2.2;

function pushSegment(
  segments: Segment[],
  cx: number,
  cy: number,
  cz: number,
  rotationY: number,
  w: number,
  d: number,
  h: number,
  seed: number
): void {
  segments.push({ x: cx, y: cy, z: cz, rotationY, sx: w, sy: h, sz: d, seed });
}

interface BuiltBuilding {
  topWidth: number;
  topDepth: number;
  topCx: number;
  topCy: number;
  topCz: number;
}

/** Builds one multi-segment building (setback tower, or a low wide variant)
 *  standing on `base`, growing straight up in world Y. `right`/`forward`
 *  give it a facing so it isn't purely axis-aligned to world space. */
function buildBuilding(
  rng: Rng,
  base: THREE.Vector3,
  rotationY: number,
  heightRange: [number, number],
  segments: Segment[]
): BuiltBuilding {
  const seed = rng();
  const isLowRise = rng() < 0.22;
  const [minH, maxH] = heightRange;

  const width = isLowRise ? 4.5 + rng() * 4 : 2.2 + rng() * 3.2;
  const depth = isLowRise ? 4 + rng() * 3.5 : 2.0 + rng() * 2.8;
  const height = isLowRise ? Math.min(maxH, 2.5 + rng() * 3) : minH + rng() * (maxH - minH);

  let y = base.y;
  pushSegment(segments, base.x, y + height / 2, base.z, rotationY, width, depth, height, seed);
  y += height;

  let cx = base.x;
  let cz = base.z;
  let prevW = width;
  let prevD = depth;
  let segCount = 1;
  const maxSegments = isLowRise ? 2 : 4;

  while (
    segCount < maxSegments &&
    rng() < (isLowRise ? 0.3 : segCount === 1 ? 0.8 : segCount === 2 ? 0.48 : 0.25)
  ) {
    const shrink = 0.42 + rng() * 0.32;
    const w = Math.max(0.9, prevW * shrink);
    const d = Math.max(0.9, prevD * shrink);
    const h = segCount === 1 ? 3 + rng() * 7 : 2 + rng() * 3.5;

    const maxOffX = Math.max(0, (prevW - w) / 2);
    const maxOffZ = Math.max(0, (prevD - d) / 2);
    cx = base.x + (rng() - 0.5) * 2 * maxOffX;
    cz = base.z + (rng() - 0.5) * 2 * maxOffZ;

    pushSegment(segments, cx, y + h / 2, cz, rotationY, w, d, h, seed);
    y += h;
    prevW = w;
    prevD = d;
    segCount++;
  }

  if (!isLowRise && height > 8 && rng() < 0.16) {
    const platformW = prevW * (2.2 + rng() * 1.4);
    const platformD = prevD * (1.3 + rng() * 0.6);
    const platformY = base.y + height * (0.35 + rng() * 0.35);
    const side = rng() < 0.5 ? -1 : 1;
    const offsetLocalX = side * (platformW / 2 - prevW / 2);
    // Offset along the building's own local rotated X axis so it still
    // cantilevers sensibly even when the building itself is yawed.
    const offsetX = Math.cos(rotationY) * offsetLocalX;
    const offsetZ = -Math.sin(rotationY) * offsetLocalX;
    pushSegment(segments, base.x + offsetX, platformY, base.z + offsetZ, rotationY, platformW, 0.5, platformD, seed);
  }

  return { topWidth: prevW, topDepth: prevD, topCx: cx, topCy: y, topCz: cz };
}

/** A gate-style landmark spanning the corridor at a district transition —
 *  two pillars outside the corridor plus a beam well above camera height,
 *  so clearance is guaranteed by construction. */
function buildGateway(
  rng: Rng,
  position: THREE.Vector3,
  right: THREE.Vector3,
  corridorRadius: number,
  segments: Segment[]
): void {
  const legOffset = corridorRadius + 1.6;
  const pillarHeight = 15 + rng() * 9;
  const pillarThickness = 1.6 + rng() * 0.8;
  const beamThickness = 1.4 + rng() * 0.6;
  const seed = rng();

  // Yaw that aligns a box's local X axis with the route's `right` vector,
  // so the beam spans across the corridor rather than along it.
  const rotationY = Math.atan2(-right.z, right.x);

  const leftPillar = position.clone().addScaledVector(right, -legOffset);
  const rightPillar = position.clone().addScaledVector(right, legOffset);

  pushSegment(
    segments,
    leftPillar.x,
    position.y + pillarHeight / 2,
    leftPillar.z,
    rotationY,
    pillarThickness,
    pillarThickness,
    pillarHeight,
    seed
  );
  pushSegment(
    segments,
    rightPillar.x,
    position.y + pillarHeight / 2,
    rightPillar.z,
    rotationY,
    pillarThickness,
    pillarThickness,
    pillarHeight,
    seed
  );
  pushSegment(
    segments,
    position.x,
    position.y + pillarHeight + beamThickness / 2,
    position.z,
    rotationY,
    legOffset * 2 + pillarThickness,
    beamThickness,
    beamThickness * 1.6,
    seed
  );
}

export function generateWorld(route: RouteData, seed: number): WorldLayout {
  const rng = createRng(seed ^ 0x9e3779b9);

  const segments: Segment[] = [];
  const antennas: Antenna[] = [];
  const machinery: Machinery[] = [];
  const signs: Sign[] = [];
  const roofCaps: RoofCap[] = [];

  route.anchors.forEach((anchor, index) => {
    if (!anchor.isLandmark) return;
    const frame = route.getFrameAt(index / route.anchors.length);
    buildGateway(rng, frame.position, frame.right, anchor.corridorRadius, segments);
  });

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    const frame = route.getFrameAt(t);
    const { district, corridorRadius } = route.getDistrictInfoAt(t);
    const profile = DISTRICT_PROFILES[district];

    for (const side of [-1, 1] as const) {
      if (rng() >= profile.buildingDensity) continue;

      const lateral = corridorRadius + CLEARANCE_MARGIN + rng() * 9;
      const base = frame.position.clone().addScaledVector(frame.right, side * lateral);
      const rotationY = Math.atan2(-frame.right.z, frame.right.x) + (rng() - 0.5) * 0.3;

      const built = buildBuilding(rng, base, rotationY, profile.heightRange, segments);

      if (built.topCy - base.y > 9 && rng() < 0.42) {
        const isSpire = rng() < 0.55;
        roofCaps.push({
          x: built.topCx,
          y: built.topCy,
          z: built.topCz,
          radius: Math.max(built.topWidth, built.topDepth) * (isSpire ? 0.55 : 0.72),
          height: isSpire ? 3 + rng() * 5.5 : 1.1 + rng() * 1.6,
          rotationY: rotationY + rng() * Math.PI,
        });
      }

      if (rng() < 0.3) {
        antennas.push({
          x: built.topCx,
          y: built.topCy,
          z: built.topCz,
          height: 1.5 + rng() * 3,
          radius: 1,
          color: new THREE.Color(ANTENNA_COLORS[Math.floor(rng() * ANTENNA_COLORS.length)]),
        });
      }

      if (rng() < 0.35) {
        machinery.push({
          x: built.topCx + (rng() - 0.5) * built.topWidth * 0.4,
          y: built.topCy + 0.3,
          z: built.topCz + (rng() - 0.5) * built.topDepth * 0.4,
          rotationY: rng() * Math.PI,
          sx: 0.5 + rng() * 0.6,
          sy: 0.5 + rng() * 0.7,
          sz: 0.5 + rng() * 0.6,
        });
      }

      if (rng() < 0.18 && built.topCy - base.y > 8) {
        const signY = base.y + (built.topCy - base.y) * (0.35 + rng() * 0.3);
        const outward = base.clone().addScaledVector(frame.right, side * 0.1);
        signs.push({
          x: outward.x,
          y: signY,
          z: outward.z,
          rotationY,
          width: 1.2 + rng() * 1.6,
          height: 0.5 + rng() * 0.7,
          color: new THREE.Color(SIGN_COLORS[Math.floor(rng() * SIGN_COLORS.length)]),
        });
      }
    }
  }

  return { segments, antennas, machinery, signs, roofCaps };
}
