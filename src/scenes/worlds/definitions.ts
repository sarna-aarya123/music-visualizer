import * as THREE from 'three';
import { createRng } from '../cyberpunkCity/world/seededRandom';
import type { RouteData } from '../cyberpunkCity/world/routeGenerator';
import type { BuiltWorld, PropGroup, WorldDefinition } from './types';
import { G, mat } from './geometry';
import { createSignatureEventAnimated, type EventBinding } from '../cyberpunkCity/world/worldEvents';

/**
 * The eight art-reference worlds, each expressed as data: a sky, a mood,
 * a path, and instanced prop groups placed relative to the route.
 *
 * Each world is built around the ICONIC elements of its reference panel
 * (floating pyramids, a whale over sunken columns, a ringed planet, a
 * ferris wheel and funhouse, giant capped mushrooms...) rather than
 * generic scenery recoloured — that distinction was the difference
 * between the earlier attempts and the approved Floating Islands world.
 *
 * Placement always starts at or beyond the route's corridor radius, so
 * geometry can never intrude on the camera's path.
 */

type Rng = () => number;

/** Samples the route and hands back a frame plus its clearance radius. */
function at(route: RouteData<string>, t: number) {
  const u = ((t % 1) + 1) % 1;
  return { f: route.getFrameAt(u), r: route.getDistrictInfoAt(u).corridorRadius };
}

/** A point offset sideways (and optionally up/down) from the route.
 *
 *  `extra` is measured from the corridor edge to the object's NEAREST face,
 *  so callers must pass the object's own radius in `ownRadius`. Omitting
 *  that was a real bug: large props (desert dunes up to 27 units across,
 *  forest mushroom caps, carnival tents) were positioned by their CENTRE
 *  just a few units beyond the corridor and so cut straight through the
 *  walkway.
 *
 *  Stage 8 — self-clearance guard. `flank` offsets sideways from the route
 *  AT PARAMETER `t`; on the inside of a tight bend that offset point can
 *  land near a slightly-LATER arc of the same closed loop, so the prop
 *  ends up on/over the walkway there even though it's correctly clear of
 *  the route at `t`. After computing the point, this scans a narrow
 *  t-window (±~2.5% of the loop — enough for one hairpin, never the far
 *  side) and, for the closest arc it still intrudes on, pushes the point
 *  directly AWAY from that arc's centre (`normalize(p - arcPoint)` in XZ —
 *  an earlier attempt pushed along a fixed `right` axis, which on a
 *  hairpin can shove the prop *toward* the offending arc; that was the
 *  bug). The push is capped so a prop with a small `extra` can't be flung
 *  far, and it never pulls the prop back across the corridor at `t`
 *  (it started `extra` clear of it). No-op for the ~99% of props already
 *  clear. Route generation / corridor radii are untouched — this is
 *  placement only.
 *
 *  `baseHalf` (Stage 8): normally the sideways offset is measured from the
 *  full corridor edge (`corridorRadius`). In WIDE districts that radius is
 *  15-26 units, so "just beyond the corridor" is far off the ~5-wide
 *  VISIBLE walkway — long stretches then have nothing beside the path.
 *  Pass a small `baseHalf` (≈ the visible deck half-width) to place a prop
 *  relative to the visible path instead; the self-clearance scan then
 *  guards against that same width, not the big corridor. Use only for
 *  small near-field dressing that reads fine sitting inside a wide
 *  district's reserved zone. */
const SELF_CLEAR_MARGIN = 2.5;

/** Whole-loop centreline sample cache, one array per route object. The
 *  local hairpin scan in `flank` only sees ±3% of the loop; this backs the
 *  full-loop fold guard below. 384 samples ≈ one every 6 units on a
 *  ~2200-unit loop. */
const routeSampleCache = new WeakMap<object, { x: number; y: number; z: number }[]>();
function loopSamples(route: RouteData<string>) {
  let s = routeSampleCache.get(route);
  if (!s) {
    s = [];
    for (let i = 0; i < 384; i++) {
      const f = route.getFrameAt(i / 384);
      s.push({ x: f.position.x, y: f.position.y, z: f.position.z });
    }
    routeSampleCache.set(route, s);
  }
  return s;
}

function flank(
  route: RouteData<string>,
  t: number,
  side: -1 | 1,
  extra: number,
  lift = 0,
  ownRadius = 0,
  baseHalf?: number
): THREE.Vector3 {
  const { f, r } = at(route, t);
  const base = baseHalf ?? r;
  const p = f.position
    .clone()
    .addScaledVector(f.right, side * (base + ownRadius + extra))
    .addScaledVector(f.up, lift);

  // Window kept deliberately narrow (~±3% of the loop): wide enough for a
  // hairpin, and NOT wide enough to start "seeing" genuinely distant arcs
  // — pushing a prop away from a far arc can shove it toward a third one.
  let deficit = 0;
  let dirX = 0;
  let dirZ = 0;
  for (let k = -13; k <= 13; k++) {
    if (k >= -1 && k <= 1) continue; // the placement arc itself
    const s = at(route, t + k * 0.0022);
    const dx = p.x - s.f.position.x;
    const dz = p.z - s.f.position.z;
    const dist = Math.hypot(dx, dz);
    const need = (baseHalf ?? s.r) + ownRadius + SELF_CLEAR_MARGIN;
    if (dist < need && dist > 1e-3) {
      const d = need - dist;
      if (d > deficit) {
        deficit = d;
        dirX = dx / dist;
        dirZ = dz / dist;
      }
    }
  }
  if (deficit > 0) {
    // Cap scales with the prop's own radius too — a big mound needs a big
    // push to actually clear a neighbouring arc, whereas the old flat
    // `extra*0.85 + 3` only ever nudged small props.
    const push = Math.min(deficit, extra * 0.85 + ownRadius * 0.6 + 3);
    p.x += dirX * push;
    p.z += dirZ * push;
  }

  // Full-loop fold guard (Stage 8). The scan above only sees a hairpin one
  // anchor away. A jittered Catmull-Rom route can also FOLD BACK on itself
  // over a much larger arc — two stretches of track passing within tens of
  // units — and a big prop (a mesa, a floating pyramid, a far dune)
  // correctly `extra` clear of one stretch can land right on the other. It
  // showed up as the character running straight through a mesa on the far
  // side of a fold. Scan the WHOLE loop; skip a sample if the prop sits far
  // enough above/below that stretch of track that it can't touch the
  // character there anyway (so deliberately high/low decoration — whales
  // 46u up, deep-sunk far dunes — is left alone). For the rest, push
  // directly away from the single worst offender, iterated so clearing one
  // fold doesn't strand the prop on another; total displacement capped, and
  // a final radial-outward shove for anything genuinely boxed in.
  {
    const samples = loopSamples(route);
    const tNorm = ((t % 1) + 1) % 1;
    const need2 = base + ownRadius + SELF_CLEAR_MARGIN + 2;
    const vTol = ownRadius + 9; // prop can't reach the character past this Δy
    const SKIP_T = 0.03; // matches the ±3% local scan — no dead band between them
    let budget = 220;
    for (let iter = 0; iter < 10 && budget > 0.5; iter++) {
      let worst = 0;
      let wx = 0;
      let wz = 0;
      for (let i = 0; i < samples.length; i++) {
        let du = Math.abs(i / samples.length - tNorm);
        if (du > 0.5) du = 1 - du;
        if (du < SKIP_T) continue; // the prop's own placement arc
        const s = samples[i];
        if (Math.abs(s.y - p.y) > vTol) continue; // vertical miss
        const dx = p.x - s.x;
        const dz = p.z - s.z;
        const dist = Math.hypot(dx, dz) || 1e-3;
        if (need2 - dist > worst) {
          worst = need2 - dist;
          wx = dx / dist;
          wz = dz / dist;
        }
      }
      if (worst <= 0) break;
      const step = Math.min(worst + 0.5, budget);
      p.x += wx * step;
      p.z += wz * step;
      budget -= step;
      if (iter === 9 && worst > 0) {
        // Boxed in by folds on multiple sides — give up on precision and
        // shove it well clear of the loop radially. A background prop flung
        // an extra few tens of units into the void is invisible; the
        // character running through it is not.
        const len = Math.hypot(p.x, p.z) || 1;
        p.x += (p.x / len) * Math.min(worst + 25, 220);
        p.z += (p.z / len) * Math.min(worst + 25, 220);
      }
    }
  }

  return p;
}

