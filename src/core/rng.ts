// ReelQuiet — seeded PRNG (mulberry32).
//
// No unseeded randomness anywhere in src/**. Every draw is reproducible from a
// seed, and the seed state is a plain number so plugin state can hold it.

export type Rng = {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [0, n). Returns 0 for n <= 0. */
  nextInt(n: number): number
  /** Uniform float in [lo, hi). Returns lo when hi <= lo. */
  nextFloat(lo: number, hi: number): number
  /** Pick one item, or undefined for an empty list. Does not mutate the list. */
  pick<T>(items: readonly T[]): T | undefined
  /** Current internal state, safe to persist and restore. */
  state(): number
}

const MASK = 0xffffffff

export function normalizeSeed(seed: number): number {
  // Keep it a non-negative 32-bit integer, tolerating floats and negatives.
  return (Math.floor(seed) % 4294967296 + 4294967296) % 4294967296
}

/** mulberry32: tiny, fast, good enough for a fish pond, and fully deterministic. */
export function createRng(seed: number): Rng {
  let s = normalizeSeed(seed)

  const next = (): number => {
    s = (s + 0x6d2b79f5) & MASK
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    next,
    nextInt(n: number): number {
      if (!(n > 0)) return 0
      return Math.floor(next() * n)
    },
    nextFloat(lo: number, hi: number): number {
      if (!(hi > lo)) return lo
      return lo + next() * (hi - lo)
    },
    pick<T>(items: readonly T[]): T | undefined {
      if (items.length === 0) return undefined
      return items[Math.floor(next() * items.length)]
    },
    state(): number {
      return s
    },
  }
}

/**
 * xfnv1a string hash — turns a session id or repo name into a stable seed.
 * Deterministic across runs and machines.
 */
export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Derive an independent stream from a seed plus a label (no shared mutable state). */
export function deriveRng(seed: number, label: string): Rng {
  return createRng((normalizeSeed(seed) ^ hashSeed(label)) >>> 0)
}
