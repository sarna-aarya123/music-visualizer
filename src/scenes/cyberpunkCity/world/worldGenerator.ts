import * as THREE from 'three';
import { createRng, type Rng } from './seededRandom';
import { DISTRICT_PROFILES, type District, type RouteData } from './routeGenerator';

/**
 * A light-touch "district character" layer: rather than a wholly separate
 * geometry generator per archetype (cyberpunk tower / industrial / plaza /
 * anime tower), each district biases the SAME shape-family probabilities
 * so buildings still read as belonging to a place — industrial areas lean
 * toward exposed rooftop machinery and angled factory-style wedge roofs,
 * tower districts and canyons lean toward tall elegant spires.
 */
interface DistrictFlavor {
  machineryBoost: number;
  wedgeBias: number;
}

const DISTRICT_FLAVORS: Record<District, DistrictFlavor> = {
  downtown: { machineryBoost: 1, wedgeBias: 0 },
  boulevard: { machineryBoost: 0.7, wedgeBias: 0 },
  towerDistrict: { machineryBoost: 0.8, wedgeBias: -0.15 },
  plaza: { machineryBoost: 0.5, wedgeBias: 0.1 },
  industrial: { machineryBoost: 2.2, wedgeBias: 0.25 },
  bridge: { machineryBoost: 0.6, wedgeBias: 0 },
  tunnel: { machineryBoost: 1.4, wedgeBias: 0.1 },
  canyon: { machineryBoost: 0.6, wedgeBias: -0.2 },
};

/**
 * District color identity (see Buildings.tsx's fragment shader): 0 = the
 * default cool downtown palette, 0.5 = a warm industrial rust/orange
 * palette, 1 = a vivid canyon/plaza magenta palette. Three families,
 * deliberately not one per district — the point is a handful of
 * recognizable moods, not a rainbow.
 */
const DISTRICT_HUES: Record<District, number> = {
  downtown: 0,
  boulevard: 0,
  towerDistrict: 0,
  bridge: 0,
  tunnel: 0,
  industrial: 0.5,
  plaza: 1,
  canyon: 1,
};

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
  /** Radians, only ever set on angled-roof wedge slabs — everything else
   *  stays axis-aligned in X/Z, which is what keeps the corridor-clearance
   *  guarantee simple (a tilted building body would need per-segment
   *  bounding-box math; a tilted roof slab sitting near the building's own
   *  footprint doesn't). */
  tiltX?: number;
  tiltZ?: number;
  sx: number;
  sy: number;
  sz: number;
  seed: number;
  /** 0/0.5/1 district color family — see DISTRICT_HUES. */
  hueShift?: number;
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

/** A glowing ring landmark, standing upright beside/over the corridor —
 *  genuinely different geometry (a torus) from every box-based shape
 *  elsewhere, deliberately reserved for a handful of moments. */
export interface ReactorRing {
  x: number;
  y: number;
  z: number;
  radius: number;
  tube: number;
  rotationY: number;
}

/** A colossal freestanding spire, towering far above normal building
 *  height — a landmark meant to be recognizable from a distance, not
 *  another roof cap. */
export interface GiantSpire {
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
  reactorRings: ReactorRing[];
  giantSpires: GiantSpire[];
}

const ANTENNA_COLORS = ['#ff5577', '#ffe08a', '#8fd8ff'];
const SIGN_COLORS = ['#ffb35c', '#7ef2ff', '#ff6fa0', '#ffe08a'];

