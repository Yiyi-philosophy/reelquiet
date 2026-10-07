// ReelQuiet — which real species just bit.
//
// Pure: everything that varies comes from the injected seeded Rng and the ctx.
//
// D2: Stage 1 has no bait numbers and no inventory. The `bait` parameter exists
//     only to hold the shape of the frozen semantic contract; `'none'` is the
//     only legal value and anything else throws.
// D9: a rare+ encounter needs all three of an active coding context, remaining
//     daily budget, and the RNG. The budget is a SOFT cap — see the note on
//     `rareGateOpen`.

import { depthForWait, timeOfDayForHour, type PondParams, type TimeOfDay } from './params.ts'
import type { Rng } from './rng.ts'
import { isRareTier, type DepthZone, type Species, type Tier } from './types.ts'

/** D2: Stage 1 has exactly one legal bait value. */
export type Bait = 'none'

export type LootCtx = {
  species: readonly Species[]
  params: PondParams
  /** Simulated wait on this cast, in ms — this is what sets the depth. */
  waitMs: number
  /** Injected hour of day (0-23). Never read from a clock in here. */
  hourOfDay: number
  bait?: Bait
  /** D9 ①: the main agent's turn is live and has had a tool call or model request. */
  codingContextActive: boolean
  /** D9 ②: how many rare+ encounters today's keys already show. */
  todayRareCount: number
}

export type LootRoll = {
  species: Species
  tier: Tier
  sizeCm: number
  depthZone: DepthZone
  timeOfDay: TimeOfDay
  /** Whether the rare gate was open on this roll (useful for debug effects). */
  rareAllowed: boolean
}

export class InvalidBaitError extends RangeError {}

/**
 * D9's three-part gate.
 *
 * SOFT CAP: the plugin store has no CAS and no atomic lease (F4), and `todayRareCount`
 * is a plain number read before the write. With N concurrent sessions the day's
 * total can overshoot the budget, and per O4 there is **no upper bound** on the
 * overshoot — more sessions means more overshoot. The budget is a target, not a
 * guarantee, and nothing here tries to lock.
 */
export function rareGateOpen(rng: Rng, ctx: LootCtx): boolean {
  const withinBudget = ctx.todayRareCount < ctx.params.dailyRareBudget
  const hasContext = ctx.codingContextActive === true
  // The draw happens unconditionally so that the RNG stream does not depend on
  // the gate's other two inputs: same seed, same sequence, every time.
  const lucky = rng.next() < ctx.params.rareEncounterChance
  return hasContext && withinBudget && lucky
}

/** Species that are both at this depth and active at this time of day. */
export function candidates(
  species: readonly Species[],
  depthZone: DepthZone,
  timeOfDay: TimeOfDay,
  rareAllowed: boolean,
): Species[] {
  return species.filter((s) => {
    if (s.depth_zone !== depthZone) return false
    if (s.activity === 'diurnal' && timeOfDay !== 'day') return false
    if (s.activity === 'nocturnal' && timeOfDay !== 'night') return false
    if (isRareTier(s.rarity) && !rareAllowed) return false
    return true
  })
}

/**
 * Roll for a bite.
 *
 * Returns `null` when nothing in the pond fits the current depth, time of day
 * and rare gate. The caller keeps waiting (and sinking deeper) rather than
 * inventing a fish that does not belong there.
 */
export function roll(rng: Rng, ctx: LootCtx): LootRoll | null {
  assertBait(ctx.bait)

  const depthZone = depthForWait(ctx.params, ctx.waitMs)
  const timeOfDay = timeOfDayForHour(ctx.params, ctx.hourOfDay)
  const rareAllowed = rareGateOpen(rng, ctx)

  const pool = candidates(ctx.species, depthZone, timeOfDay, rareAllowed)
  if (pool.length === 0) return null

  const species = weightedPick(rng, pool, ctx.params)
  if (!species) return null

  return {
    species,
    tier: species.rarity,
    sizeCm: rollSize(rng, species),
    depthZone,
    timeOfDay,
    rareAllowed,
  }
}

export function assertBait(bait: Bait | undefined): void {
  if (bait === undefined || bait === 'none') return
  throw new InvalidBaitError(`bait must be 'none' in Stage 1 (got ${JSON.stringify(bait)})`)
}

function weightedPick(rng: Rng, pool: readonly Species[], params: PondParams): Species | undefined {
  let total = 0
  for (const s of pool) total += weightOf(s.rarity, params)
  if (!(total > 0)) return pool[0]

  let r = rng.next() * total
  for (const s of pool) {
    r -= weightOf(s.rarity, params)
    if (r < 0) return s
  }
  return pool[pool.length - 1]
}

function weightOf(tier: Tier, params: PondParams): number {
  const w = params.tierWeights[tier]
  return Number.isFinite(w) && w > 0 ? w : 0
}

/** Triangular distribution over (min, typical, max), rounded to 0.1 cm. */
export function rollSize(rng: Rng, species: Species): number {
  const { min, max } = species.size_cm
  if (!(max > min)) return round1(min)

  const mode = Math.min(Math.max(species.size_cm.typical, min), max)
  const u = rng.next()
  const span = max - min
  const left = (mode - min) / span
  const raw =
    u < left
      ? min + Math.sqrt(u * span * (mode - min))
      : max - Math.sqrt((1 - u) * span * (max - mode))
  return round1(Math.min(Math.max(raw, min), max))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