function side(rng: Rng): -1 | 1 {
  return rng() < 0.5 ? -1 : 1;
}

// ---------------------------------------------------------------------------
// 1. CYBERPUNK NIGHT — neon canyon, signage, rain, wet street
// ---------------------------------------------------------------------------
function buildCyberpunk(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x11);
  const towers: THREE.Matrix4[] = [];
  const windows: THREE.Matrix4[] = [];
  const signs: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Phase 6 Stage 5 signature event: a handful of the tallest towers (and
  // their own window bands) surge upward and light up through the
  // sequence — capped well below the full landmark count (all h>52
  // towers still count as camera landmarks; only the first
  // MAX_EVENT_TOWERS also get the animated rise) so the event stays a
  // focused "these specific skyscrapers are doing something" moment
  // instead of animating the entire skyline every frame.
  const MAX_EVENT_TOWERS = 6;
  const eventTowerIndices: number[] = [];
  const eventWindowIndices: number[] = [];

  const N = 150;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    for (const s of [-1, 1] as const) {
      if (rng() > 0.85) continue;
      const w = 3 + rng() * 5;
      const h = 18 + rng() * 46;
      const p = flank(route, t, s, 1.5 + rng() * 9, h / 2 - 2, w * 0.6);
      const rot = rng() * 0.4 - 0.2;
      towers.push(mat(p, [0, rot, 0], [w, h, w * (0.8 + rng() * 0.5)]));
      const towerIdx = towers.length - 1;
      const isEventTower = h > 52 && eventTowerIndices.length < MAX_EVENT_TOWERS;
      if (isEventTower) eventTowerIndices.push(towerIdx);

      // Emissive window bands climbing the facade.
      const bands = 3 + Math.floor(rng() * 5);
      for (let b = 0; b < bands; b++) {
        const by = p.y - h / 2 + (h * (b + 0.8)) / (bands + 1);
        const bp = new THREE.Vector3(p.x, by, p.z);
        windows.push(mat(bp, [0, rot, 0], [w * 1.02, 0.5 + rng() * 0.8, w * 0.82]));
        if (isEventTower) eventWindowIndices.push(windows.length - 1);
      }
      // Vertical neon sign strips on the corridor-facing side.
      if (rng() < 0.5) {
        const sp = flank(route, t, s, 1.4, p.y - h * 0.15);
        signs.push(mat(sp, [0, rot, 0], [0.35, 4 + rng() * 8, 0.35]));
      }
      if (h > 52) landmarkPositions.push(p.clone());
    }
  }

  // Towers: rise through buildup/tension, a big surge at the drop, keep
  // climbing through transform, hold at full height for reveal, settle
  // back down through aftermath. Each phase's liftFrom matches the
  // previous phase's liftTo so the rise reads as one continuous motion.
  const towerBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -16, liftTo: -6 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -6, liftTo: -1 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: -1, liftTo: 9 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 9, liftTo: 14 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 14, liftTo: 14 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 14, liftTo: 0 } },
  ];
  // Windows: the SAME lift as their own tower on every phase (they're
  // mounted ON the facade — leaving them at the base height while the
  // tower rises out from under them would visibly detach them from the
  // building) PLUS a SWEEP (staggered) activation climbing the facade
  // during tension and a synced brightness/size pulse at the drop —
  // "windows cascading on" per the brief.
  const windowBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -16, liftTo: -6 } },
    { phase: 'tension', archetype: 'SWEEP', params: { liftFrom: -6, liftTo: -1, scaleFrom: 0.3, scaleTo: 1.0, stagger: 0.7 } },
    { phase: 'drop', archetype: 'ACTIVATE', params: { liftFrom: -1, liftTo: 9, scaleFrom: 1.0, scaleTo: 1.35 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 9, liftTo: 14 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 14, liftTo: 14 } },
    { phase: 'aftermath', archetype: 'ACTIVATE', params: { liftFrom: 14, liftTo: 0, scaleFrom: 1.35, scaleTo: 1.0 } },
  ];

  const groups: PropGroup[] = [
    {
      key: 'towers',
      geometry: G.box,
      toon: { color: '#2b2350', shadow: '#120a2e', rim: '#7ef2ff', rimStrength: 0.55 },
      matrices: towers,
      animated: createSignatureEventAnimated(towers, eventTowerIndices, towerBindings),
    },
    {
      key: 'windows',
      geometry: G.box,
      toon: { color: '#ffc46a', shadow: '#8a4a2a', rim: '#fff0c0', rimStrength: 0.3, emissive: 0.48 },
      matrices: windows,
      reactive: { mood: 0.4, drums: 0.3, event: 1.4 },
      animated: createSignatureEventAnimated(windows, eventWindowIndices, windowBindings),
    },
    {
      key: 'signs',
      geometry: G.box,
      toon: { color: '#ff3fa8', shadow: '#5a1050', rim: '#ffd0ee', rimStrength: 0.5, emissive: 0.6 },
      matrices: signs,
      reactive: { drums: 0.6, event: 1.8 },
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 2. DESERT DREAM — a twilight desert under a sky of colossal floating
//    pyramids. Rebuilt from the ground up after repeated "the character
//    runs through a pile of sand" reports: there are now NO dunes anywhere
//    near the path. Dunes are a distant rolling backdrop only. The
//    near-field is nothing but slender vertical things — standing stones,
//    saguaro, palms, weathered rocks, rib arches — each placed with a clear
//    ≥5u strip of flat sand floor between it and the walkway edge. If it
//    STILL reads as "running through sand", the honest move is to cut the
//    world; nothing subtle is left to try.
function buildDesert(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x22);
  const sand: THREE.Matrix4[] = [];
  const pyramids: THREE.Matrix4[] = [];
  const dunes: THREE.Matrix4[] = [];
  const mesas: THREE.Matrix4[] = [];
  const cacti: THREE.Matrix4[] = [];
  const rocks: THREE.Matrix4[] = [];
  const stones: THREE.Matrix4[] = [];
  const palms: THREE.Matrix4[] = [];
  const fronds: THREE.Matrix4[] = [];
  const arches: THREE.Matrix4[] = [];
  const debris: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Continuous flat desert floor: wide tiles following the route's height
  // and heading, just under the deck. The near-field props stand ON this,
  // clearly separated from the walkway — no isolated lumps, no void.
  const GROUND_TILES = 84;
  const tileSpan = (route.length / GROUND_TILES) * 1.7;
  for (let i = 0; i < GROUND_TILES; i++) {
    const f = route.getFrameAt(i / GROUND_TILES);
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    // Tile top ends up ~0.4u below the deck (box is 1.4 tall, centred) —
    // clearly under the walkway, no z-fight, still fills the desert floor.
    const p = f.position.clone().addScaledVector(f.up, -1.1 - (i % 3) * 0.05);
    sand.push(mat(p, [0, yaw, 0], [170, 1.4, tileSpan]));
  }

  // THE hero read: colossal floating pyramids dominating the sky. 8 loom
  // large and fairly close (but high — the base always floats well over the
  // route), 6 are distant colossi closing the horizon. More, bigger, and
  // closer than before so the world is unmistakably "the pyramid desert".
  for (let i = 0; i < 14; i++) {
    const t = i / 14 + rng() * 0.03;
    const s = side(rng);
    const near = i < 8;
    const size = near ? 26 + rng() * 26 : 46 + rng() * 60;
    const lateral = near ? 30 + rng() * 40 : 90 + rng() * 150;
    const lift = near ? size * 0.85 + 22 + rng() * 16 : 60 + rng() * 80;
    const p = flank(route, t, s, lateral, lift, size);
    pyramids.push(
      mat(p, [rng() * 0.12 - 0.06, rng() * Math.PI, rng() * 0.12 - 0.06], [size, size * 1.05, size])
    );
    landmarkPositions.push(p.clone());
    const chunks = 3 + Math.floor(rng() * 4);
    for (let c = 0; c < chunks; c++) {
      const a = rng() * Math.PI * 2;
      const rad = size * (0.9 + rng() * 1.3);
      const sz = 1.4 + rng() * 3.6;
      debris.push(
        mat(
          new THREE.Vector3(p.x + Math.cos(a) * rad, p.y + (rng() - 0.5) * size * 1.1, p.z + Math.sin(a) * rad),
          [rng() * 3, rng() * 3, rng() * 3],
          [sz, sz, sz]
        )
      );
    }
  }

  // Dunes: a DISTANT rolling backdrop, nothing else. Nearest ones start
  // ~110u off the route and are sunk so only the crest shows — a horizon of
  // sand swells, never anything the runner can reach.
  for (let i = 0; i < 64; i++) {
    const t = i / 64 + rng() * 0.01;
    const s = side(rng);
    const r = 16 + rng() * 26;
    const p = flank(route, t, s, 110 + rng() * 120, -r * 0.6, r * 1.5);
    dunes.push(mat(p, [0, rng() * Math.PI, 0], [r, r * 0.4, r * 1.3]));
  }
  // Far ridge closing the horizon — far out, mostly buried.
  for (let i = 0; i < 40; i++) {
    const t = rng();
    const s = side(rng);
    const r = 30 + rng() * 44;
    const p = flank(route, t, s, 240 + rng() * 180, -r * 0.78, r * 1.3);
    dunes.push(mat(p, [0, rng() * Math.PI, 0], [r, r * 0.5, r * 1.2]));
  }

  // Mesas — a MID-GROUND layer (30-90u out), between the near dressing and
  // the dune horizon. Never path-side.
  for (let i = 0; i < 24; i++) {
    const t = i / 24 + rng() * 0.02;
    const s = side(rng);
    const r = 6 + rng() * 12;
    const h = 12 + rng() * 26;
    const p = flank(route, t, s, 30 + rng() * 60, h / 2 - 3, r * 1.2);
    mesas.push(mat(p, [0, rng() * Math.PI, 0], [r, h, r * (0.7 + rng() * 0.5)]));
  }

  // --- Near field: slender vertical props ONLY, each with a clear ≥5u
  // strip of flat sand between it and the deck edge (extra floor ≥ 5 with
  // baseHalf 5.2). Nothing wide, nothing that reads as "sand in the road".

  // Weathered rocks/boulders — sit fully on the sand beside the path.
  for (let i = 0; i < 90; i++) {
    const t = i / 90 + rng() * 0.004;
    const s = side(rng);
    const sz = 0.8 + rng() * 3.2;
    const p = flank(route, t, s, 5 + rng() * 9, sz * 0.32, sz * 1.15, 5.2);
    rocks.push(mat(p, [rng() * 3, rng() * 3, rng() * 3], [sz, sz * (0.7 + rng() * 0.5), sz * (0.8 + rng() * 0.4)]));
  }

  // Standing stones — carved sandstone pillars, alternating sides, leaning.
  for (let i = 0; i < 52; i++) {
    const t = i / 52 + rng() * 0.006;
    const s: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const h = 3.5 + rng() * 7;
    const w = 0.8 + rng() * 1.1;
    const p = flank(route, t, s, 5 + rng() * 5, h / 2, w * 1.3, 5.2);
    stones.push(mat(p, [rng() * 0.22 - 0.11, rng() * Math.PI, rng() * 0.22 - 0.11], [w, h, w * (0.7 + rng() * 0.5)]));
  }

  // Oasis palms — trunk + a flattened frond dome.
  for (let i = 0; i < 22; i++) {
    const t = i / 22 + rng() * 0.01;
    const s = side(rng);
    const h = 5.5 + rng() * 5;
    const p = flank(route, t, s, 5 + rng() * 6, h / 2, 4, 5.2);
    const lean = rng() * 0.18 - 0.09;
    palms.push(mat(p, [lean, rng() * Math.PI, lean * 0.6], [0.4, h, 0.4]));
    const crownR = 2.2 + rng() * 1.4;
    fronds.push(
      mat(new THREE.Vector3(p.x, p.y + h / 2, p.z), [rng() * 0.3, rng() * Math.PI, rng() * 0.3], [crownR, crownR * 0.5, crownR])
    );
  }

  // Rib arches — a torus is a vertical ring in its own geometry; yaw it
  // `tangent + 90°` so it stands broadside (a monument you run past), well
  // back from the deck.
  for (let i = 0; i < 9; i++) {
    const t = i / 9 + rng() * 0.04;
    const s = side(rng);
    const rad = 5 + rng() * 7;
    // ownRadius = rad: the ring's plane contains the tangent, so it reaches
    // its full radius back along a curving path toward the centreline.
    const p = flank(route, t, s, 9 + rng() * 9, rad * 0.32, rad, 5.2);
    const yaw = Math.atan2(at(route, t).f.tangent.x, at(route, t).f.tangent.z) + Math.PI / 2;
    arches.push(mat(p, [0, yaw, rng() * 0.3 - 0.15], [rad, rad, rad * 0.5]));
  }

  // Saguaro cacti — beside the road, a clear strip in.
  for (let i = 0; i < 76; i++) {
    const t = i / 76;
    const s = side(rng);
    const h = 2.5 + rng() * 5;
    const p = flank(route, t, s, 5 + rng() * 6, h / 2, 1.9, 5.2);
    cacti.push(mat(p, [0, rng() * Math.PI, 0], [0.5, h, 0.5]));
    if (rng() < 0.6) {
      const armY = p.y + h * (0.1 + rng() * 0.25);
      const dir = rng() < 0.5 ? -1 : 1;
      cacti.push(mat(new THREE.Vector3(p.x + dir * 0.7, armY, p.z), [0, 0, dir * 1.15], [0.34, 1.5, 0.34]));
      cacti.push(mat(new THREE.Vector3(p.x + dir * 1.15, armY + 0.85, p.z), [0, 0, 0], [0.34, 1.7, 0.34]));
    }
  }

  // Signature event: the floating pyramids surge higher and begin a slow
  // rotation during reveal — "pyramids rise and rotate" per the brief.
  // Spin is confined to a single phase (reveal) — see worldEvents.ts's
  // doc comment on why a spin binding must never span two phases.
  const pyramidBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -10, liftTo: -4 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -4, liftTo: 2 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: 2, liftTo: 16 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 16, liftTo: 20 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 20, liftTo: 20, spinRate: 0.7 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 20, liftTo: 0 } },
  ];
  const pyramidIndices = pyramids.map((_, i) => i);

  const groups: PropGroup[] = [
    {
      // Pale, slightly cool sand — deliberately DESATURATED and light so
      // the warm dark-clay path reads as an obvious strip against it. The
      // whole "runs through sand" complaint was the path and the ground
      // being the same tone.
      key: 'sand',
      geometry: G.box,
      toon: { color: '#dcc6a4', shadow: '#8f7a5c', rim: '#f2e6cc', rimStrength: 0.14 },
      matrices: sand,
    },
    {
      key: 'pyramids',
      geometry: G.cone4,
      toon: { color: '#e0763c', shadow: '#5a1638', rim: '#ffe2ae', rimStrength: 0.75 },
      matrices: pyramids,
      reactive: { mood: 0.18, event: 1.1 },
      animated: createSignatureEventAnimated(pyramids, pyramidIndices, pyramidBindings),
    },
    {
      key: 'mesas',
      geometry: G.cyl6,
      toon: { color: '#b8502c', shadow: '#3a0e26', rim: '#ffcf96', rimStrength: 0.55 },
      matrices: mesas,
    },
    {
      key: 'arches',
      geometry: G.torusThick,
      toon: { color: '#c25e30', shadow: '#421222', rim: '#ffd2a0', rimStrength: 0.6 },
      matrices: arches,
    },
    {
      key: 'dunes',
      geometry: G.dome,
      toon: { color: '#eea866', shadow: '#8a4230', rim: '#ffe8c0', rimStrength: 0.4 },
      matrices: dunes,
    },
    {
      key: 'stones',
      geometry: G.box,
      toon: { color: '#c98a56', shadow: '#4a2a1c', rim: '#ffe0b0', rimStrength: 0.45 },
      matrices: stones,
    },
    {
      key: 'rocks',
      geometry: G.ico1,
      toon: { color: '#a5653c', shadow: '#3a1c14', rim: '#ffcf96', rimStrength: 0.4 },
      matrices: rocks,
    },
    {
      key: 'palms',
      geometry: G.cylTaper,
      toon: { color: '#7a5a30', shadow: '#2c1e14', rim: '#e8d0a0', rimStrength: 0.4 },
      matrices: palms,
    },
    {
      key: 'fronds',
      geometry: G.dome,
      toon: { color: '#5aa04a', shadow: '#26402a', rim: '#d8ffb0', rimStrength: 0.5 },
      matrices: fronds,
    },
    {
      key: 'cacti',
      geometry: G.cyl6,
      toon: { color: '#4f8a4a', shadow: '#25324a', rim: '#c8ffa0', rimStrength: 0.5 },
      matrices: cacti,
    },
    {
      key: 'debris',
      geometry: G.ico0,
      toon: { color: '#d06a3a', shadow: '#4a1830', rim: '#ffc890', rimStrength: 0.65 },
      matrices: debris,
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 3. UNDERWATER ABYSS — a whale above sunken ruins, shafts of light
// ---------------------------------------------------------------------------
function buildAbyss(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x33);
  const columns: THREE.Matrix4[] = [];
  const blocks: THREE.Matrix4[] = [];
  const whales: THREE.Matrix4[] = [];
  const coral: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Hero: enormous whales cruising high overhead. Yaw is biased to the
  // local route heading (±~40°) so they read as *cruising along* the
  // canyon — a fully random yaw left some of them nose-diving broadside
  // across the path. `len` is the long (Z) axis, so aligning local Z with
  // the tangent points them the way they're "swimming".
  for (let i = 0; i < 5; i++) {
    const t = i / 5 + rng() * 0.05;
    const s = side(rng);
    const len = 40 + rng() * 34;
    const p = flank(route, t, s, 22 + rng() * 40, 46 + rng() * 30);
    const heading = Math.atan2(at(route, t).f.tangent.x, at(route, t).f.tangent.z) + (rng() - 0.5) * 1.4;
    whales.push(mat(p, [rng() * 0.16 - 0.05, heading, 0.08], [len * 0.26, len * 0.22, len]));
    landmarkPositions.push(p.clone());
  }
  // Ruined colonnade lining the seabed.
  for (let i = 0; i < 110; i++) {
    const t = i / 110;
    const s = side(rng);
    const h = 8 + rng() * 20;
    // Stage 7: pass the column's own radius (~2.5) and a slightly larger
    // base margin so the near face clears the corridor edge rather than
    // sitting on it — a leaning column right at the path edge read as
    // "the character clips it" even though centres never met.
    const p = flank(route, t, s, 4 + rng() * 13, h / 2, 2.5);
    columns.push(mat(p, [rng() * 0.12 - 0.06, rng() * Math.PI, rng() * 0.12 - 0.06], [1.5 + rng(), h, 1.5 + rng()]));
    if (rng() < 0.4) {
      const bp = flank(route, t, s, 3 + rng() * 12, 0.6, 3.5);
      blocks.push(mat(bp, [0, rng() * Math.PI, 0], [3 + rng() * 4, 1.2, 3 + rng() * 4]));
    }
  }
  for (let i = 0; i < 130; i++) {
    const t = i / 130;
    const s = side(rng);
    const h = 1.5 + rng() * 4;
    // Stage 7: account for the coral's own radius (h*0.5) in the clearance.
    const p = flank(route, t, s, 3 + rng() * 15, h / 2, h * 0.5);
    coral.push(mat(p, [0, rng() * Math.PI, 0], [h * 0.5, h, h * 0.5]));
  }

  // Whales surge upward and loom large through the sequence — "whale
  // pass overhead" per the brief. Coral blooms in a staggered wave
  // (a subset, for focus/performance) with a synced pulse at the drop.
  const whaleBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -6, liftTo: -2 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -2, liftTo: 2 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: 2, liftTo: 10 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 10, liftTo: 14 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 14, liftTo: 14 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 14, liftTo: 0 } },
  ];
  const whaleIndices = whales.map((_, i) => i);

  const coralEventIndices = coral.map((_, i) => i).filter((i) => i % 3 === 0);
  const coralBindings: EventBinding[] = [
    { phase: 'tension', archetype: 'SWEEP', params: { scaleFrom: 0.4, scaleTo: 1.0, stagger: 0.8 } },
    { phase: 'drop', archetype: 'BLOOM', params: { scaleFrom: 1.0, scaleTo: 1.3 } },
    { phase: 'aftermath', archetype: 'BLOOM', params: { scaleFrom: 1.3, scaleTo: 1.0 } },
  ];

  const groups: PropGroup[] = [
    {
      key: 'whales',
      geometry: G.ico1,
      toon: { color: '#3a7eaa', shadow: '#173a58', rim: '#bff0ff', rimStrength: 0.8 },
      matrices: whales,
      reactive: { mood: 0.2, event: 1.2 },
      animated: createSignatureEventAnimated(whales, whaleIndices, whaleBindings),
    },
    {
      key: 'columns',
      geometry: G.cyl8,
      toon: { color: '#5c8ea6', shadow: '#1c3850', rim: '#c8f4ff', rimStrength: 0.5 },
      matrices: columns,
    },
    {
      key: 'blocks',
      geometry: G.box,
      toon: { color: '#4d7a90', shadow: '#183044', rim: '#b0e8ff', rimStrength: 0.4 },
      matrices: blocks,
    },
    {
      key: 'coral',
      geometry: G.cone5,
      toon: { color: '#ff7fb0', shadow: '#2a2a6a', rim: '#ffd0e8', rimStrength: 0.6, emissive: 0.15 },
      matrices: coral,
      reactive: { drums: 0.4, event: 0.9 },
      animated: createSignatureEventAnimated(coral, coralEventIndices, coralBindings),
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 4. OUTER DIMENSION — ringed planet, drifting rock, crystal shards
// ---------------------------------------------------------------------------
function buildOuter(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x44);
  const rocks: THREE.Matrix4[] = [];
  const shards: THREE.Matrix4[] = [];
  const rings: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  for (let i = 0; i < 150; i++) {
    const t = rng();
    const s = side(rng);
    const sz = 1.5 + rng() * 9;
    // extra floor 12 (was 5) + ownRadius covers the rotation-inflated
    // footprint (ico scaled up to sz*1.2, any orientation) so a route-level
    // asteroid never grazes the runner.
    const p = flank(route, t, s, 12 + rng() * 84, -20 + rng() * 70, sz * 1.3);
    rocks.push(mat(p, [rng() * 3, rng() * 3, rng() * 3], [sz, sz * (0.6 + rng() * 0.6), sz]));
  }
  for (let i = 0; i < 80; i++) {
    const t = i / 80;
    const s = side(rng);
    const h = 3 + rng() * 12;
    // Stage 7: account for the shard's own radius (h*0.22) in the clearance.
    const p = flank(route, t, s, 4 + rng() * 21, rng() * 16 - 4, h * 0.22);
    shards.push(mat(p, [rng() * 0.7 - 0.35, rng() * Math.PI, rng() * 0.7 - 0.35], [h * 0.22, h, h * 0.22]));
  }
  // Hero: vast tilted energy rings the path passes BESIDE (not through).
  // `ownRadius = rad*0.7` so `flank` keeps the whole hoop — not just its
  // centre — clear of the corridor; the old placement let a 56u-radius
  // ring offset only ~46u overhang the deck with its lower edge at running
  // height.
  for (let i = 0; i < 6; i++) {
    const t = i / 6 + rng() * 0.04;
    const s = side(rng);
    const rad = 24 + rng() * 22;
    const p = flank(route, t, s, rad * 0.5 + 18, 18 + rng() * 20, rad);
    rings.push(mat(p, [Math.PI / 2 + (rng() * 0.6 - 0.3), rng() * Math.PI, 0], [rad, rad, rad]));
    landmarkPositions.push(p.clone());
  }

  // Rings rise into view, then spin up and align during transform —
  // "rings spin up and align" per the brief. Spin confined to transform
  // only (see worldEvents.ts's single-phase-spin rule).
  const ringBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -8, liftTo: -3 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -3, liftTo: 2 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: 2, liftTo: 12 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 12, liftTo: 12, spinRate: 2.2 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 12, liftTo: 12 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 12, liftTo: 0 } },
  ];
  const ringIndices = rings.map((_, i) => i);

  const groups: PropGroup[] = [
    {
      key: 'rocks',
      geometry: G.ico0,
      toon: { color: '#5c3f8f', shadow: '#180a34', rim: '#d8b0ff', rimStrength: 0.65 },
      matrices: rocks,
    },
    {
      key: 'shards',
      geometry: G.octa,
      toon: { color: '#b06cff', shadow: '#2a1060', rim: '#f0d8ff', rimStrength: 0.8, emissive: 0.28 },
      matrices: shards,
      reactive: { drums: 0.5, mood: 0.3, event: 1.5 },
    },
    {
      key: 'rings',
      geometry: G.torusThick,
      toon: { color: '#ff6ad5', shadow: '#3a0a52', rim: '#ffd0f4', rimStrength: 0.9, emissive: 0.4 },
      matrices: rings,
      reactive: { drums: 0.6, event: 2.0 },
      animated: createSignatureEventAnimated(rings, ringIndices, ringBindings),
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 5. PS2 NIGHT — low-poly suburb, huge moon, streetlights
// ---------------------------------------------------------------------------
function buildPs2(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x55);
  const houses: THREE.Matrix4[] = [];
  const roofs: THREE.Matrix4[] = [];
  const lit: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const canopies: THREE.Matrix4[] = [];
  const lamps: THREE.Matrix4[] = [];
  const lampHeads: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    for (const s of [-1, 1] as const) {
      if (rng() > 0.75) continue;
      const w = 6 + rng() * 4;
      const h = 4 + rng() * 3;
      const p = flank(route, t, s, 3 + rng() * 6, h / 2, w * 0.6);
      const rot = Math.atan2(-at(route, t).f.right.z, at(route, t).f.right.x);
      houses.push(mat(p, [0, rot, 0], [w, h, w * 0.8]));
      roofs.push(mat(new THREE.Vector3(p.x, p.y + h / 2 + 1.1, p.z), [0, rot + Math.PI / 4, 0], [w * 0.82, 2.2, w * 0.7]));
      // Warmly lit windows.
      for (let k = 0; k < 3; k++) {
        const wx = (k - 1) * w * 0.28;
        const wp = p.clone().addScaledVector(at(route, t).f.right, s * -0.1).add(new THREE.Vector3(wx * 0.3, 0.2, 0));
        if (rng() < 0.7) lit.push(mat(wp, [0, rot, 0], [w * 0.16, 0.9, w * 0.85]));
      }
      if (rng() < 0.15) landmarkPositions.push(p.clone());
    }
  }
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    const s = side(rng);
    const h = 4 + rng() * 5;
    // Stage 7: ownRadius raised 2.8 -> 3.6 so the (wider) canopy above the
    // trunk also clears the corridor edge, not just the trunk itself.
    const p = flank(route, t, s, 2 + rng() * 4, h / 2, 3.6);
    trunks.push(mat(p, [0, 0, 0], [0.35, h, 0.35]));
    canopies.push(mat(new THREE.Vector3(p.x, p.y + h * 0.7, p.z), [rng(), rng() * 3, rng()], [2.6 + rng(), 2.4 + rng(), 2.6 + rng()]));
  }
  for (let i = 0; i < 46; i++) {
    const t = i / 46;
    const s = side(rng);
    const p = flank(route, t, s, 1.6, 2.6);
    lamps.push(mat(p, [0, 0, 0], [0.18, 5.2, 0.18]));
    lampHeads.push(mat(new THREE.Vector3(p.x, p.y + 2.7, p.z), [0, 0, 0], [0.5, 0.35, 0.5]));
  }

  // Streetlights ACTIVATE in a SWEEP down the road, popping past their
  // normal size before settling exactly back to it at the drop — "street
  // lights activate in a sweep down the road" per the brief. No bindings
  // needed past the drop: its scaleTo of 1.0 already equals the base
  // transform, so the group is indistinguishable from static once it
  // ends — nothing to ease back from.
  const lampHeadBindings: EventBinding[] = [
    { phase: 'tension', archetype: 'SWEEP', params: { scaleFrom: 0.2, scaleTo: 1.3, stagger: 0.75 } },
    { phase: 'drop', archetype: 'ACTIVATE', params: { scaleFrom: 1.3, scaleTo: 1.0 } },
  ];
  const lampHeadIndices = lampHeads.map((_, i) => i);

  const groups: PropGroup[] = [
    { key: 'houses', geometry: G.box, toon: { color: '#5a5f86', shadow: '#191a34', rim: '#cfd8ff', rimStrength: 0.45 }, matrices: houses },
    { key: 'roofs', geometry: G.cone4, toon: { color: '#6d4360', shadow: '#1c1130', rim: '#e0c0ff', rimStrength: 0.4 }, matrices: roofs },
    {
      key: 'lit',
      geometry: G.box,
      toon: { color: '#ffcf7a', shadow: '#a05a2a', rim: '#fff0c8', rimStrength: 0.2, emissive: 0.6 },
      matrices: lit,
      reactive: { mood: 0.35, event: 1.0 },
    },
    { key: 'trunks', geometry: G.cyl6, toon: { color: '#3f2f46', shadow: '#15102a', rim: '#c0b0e0', rimStrength: 0.35 }, matrices: trunks },
    { key: 'canopies', geometry: G.ico1, toon: { color: '#2f5a52', shadow: '#101e38', rim: '#a8ffd0', rimStrength: 0.4 }, matrices: canopies },
    { key: 'lamps', geometry: G.cyl6, toon: { color: '#33334a', shadow: '#12121f', rim: '#b0c0e0', rimStrength: 0.3 }, matrices: lamps },
    {
      key: 'lampHeads',
      geometry: G.sphere,
      toon: { color: '#ffe0a0', shadow: '#a06a30', rim: '#fff6d8', rimStrength: 0.2, emissive: 0.68 },
      matrices: lampHeads,
      reactive: { drums: 0.3, event: 1.2 },
      animated: createSignatureEventAnimated(lampHeads, lampHeadIndices, lampHeadBindings),
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 6. FANTASY FOREST — giant capped mushrooms, glowing crystals, canopy
// ---------------------------------------------------------------------------
function buildForest(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x66);
  const stems: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  const canopies: THREE.Matrix4[] = [];
  const crystals: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Hero: giant mushrooms with broad caps.
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    const s = side(rng);
    const h = 5 + rng() * 16;
    const capR = h * (0.42 + rng() * 0.22);
    const p = flank(route, t, s, 2 + rng() * 16, h / 2, capR);
    stems.push(mat(p, [0, 0, 0], [h * 0.11, h, h * 0.11]));
    const cp = new THREE.Vector3(p.x, p.y + h / 2, p.z);
    caps.push(mat(cp, [0, rng() * Math.PI, 0], [capR, capR * 0.62, capR]));
    if (h > 17) landmarkPositions.push(cp.clone());
  }

  // Giant mushroom caps bloom open in a SWEEP across the whole group, a
  // synced pulse right at the drop, then settle — "giant mushrooms bloom
  // in a sweep" per PLAN.md's own Fantasy Forest table. Each phase's
  // scale/lift starts exactly where the previous one ended.
  const capBindings: EventBinding[] = [
    { phase: 'tension', archetype: 'SWEEP', params: { scaleFrom: 0.15, scaleTo: 1.0, liftFrom: -2, liftTo: 0, stagger: 0.75 } },
    { phase: 'drop', archetype: 'BLOOM', params: { scaleFrom: 1.0, scaleTo: 1.25, liftFrom: 0, liftTo: 0.6 } },
    { phase: 'transform', archetype: 'BLOOM', params: { scaleFrom: 1.25, scaleTo: 1.1, liftFrom: 0.6, liftTo: 0.3 } },
    { phase: 'aftermath', archetype: 'BLOOM', params: { scaleFrom: 1.1, scaleTo: 1.0, liftFrom: 0.3, liftTo: 0 } },
  ];
  const capIndices = caps.map((_, i) => i);
  for (let i = 0; i < 110; i++) {
    const t = i / 110;
    const s = side(rng);
    const h = 10 + rng() * 26;
    const p = flank(route, t, s, 3 + rng() * 22, h / 2, 7);
    trunks.push(mat(p, [0, 0, 0], [0.7 + rng() * 0.7, h, 0.7 + rng() * 0.7]));
    canopies.push(mat(new THREE.Vector3(p.x, p.y + h * 0.55, p.z), [rng(), rng() * 3, rng()], [5 + rng() * 4, 4 + rng() * 3, 5 + rng() * 4]));
  }
  for (let i = 0; i < 100; i++) {
    const t = i / 100;
    const s = side(rng);
    const h = 1 + rng() * 4;
    // Stage 7 note: an earlier Stage 7 tweak here (adding ownRadius h*0.3 +
    // bumping `extra`) pushed one hairpin-inside crystal marginally closer
    // to the walkway rather than further — crystals are tiny (footprint
    // <=1.5) so `ownRadius` was cosmetic here anyway. Reverted to the
    // pre-Stage-7 placement, which is bit-identical to what shipped in
    // Stages 5/6; the residual sub-unit hairpin graze is the known
    // `flank` limitation documented above.
    const p = flank(route, t, s, 2 + rng() * 10, h * 0.4);
    crystals.push(mat(p, [rng() * 0.4 - 0.2, rng() * Math.PI, rng() * 0.4 - 0.2], [h * 0.3, h, h * 0.3]));
  }

  const groups: PropGroup[] = [
    { key: 'stems', geometry: G.cylTaper, toon: { color: '#f0e6c8', shadow: '#4a6a55', rim: '#ffffff', rimStrength: 0.4 }, matrices: stems },
    {
      key: 'caps',
      geometry: G.dome,
      toon: { color: '#ff7fa8', shadow: '#2e5a4a', rim: '#ffe0ee', rimStrength: 0.7, emissive: 0.12 },
      matrices: caps,
      reactive: { drums: 0.35, mood: 0.25, event: 1.1 },
      animated: createSignatureEventAnimated(caps, capIndices, capBindings),
    },
    { key: 'trunks', geometry: G.cylTaper, toon: { color: '#6e5138', shadow: '#324a3a', rim: '#d8ffb0', rimStrength: 0.4 }, matrices: trunks },
    { key: 'canopies', geometry: G.ico1, toon: { color: '#4aa85e', shadow: '#22503f', rim: '#e0ffa0', rimStrength: 0.5 }, matrices: canopies },
    {
      key: 'crystals',
      geometry: G.octa,
      toon: { color: '#6fd8ff', shadow: '#1a3a6a', rim: '#e0f8ff', rimStrength: 0.9, emissive: 0.4 },
      matrices: crystals,
      reactive: { drums: 0.6, event: 1.6 },
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 7. ABSTRACT VOID — neon wireframe solids in black space
// ---------------------------------------------------------------------------
function buildVoid(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x77);
  const cyan: THREE.Matrix4[] = [];
  const magenta: THREE.Matrix4[] = [];
  const gold: THREE.Matrix4[] = [];
  const rings: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Parallel to `cyan`: the corridor-edge margin each cyan solid was
  // placed at, so the SCATTER_REFORM event below can restrict itself to
  // instances that are safely clear of the route (see cyanScatterIndices).
  const cyanClearance: number[] = [];
  for (let i = 0; i < 210; i++) {
    const t = rng();
    const s = side(rng);
    const sz = 1 + rng() * 7;
    // extra floor 9 (was 4) + ownRadius sz*1.5 for the any-orientation
    // footprint of a box/tetra/octa — the lone route-level solid that used
    // to clip the runner is gone.
    const extra = 9 + rng() * 64;
    const p = flank(route, t, s, extra, -25 + rng() * 60, sz * 1.5);
    const m = mat(p, [rng() * 3, rng() * 3, rng() * 3], [sz, sz, sz]);
    const bucket = i % 3;
    if (bucket === 0) {
      cyan.push(m);
      cyanClearance.push(extra);
    } else if (bucket === 1) magenta.push(m);
    else gold.push(m);
  }
  // Portal rings the path threads STRAIGHT THROUGH: a torus is a vertical
  // ring in its own geometry (hole on local Z), so yaw the hole to the
  // route tangent and lift the centre by ~0.3*rad — the hole then
  // surrounds the walkway (bottom well below, top well above) and the
  // solid tube is a full `rad` away from the runner. (The old `Rx(π/2)`
  // laid them flat, so the tube sat at head height across the path.)
  for (let i = 0; i < 10; i++) {
    const t = i / 10;
    const rad = 18 + rng() * 22;
    const { f } = at(route, t);
    const p = f.position.clone().addScaledVector(f.up, rad * 0.3);
    rings.push(mat(p, [rng() * 0.2 - 0.1, Math.atan2(f.tangent.x, f.tangent.z), 0], [rad, rad, rad]));
    landmarkPositions.push(p.clone());
  }

  // Stage 8: base emissive 0.6 -> 0.42 (was briefly 0.32, which read as
  // flat/dead). Still down from the original so there's dark to read the
  // shapes against. rim 1.0 -> 0.85.
  const neon = (color: string, shadow: string) => ({
    color,
    shadow,
    rim: '#ffffff',
    rimStrength: 0.85,
    emissive: 0.42,
  });

  // Rings rise and spin up during transform — "rings spin up" per the
  // brief. A subset of the cyan solids scatters into chaos then
  // reassembles during transform too — "solids scatter/reform into a
  // structure". Both confined to a single phase (transform) so neither
  // needs to worry about resetting at the next phase boundary.
  const ringBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -10, liftTo: -4 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -4, liftTo: 3 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: 3, liftTo: 14 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 14, liftTo: 14, spinRate: 2.6 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 14, liftTo: 14 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 14, liftTo: 0 } },
  ];
  const ringIndices = rings.map((_, i) => i);

  // Stage 7: a 14-unit scatter applied to cyan solids based as little as
  // ~4 units past the corridor edge used to drag 8-unit octahedra straight
  // through the character's path during `transform`. Now restricted to
  // instances placed comfortably clear of the route, with the lateral
  // reach pulled in and the drama moved into the vertical/spin — the
  // "assemble out of chaos" reform beat reads the same, without anything
  // crossing the corridor.
  const cyanScatterIndices = cyan
    .map((_, i) => i)
    .filter((i) => cyanClearance[i] > 26)
    .slice(0, 18);
  const cyanBindings: EventBinding[] = [
    { phase: 'transform', archetype: 'SCATTER_REFORM', params: { scatterRadius: 10, scatterHeight: 12, scatterSpins: 1.5 } },
  ];

  const groups: PropGroup[] = [
    {
      key: 'cyan',
      geometry: G.octa,
      toon: neon('#28e6ff', '#08324a'),
      matrices: cyan,
      reactive: { drums: 0.7, event: 2.0 },
      animated: createSignatureEventAnimated(cyan, cyanScatterIndices, cyanBindings),
    },
    { key: 'magenta', geometry: G.tetra, toon: neon('#ff3fc8', '#4a0a3a'), matrices: magenta, reactive: { drums: 0.7, event: 2.0 } },
    { key: 'gold', geometry: G.box, toon: neon('#ffd23f', '#4a3208'), matrices: gold, reactive: { drums: 0.7, event: 2.0 } },
    {
      key: 'rings',
      geometry: G.torus,
      toon: { color: '#8f5cff', shadow: '#1a0a3a', rim: '#ffffff', rimStrength: 0.85, emissive: 0.55 },
      matrices: rings,
      reactive: { drums: 0.8, event: 2.6 },
      animated: createSignatureEventAnimated(rings, ringIndices, ringBindings),
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------
// 8. CHAOTIC CARNIVAL — ferris wheel, striped tents, fire glow, booths
// ---------------------------------------------------------------------------
function buildCarnival(route: RouteData<string>, seed: number): BuiltWorld {
  const rng = createRng(seed ^ 0x88);
  const wheels: THREE.Matrix4[] = [];
  const spokes: THREE.Matrix4[] = [];
  const tents: THREE.Matrix4[] = [];
  const booths: THREE.Matrix4[] = [];
  const bulbs: THREE.Matrix4[] = [];
  const landmarkPositions: THREE.Vector3[] = [];

  // Hero: ferris wheels standing upright beside the route. A `torusThick`
  // is already a vertical ring with its hole on local Z, so the ONLY
  // rotation is a yaw. It's `tangent + 90°` so the wheel presents its full
  // round face ACROSS the path — you see the classic silhouette as you run
  // past. (Yawing to the bare tangent, as before, made the wheel edge-on
  // right when it was closest — a vertical bar, not a wheel.) Spokes and
  // rim bulbs all derive from the same `wheelYaw`, so the whole assembly
  // turns together.
  for (let i = 0; i < 8; i++) {
    const t = i / 8 + rng() * 0.02;
    const s = side(rng);
    const rad = 16 + rng() * 14;
    const p = flank(route, t, s, rad * 0.6 + 14, rad * 0.85, rad * 0.5);
    const wheelYaw = Math.atan2(at(route, t).f.tangent.x, at(route, t).f.tangent.z) + Math.PI / 2;
    wheels.push(mat(p, [0, wheelYaw, 0], [rad, rad, rad]));
    landmarkPositions.push(p.clone());
    // Rim bulbs trace a vertical circle in the wheel's plane (perpendicular
    // to the hole axis `wheelYaw`).
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const sp = new THREE.Vector3(p.x, p.y + Math.sin(a) * rad, p.z);
      sp.x = p.x + Math.cos(a) * rad * Math.sin(wheelYaw + Math.PI / 2);
      sp.z = p.z + Math.cos(a) * rad * Math.cos(wheelYaw + Math.PI / 2);
      bulbs.push(mat(sp, [0, 0, 0], [1.1, 1.1, 1.1]));
    }
    spokes.push(mat(p, [0, wheelYaw, 0], [1.4, rad * 1.9, 1.4]));
    spokes.push(mat(p, [0, wheelYaw, Math.PI / 2], [1.4, rad * 1.9, 1.4]));
  }
  for (let i = 0; i < 80; i++) {
    const t = i / 80;
    const s = side(rng);
    const r = 4 + rng() * 5;
    const p = flank(route, t, s, 4 + rng() * 10, r * 0.5, r * 1.15);
    tents.push(mat(p, [0, rng() * Math.PI, 0], [r, r * 1.2, r]));
  }
  for (let i = 0; i < 70; i++) {
    const t = i / 70;
    const s = side(rng);
    const p = flank(route, t, s, 2.6 + rng() * 6, 1.4, 3.2);
    booths.push(mat(p, [0, rng() * Math.PI, 0], [3 + rng() * 2, 2.8, 2.6]));
    if (rng() < 0.8) bulbs.push(mat(new THREE.Vector3(p.x, p.y + 1.8, p.z), [0, 0, 0], [0.5, 0.5, 0.5]));
  }

  // Ferris wheels rise then spin up during transform — matches the
  // brief's "ferris wheels spin up" literally. A subset of bulbs chase-
  // activates in a SWEEP, then settles exactly back to base at the drop.
  const wheelBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -6, liftTo: -2 } },
    { phase: 'tension', archetype: 'RISE', params: { liftFrom: -2, liftTo: 1 } },
    { phase: 'drop', archetype: 'RISE', params: { liftFrom: 1, liftTo: 6 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 6, liftTo: 6, spinRate: 3.2 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 6, liftTo: 6 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 6, liftTo: 0 } },
  ];
  const wheelIndices = wheels.map((_, i) => i);
  // Spokes are the wheel's own rigid support beams (2 per wheel, pushed
  // right alongside it above) — they must rise/spin in exact lockstep
  // with `wheels` or the rim visibly detaches from its own crossbeams.
  // Same bindings, same group-relative timing, just a different matrices
  // array/group.
  const spokeIndices = spokes.map((_, i) => i);

  // Bulbs 0-39 are exactly the rim lights of wheels 0-3 (10 per wheel,
  // pushed immediately after each wheel above) — same lift/spin as
  // `wheelBindings` on every phase so they stay mounted on their rim,
  // plus their own chase-pattern scale flourish on tension/drop.
  const bulbEventIndices = bulbs.map((_, i) => i).filter((i) => i < 40);
  const bulbBindings: EventBinding[] = [
    { phase: 'buildup', archetype: 'RISE', params: { liftFrom: -6, liftTo: -2 } },
    { phase: 'tension', archetype: 'SWEEP', params: { liftFrom: -2, liftTo: 1, scaleFrom: 0.3, scaleTo: 1.4, stagger: 0.85 } },
    { phase: 'drop', archetype: 'ACTIVATE', params: { liftFrom: 1, liftTo: 6, scaleFrom: 1.4, scaleTo: 1.0 } },
    { phase: 'transform', archetype: 'RISE', params: { liftFrom: 6, liftTo: 6, spinRate: 3.2 } },
    { phase: 'reveal', archetype: 'RISE', params: { liftFrom: 6, liftTo: 6 } },
    { phase: 'aftermath', archetype: 'RISE', params: { liftFrom: 6, liftTo: 0 } },
  ];

  const groups: PropGroup[] = [
    {
      key: 'wheels',
      geometry: G.torusThick,
      toon: { color: '#ff5a3a', shadow: '#4a0a12', rim: '#ffd8a0', rimStrength: 0.8, emissive: 0.3 },
      matrices: wheels,
      reactive: { drums: 0.6, event: 2.2 },
      animated: createSignatureEventAnimated(wheels, wheelIndices, wheelBindings),
    },
    {
      key: 'spokes',
      geometry: G.box,
      toon: { color: '#a03a30', shadow: '#421512', rim: '#ffb090', rimStrength: 0.4 },
      matrices: spokes,
      animated: createSignatureEventAnimated(spokes, spokeIndices, wheelBindings),
    },
    { key: 'tents', geometry: G.cone8, toon: { color: '#e8434f', shadow: '#54183a', rim: '#ffd0c0', rimStrength: 0.55 }, matrices: tents },
    { key: 'booths', geometry: G.box, toon: { color: '#d0603f', shadow: '#48182a', rim: '#ffc8a0', rimStrength: 0.45 }, matrices: booths },
    {
      key: 'bulbs',
      geometry: G.sphere,
      toon: { color: '#ffe07a', shadow: '#a04a20', rim: '#fff8e0', rimStrength: 0.2, emissive: 0.72 },
      matrices: bulbs,
      reactive: { drums: 0.8, event: 2.4 },
      animated: createSignatureEventAnimated(bulbs, bulbEventIndices, bulbBindings),
    },
  ];
  return { groups, landmarkPositions };
}

