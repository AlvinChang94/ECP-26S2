// What: a small seeded random-number generator, so the sample data is identical on every run.
// Who calls it: the sample-data generator modules in this folder.
// To extend: create one generator per data set with its own seed text; never use Math.random() in generators.

export type Rng = {
  /** A number from 0 (inclusive) to 1 (exclusive). */
  next(): number;
  /** A whole number from min to max, both inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean;
};

/** Turns a seed text into a 32-bit number (FNV-1a hash). */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: tiny, fast and good enough for test data. The same seed always gives the same sequence. */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (probability) => next() < probability,
  };
}
