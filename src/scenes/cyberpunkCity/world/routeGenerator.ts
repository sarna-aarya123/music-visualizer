import * as THREE from 'three';
import { createRng, rngRange, type Rng } from './seededRandom';

/**
 * Builds a closed-loop route (a circuit, like a race track) that the
 * camera rides — see CameraRig.tsx — and that the world is built around —
 * see worldGenerator.ts. Nothing else in the scene decides where the
 * camera can go; this is the single source of truth for that.
 */

export type District =
  | 'downtown'
  | 'boulevard'
  | 'towerDistrict'
  | 'plaza'
  | 'industrial'
  | 'bridge'
  | 'tunnel'
  | 'canyon';

export interface DistrictProfile {
  corridorRadius: number;
  heightBias: number;
  buildingDensity: number;
  heightRange: [number, number];
}

export const DISTRICT_PROFILES: Record<District, DistrictProfile> = {
  downtown: { corridorRadius: 7, heightBias: 2, buildingDensity: 0.85, heightRange: [8, 24] },
  boulevard: { corridorRadius: 15, heightBias: 0, buildingDensity: 0.45, heightRange: [5, 13] },
  towerDistrict: { corridorRadius: 9, heightBias: 5, buildingDensity: 0.7, heightRange: [16, 38] },
  plaza: { corridorRadius: 26, heightBias: -2, buildingDensity: 0.22, heightRange: [4, 10] },
  industrial: { corridorRadius: 10, heightBias: -3, buildingDensity: 0.55, heightRange: [4, 12] },
  bridge: { corridorRadius: 8, heightBias: 17, buildingDensity: 0.15, heightRange: [3, 8] },
  // A very tight, very tall, very dense corridor — no literal tunnel tube,
  // but close/tall/dense-enough geometry pressing in on both sides reads
  // as a compressed, enclosed passage as the camera rushes through it.
  tunnel: { corridorRadius: 4.5, heightBias: 6, buildingDensity: 0.95, heightRange: [14, 26] },
  // Narrow but sparse and very tall — dramatic, canyon-like verticality
  // rather than a dense street.
  canyon: { corridorRadius: 6, heightBias: 10, buildingDensity: 0.35, heightRange: [22, 42] },
};

const ALL_DISTRICTS: District[] = [
  'downtown',
  'boulevard',
  'towerDistrict',
  'plaza',
  'industrial',
  'bridge',
  'tunnel',
  'canyon',
];

const ANCHOR_COUNT = 30;
const BASE_RADIUS = 260;
const RADIUS_JITTER = 0.24;
const ANGLE_JITTER = 0.09;
// Route slope is capped so the tangent never approaches vertical — this is
// what makes camera-orientation flips structurally impossible rather than
// just unlikely (see CameraRig.tsx). Raised from 9 for more dramatic
// rises/falls (ramp-like sections) — still comfortably short of vertical
// given the anchor spacing.
const MAX_HEIGHT_DELTA_PER_ANCHOR = 13;

export interface Anchor {
  position: THREE.Vector3;
  district: District;
  corridorRadius: number;
  isLandmark: boolean;
}