// ---------------------------------------------------------------------------

export const WORLD_DEFINITIONS: WorldDefinition[] = [
  {
    id: 'cyberpunkNightWorld',
    name: 'Cyberpunk Night',
    seed: 1337,
    sky: {
      zenith: '#08051c', mid: '#2a0a52', horizon: '#6a1060',
      celestialColor: '#ff6ad5', celestialDir: [0.2, 0.12, -0.9], celestialSize: 0.002, celestialHalo: 1.4,
      bandMode: 1, bandLit: '#7a2fd0', bandDark: '#12062e', bandStrength: 0.55, exposure: 0.95,
    },
    fog: { color: '#2a0f4a', near: 60, far: 260 },
    ambient: { color: '#8f7aff', intensity: 0.6 },
    path: { halfWidth: 5.5, colorA: '#28e6ff', colorB: '#0b0a1e', glow: '#ff3fa8', style: 2 },
    particles: { color: '#9fd8ff', count: 260, size: 0.09, motion: 0, spread: 60, height: 30, opacity: 0.35 },
    outline: { width: 0.16, color: '#08040f' },
    build: buildCyberpunk,
    obstacleKeys: ['towers'],
  },
  {
    id: 'desertDreamWorld',
    name: 'Desert Dream',
    seed: 2242,
    // Reworked to a TWILIGHT desert — deep violet zenith with early stars,
    // a burning ember horizon, a low fat sun. A clean break from the flat
    // orange midday look it kept reverting to.
    sky: {
      zenith: '#1a0838', mid: '#7a1a48', horizon: '#ff7a3a',
      celestialColor: '#ffb36a', celestialDir: [0.12, 0.05, -0.95], celestialSize: 0.05, celestialHalo: 2.0,
      bandMode: 3, bandLit: '#c86a8a', bandDark: '#0a0420', bandStrength: 0.4, exposure: 1.12,
    },
    fog: { color: '#8a3a4a', near: 80, far: 360 },
    ambient: { color: '#ffc0a0', intensity: 0.8 },
    // Dark reddish packed-clay road — a hard value drop from the pale sand
    // floor so you always see exactly where the walkway is.
    path: { halfWidth: 5.0, colorA: '#8a4630', colorB: '#4a2418', glow: '#ffcf7a', style: 1 },
    particles: { color: '#ffd8b0', count: 300, size: 0.07, motion: 2, spread: 70, height: 16, opacity: 0.34 },
    outline: { width: 0.17, color: '#2a0c1e' },
    build: buildDesert,
    obstacleKeys: ['pyramids', 'mesas', 'arches', 'stones', 'rocks'],
    // Flat route: no rises/dips, so a prop placed beside one stretch can't
    // clip the runner where the loop folds back at a different height.
    flatRoute: true,
  },
  {
    id: 'underwaterAbyssWorld',
    name: 'Underwater Abyss',
    seed: 3352,
    sky: {
      zenith: '#041a3a', mid: '#0a4a86', horizon: '#1e86c0',
      celestialColor: '#dff6ff', celestialDir: [0.15, 0.85, -0.4], celestialSize: 0.012, celestialHalo: 1.8,
      bandMode: 4, bandLit: '#7fd8ff', bandDark: '#05203f', bandStrength: 0.5, exposure: 1.05,
    },
    fog: { color: '#155a8a', near: 72, far: 270 },
    ambient: { color: '#9fd8ff', intensity: 0.75 },
    path: { halfWidth: 5.2, colorA: '#4a8aa6', colorB: '#1c4260', glow: '#bff0ff', style: 1 },
    particles: { color: '#d8f6ff', count: 240, size: 0.1, motion: 1, spread: 50, height: 34, opacity: 0.35 },
    outline: { width: 0.16, color: '#04162c' },
    build: buildAbyss,
    obstacleKeys: ['whales', 'columns', 'blocks'],
  },
  {
    id: 'outerDimensionWorld',
    name: 'Outer Dimension',
    seed: 4462,
    sky: {
      zenith: '#050318', mid: '#2a0a5a', horizon: '#5a1a8a',
      celestialColor: '#c89aff', celestialDir: [0.42, 0.34, -0.8], celestialSize: 0.055, celestialHalo: 1.2,
      bandMode: 3, bandLit: '#8f5cff', bandDark: '#0a0520', bandStrength: 0.8, exposure: 1.0,
    },
    fog: { color: '#2a1050', near: 80, far: 340 },
    ambient: { color: '#c0a0ff', intensity: 0.7 },
    path: { halfWidth: 4.6, colorA: '#b06cff', colorB: '#0d0724', glow: '#ff6ad5', style: 2 },
    particles: { color: '#e0d0ff', count: 260, size: 0.08, motion: 2, spread: 70, height: 40, opacity: 0.4 },
    outline: { width: 0.15, color: '#0b0620' },
    build: buildOuter,
    obstacleKeys: ['rings', 'rocks'],
  },
  {
    id: 'ps2NightWorld',
    name: 'PS2 Night',
    seed: 5572,
    sky: {
      zenith: '#080a24', mid: '#241a52', horizon: '#5a3a7a',
      celestialColor: '#e8dcff', celestialDir: [0.35, 0.42, -0.82], celestialSize: 0.045, celestialHalo: 1.1,
      bandMode: 1, bandLit: '#6a5a9a', bandDark: '#120e2a', bandStrength: 0.45, exposure: 0.9,
    },
    fog: { color: '#241f4a', near: 70, far: 300 },
    ambient: { color: '#9fa8e0', intensity: 0.6 },
    path: { halfWidth: 5.4, colorA: '#3a3a52', colorB: '#22223a', glow: '#ffcf7a', style: 1 },
    particles: { color: '#ffe9a8', count: 150, size: 0.09, motion: 2, spread: 45, height: 14, opacity: 0.35 },
    outline: { width: 0.15, color: '#0a0a1c' },
    build: buildPs2,
    obstacleKeys: ['houses', 'canopies', 'roofs'],
  },
  {
    id: 'fantasyForestWorld',
    name: 'Fantasy Forest',
    seed: 6682,
    sky: {
      zenith: '#0d3a5a', mid: '#2f8a7a', horizon: '#c8f0a0',
      celestialColor: '#fffbd0', celestialDir: [0.3, 0.5, -0.8], celestialSize: 0.016, celestialHalo: 1.5,
      bandMode: 2, bandLit: '#eaffb0', bandDark: '#123a2a', bandStrength: 0.5, exposure: 1.1,
    },
    fog: { color: '#458a68', near: 90, far: 330 },
    ambient: { color: '#d8ffc0', intensity: 0.8 },
    path: { halfWidth: 4.8, colorA: '#9a7a4e', colorB: '#586a40', glow: '#bfff8a', style: 1 },
    particles: { color: '#eaffb0', count: 240, size: 0.09, motion: 2, spread: 55, height: 26, opacity: 0.4 },
    outline: { width: 0.16, color: '#0f2a1e' },
    build: buildForest,
    obstacleKeys: ['caps', 'trunks', 'canopies'],
  },
  {
    id: 'abstractVoidWorld',
    name: 'Abstract Void',
    seed: 7792,
    sky: {
      zenith: '#000000', mid: '#0a0418', horizon: '#1a0a2e',
      celestialSize: 0,
      bandMode: 3, bandLit: '#3a1060', bandDark: '#000000', bandStrength: 0.5, exposure: 0.9,
    },
    fog: { color: '#0a0414', near: 60, far: 300 },
    ambient: { color: '#ffffff', intensity: 0.45 },
    path: { halfWidth: 4.2, colorA: '#28e6ff', colorB: '#05030c', glow: '#ff3fc8', style: 2 },
    particles: { color: '#ffffff', count: 300, size: 0.07, motion: 2, spread: 70, height: 40, opacity: 0.5 },
    outline: { width: 0.14, color: '#000000' },
    build: buildVoid,
    // No obstacleKeys: Abstract Void's geometry is small scattered solids
    // plus hollow rings the path is meant to thread straight through — a
    // camera clipping one reads as intentional, not a bug.
  },
  {
    id: 'chaoticCarnivalWorld',
    name: 'Chaotic Carnival',
    seed: 8892,
    sky: {
      zenith: '#1a0410', mid: '#8a1a20', horizon: '#ff8a3a',
      celestialColor: '#ffd06a', celestialDir: [0.25, 0.2, -0.9], celestialSize: 0.006, celestialHalo: 1.5,
      bandMode: 1, bandLit: '#ff7a3a', bandDark: '#3a0810', bandStrength: 0.75, exposure: 1.08,
    },
    fog: { color: '#8a2c1e', near: 76, far: 290 },
    ambient: { color: '#ffb090', intensity: 0.75 },
    path: { halfWidth: 5.6, colorA: '#9a5644', colorB: '#5c2a1e', glow: '#ffd23f', style: 1 },
    particles: { color: '#ffb04a', count: 280, size: 0.1, motion: 1, spread: 55, height: 32, opacity: 0.45 },
    outline: { width: 0.16, color: '#1a0408' },
    build: buildCarnival,
    obstacleKeys: ['wheels', 'tents', 'booths'],
  },
];
