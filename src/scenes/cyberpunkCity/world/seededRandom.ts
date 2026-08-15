/**
 * Deterministic PRNG (mulberry32). The same seed always produces the same
 * sequence, which is what lets the whole world (route + buildings +
 * landmarks) be reproducible from a single number — matters for "Generate
 * Visual" reproducibility, seeds, and sharing later.
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