// Scales with the route's circumference (routeGenerator's BASE_RADIUS) so
// building density along the corridor stays consistent as the world grows.
const SAMPLE_COUNT = 205;
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
  seed: number,
  hueShift = 0
): void {
  segments.push({ x: cx, y: cy, z: cz, rotationY, sx: w, sy: h, sz: d, seed, hueShift });
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
  segments: Segment[],
  hueShift = 0
): BuiltBuilding {
  const seed = rng();
  const isLowRise = rng() < 0.22;
  const [minH, maxH] = heightRange;

  const width = isLowRise ? 4.5 + rng() * 4 : 2.2 + rng() * 3.2;
  const depth = isLowRise ? 4 + rng() * 3.5 : 2.0 + rng() * 2.8;
  const height = isLowRise ? Math.min(maxH, 2.5 + rng() * 3) : minH + rng() * (maxH - minH);

  // A foundation plinth, wider than the building itself, so it reads as
  // standing on ground rather than a box floating at an arbitrary height —
  // ties into Ground.tsx's terrain skirt at the same base elevation.
  const foundationHeight = 0.7 + rng() * 0.6;
  pushSegment(
    segments,
    base.x,
    base.y + foundationHeight / 2,
    base.z,
    rotationY,
    width + 1.4,
    depth + 1.4,
    foundationHeight,
    seed,
    hueShift
  );

  let y = base.y + foundationHeight;
  pushSegment(segments, base.x, y + height / 2, base.z, rotationY, width, depth, height, seed, hueShift);
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

    pushSegment(segments, cx, y + h / 2, cz, rotationY, w, d, h, seed, hueShift);
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
    pushSegment(
      segments,
      base.x + offsetX,
      platformY,
      base.z + offsetZ,
      rotationY,
      platformW,
      0.5,
      platformD,
      seed,
      hueShift
    );
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

/** Which of the small set of landmark archetypes fits this district best.
 *  Deliberately few options, reused deliberately — "5 amazing landmarks"
 *  beats fifty near-identical ones. */
function pickLandmarkKind(rng: Rng, district: District): 'gateway' | 'reactorRing' | 'giantSpire' {
  if (district === 'industrial') return rng() < 0.7 ? 'reactorRing' : 'gateway';
  if (district === 'towerDistrict' || district === 'canyon') return rng() < 0.7 ? 'giantSpire' : 'gateway';
  return 'gateway';
}

export function generateWorld(route: RouteData, seed: number): WorldLayout {
  const rng = createRng(seed ^ 0x9e3779b9);

  const segments: Segment[] = [];
  const antennas: Antenna[] = [];
  const machinery: Machinery[] = [];
  const signs: Sign[] = [];
  const roofCaps: RoofCap[] = [];
  const reactorRings: ReactorRing[] = [];
  const giantSpires: GiantSpire[] = [];

  route.anchors.forEach((anchor, index) => {
    if (!anchor.isLandmark) return;
    const frame = route.getFrameAt(index / route.anchors.length);
    const kind = pickLandmarkKind(rng, anchor.district);

    if (kind === 'reactorRing') {
      const radius = 12 + rng() * 6;
      reactorRings.push({
        x: frame.position.x,
        y: frame.position.y + radius + 8,
        z: frame.position.z,
        radius,
        tube: 1.3 + rng() * 0.7,
        rotationY: Math.atan2(-frame.tangent.z, frame.tangent.x),
      });
    } else if (kind === 'giantSpire') {
      const side = rng() < 0.5 ? -1 : 1;
      const radius = 6 + rng() * 4;
      const height = 55 + rng() * 45;
      const offset = anchor.corridorRadius + radius + 5;
      const pos = frame.position.clone().addScaledVector(frame.right, side * offset);
      giantSpires.push({ x: pos.x, y: pos.y, z: pos.z, radius, height, rotationY: rng() * Math.PI });
    } else {
      buildGateway(rng, frame.position, frame.right, anchor.corridorRadius, segments);
    }
  });

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = i / SAMPLE_COUNT;
    const frame = route.getFrameAt(t);
    const { district, corridorRadius } = route.getDistrictInfoAt(t);
    const profile = DISTRICT_PROFILES[district];
    const flavor = DISTRICT_FLAVORS[district];
    const hueShift = DISTRICT_HUES[district];

    for (const side of [-1, 1] as const) {
      if (rng() >= profile.buildingDensity) continue;

      const lateral = corridorRadius + CLEARANCE_MARGIN + rng() * 9;
      const base = frame.position.clone().addScaledVector(frame.right, side * lateral);
      const rotationY = Math.atan2(-frame.right.z, frame.right.x) + (rng() - 0.5) * 0.3;

      const built = buildBuilding(rng, base, rotationY, profile.heightRange, segments, hueShift);

      if (built.topCy - base.y > 9 && rng() < 0.42) {
        const roofRoll = rng();
        const spireThreshold = 0.38 - flavor.wedgeBias;
        const pyramidThreshold = 0.62 - flavor.wedgeBias * 0.6;
        if (roofRoll < spireThreshold) {
          // Spire/cone — the existing tapered-tower cap.
          roofCaps.push({
            x: built.topCx,
            y: built.topCy,
            z: built.topCz,
            radius: Math.max(built.topWidth, built.topDepth) * 0.55,
            height: 3 + rng() * 5.5,
            rotationY: rotationY + rng() * Math.PI,
          });
        } else if (roofRoll < pyramidThreshold) {
          // Small pyramidal cap — the wider, shorter variant.
          roofCaps.push({
            x: built.topCx,
            y: built.topCy,
            z: built.topCz,
            radius: Math.max(built.topWidth, built.topDepth) * 0.72,
            height: 1.1 + rng() * 1.6,
            rotationY: rotationY + rng() * Math.PI,
          });
        } else {
          // Giant angled wedge roof — a big, deliberately tilted overhanging
          // slab. This is the shape-language element that reads as
          // "designed" rather than "box with a hat": an asymmetric,
          // oversized roof plane rather than another radially-symmetric cap.
          const wedgeW = built.topWidth * (1.5 + rng() * 0.7);
          const wedgeD = built.topDepth * (1.3 + rng() * 0.6);
          const tilt = (rng() < 0.5 ? -1 : 1) * (0.22 + rng() * 0.28);
          segments.push({
            x: built.topCx,
            y: built.topCy + 0.4,
            z: built.topCz,
            rotationY,
            tiltX: tilt,
            sx: wedgeW,
            sy: 0.6,
            sz: wedgeD,
            seed: rng(),
            hueShift,
          });
        }
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

      if (rng() < 0.35 * flavor.machineryBoost) {
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

  return { segments, antennas, machinery, signs, roofCaps, reactorRings, giantSpires };
}