export interface RouteFrame {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export interface DistrictInfo {
  district: District;
  corridorRadius: number;
}

// Generic over the region/district string type (defaults to cyberpunk's own
// District union) purely so genuinely shared consumers — CameraRig.tsx,
// cinematicDirector.ts — can accept a route from ANY environment via the
// widened `RouteData<string>` without needing to know about cyberpunk's
// specific district names. R only ever appears in output positions here
// (the district field/return value), so `RouteData<District>` (what
// generateRoute below actually returns, unchanged) is safely assignable to
// `RouteData<string>` — a type-only change, no runtime behavior differs.
export interface RouteData<R extends string = District> {
  curve: THREE.CatmullRomCurve3;
  length: number;
  // Typed via R (not the concrete `Anchor` interface) for the same reason
  // as getDistrictInfoAt below — so RouteData<District> (cyberpunk, via
  // generateRoute) stays structurally assignable to RouteData<string>.
  anchors: { position: THREE.Vector3; district: R; corridorRadius: number; isLandmark: boolean }[];
  getFrameAt(t: number): RouteFrame;
  getDistrictInfoAt(t: number): { district: R; corridorRadius: number };
}

function buildDistrictSequence(rng: Rng, count: number): District[] {
  // Shuffle once, then repeat — guarantees every district type appears at
  // least once per lap rather than leaving variety to chance.
  const shuffled = [...ALL_DISTRICTS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sequence: District[] = [];
  let cursor = 0;
  while (sequence.length < count) {
    const district = shuffled[cursor % shuffled.length];
    const groupSize = Math.min(count - sequence.length, 3 + Math.floor(rng() * 2));
    for (let i = 0; i < groupSize; i++) sequence.push(district);
    cursor++;
  }
  return sequence;
}

const FLAT_ROUTE_HEIGHT = 6;

export interface RouteOptions {
  /** Force every anchor to the same elevation, so the whole loop is
   *  planar. Opt-in per environment (see `WorldDefinition.flatRoute`) —
   *  Desert Dream uses it because its props are placed relative to the
   *  route and an undulating route folding back near itself at a DIFFERENT
   *  elevation is what left the runner clipping props there. Every `rng`
   *  draw below still happens (only the final Y is overridden), so the
   *  horizontal layout is byte-identical to the non-flat route for the
   *  same seed. */
  flat?: boolean;
}

export function generateRoute(seed: number, opts: RouteOptions = {}): RouteData {
  const rng = createRng(seed);
  const districtSequence = buildDistrictSequence(rng, ANCHOR_COUNT);

  const anchors: Anchor[] = [];
  let prevHeight = 6;

  for (let i = 0; i < ANCHOR_COUNT; i++) {
    const district = districtSequence[i];
    const profile = DISTRICT_PROFILES[district];
    const isGroupStart = i === 0 || districtSequence[i - 1] !== district;

    const angleStep = (Math.PI * 2) / ANCHOR_COUNT;
    const angle = i * angleStep + rngRange(rng, -ANGLE_JITTER, ANGLE_JITTER) * angleStep;
    const radius = BASE_RADIUS * (1 + rngRange(rng, -RADIUS_JITTER, RADIUS_JITTER));

    const desiredHeight = THREE.MathUtils.clamp(6 + profile.heightBias + rngRange(rng, -2, 2), 2, 30);
    const height = opts.flat
      ? FLAT_ROUTE_HEIGHT
      : THREE.MathUtils.clamp(
          desiredHeight,
          prevHeight - MAX_HEIGHT_DELTA_PER_ANCHOR,
          prevHeight + MAX_HEIGHT_DELTA_PER_ANCHOR
        );
    prevHeight = height;

    anchors.push({
      position: new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
      district,
      corridorRadius: profile.corridorRadius * (0.85 + rng() * 0.3),
      isLandmark: isGroupStart,
    });
  }

  const curve = new THREE.CatmullRomCurve3(
    anchors.map((a) => a.position),
    true,
    'catmullrom',
    0.4
  );
  const length = curve.getLength();

  const worldUp = new THREE.Vector3(0, 1, 0);

  function getFrameAt(t: number): RouteFrame {
    const u = ((t % 1) + 1) % 1;
    const position = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u).normalize();

    let right = new THREE.Vector3().crossVectors(worldUp, tangent);
    if (right.lengthSq() < 1e-6) {
      // Only possible if the tangent is exactly vertical, which the
      // MAX_HEIGHT_DELTA_PER_ANCHOR clamp above should already prevent —
      // this is just a safety fallback, not the primary guarantee.
      right = new THREE.Vector3(1, 0, 0);
    }
    right.normalize();
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();

    return { position, tangent, right, up };
  }

  function getDistrictInfoAt(t: number): DistrictInfo {
    const u = ((t % 1) + 1) % 1;
    const f = u * anchors.length;
    const i0 = Math.floor(f) % anchors.length;
    const i1 = (i0 + 1) % anchors.length;
    const frac = f - Math.floor(f);
    const corridorRadius = THREE.MathUtils.lerp(anchors[i0].corridorRadius, anchors[i1].corridorRadius, frac);
    const district = frac < 0.5 ? anchors[i0].district : anchors[i1].district;
    return { district, corridorRadius };
  }

  return { curve, length, anchors, getFrameAt, getDistrictInfoAt };
}
