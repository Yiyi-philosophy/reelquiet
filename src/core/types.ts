// ReelQuiet — shared pure data types for src/core.
//
// Nothing in src/** may touch the host API, timers, wall-clock reads, unseeded
// randomness or I/O. Time always arrives as an injected `now: number` (epoch ms).

/** D-RARITY: four tiers. "rare tier" / 稀有档 means `tier >= rare`. */
export type Tier = 'common' | 'uncommon' | 'rare' | 'legendary'

export const TIER_ORDER: readonly Tier[] = ['common', 'uncommon', 'rare', 'legendary']

/** True for D-RARITY's 稀有档 (`tier >= rare`): the tiers that need a manual reel. */
export function isRareTier(tier: Tier): boolean {
  return tier === 'rare' || tier === 'legendary'
}

/** Real ocean depth layers. Depth is reached by waiting (see params.depthByWait). */
export type DepthZone = 'epipelagic' | 'mesopelagic' | 'bathypelagic'

export const DEPTH_ZONES: readonly DepthZone[] = ['epipelagic', 'mesopelagic', 'bathypelagic']

/** Real diel activity. Stage 1 keeps the vocabulary to the two documented values. */
export type Activity = 'diurnal' | 'nocturnal'

/** D10 controlled vocabulary. Biology only — no bait, affinity or game numbers. */
export type DietTag =
  | 'small-crustaceans'
  | 'insects'
  | 'plankton'
  | 'small-fish'
  | 'cephalopods'
  | 'algae'
  | 'detritus'

export const DIET_TAGS: readonly DietTag[] = [
  'small-crustaceans',
  'insects',
  'plankton',
  'small-fish',
  'cephalopods',
  'algae',
  'detritus',
]

/**
 * D10: `diet` is optional and biology-only.
 *
 * Missing and empty mean different things: no `diet` key means "not researched
 * yet"; `tags: []` is invalid (never use it to mean unknown).
 */
export type Diet = {
  tags: DietTag[]
  source_refs: string[]
  note?: string
}

/** Size distribution in centimetres. */
export type SizeCm = {
  min: number
  typical: number
  max: number
}

/** D-SPECIES: real species only. No game numbers live in here (D10). */
export type Species = {
  id: string
  common_name: string
  scientific_name: string
  size_cm: SizeCm
  depth_zone: DepthZone
  activity: Activity
  rarity: Tier
  source_refs: string[]
  diet?: Diet
}

/** D12 controlled event-type enum. Never free text. */
export type ControlledEventType =
  | 'tests-green'
  | 'edit'
  | 'tool-call'
  | 'turn-complete'
  | 'turn-start'
  | 'session-reset'
  | 'unknown'

export const CONTROLLED_EVENT_TYPES: readonly ControlledEventType[] = [
  'tests-green',
  'edit',
  'tool-call',
  'turn-complete',
  'turn-start',
  'session-reset',
  'unknown',
]

/** A catch either landed or got away (D-SIGHT). */
export type Outcome = 'caught' | 'sighted'

/**
 * Pure UTC date string (YYYY-MM-DD) from epoch ms, by integer arithmetic only.
 *
 * Days are keyed in UTC so that two sessions on the same machine agree without
 * reading a timezone. `register.ts` may override the date it passes in.
 */
export function utcDateOf(now: number): string {
  const days = Math.floor(now / 86400000)
  // 1970-01-01 is day 0. Shift to a March-based civil calendar (Howard Hinnant).
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const year = m <= 2 ? y + 1 : y
  return `${pad(year, 4)}-${pad(m, 2)}-${pad(d, 2)}`
}

/** Pure UTC hour-of-day (0-23) from epoch ms. */
export function utcHourOf(now: number): number {
  const msOfDay = now - Math.floor(now / 86400000) * 86400000
  return Math.floor(msOfDay / 3600000)
}

function pad(n: number, width: number): string {
  let s = String(Math.abs(n))
  while (s.length < width) s = `0${s}`
  return n < 0 ? `-${s}` : s
}
