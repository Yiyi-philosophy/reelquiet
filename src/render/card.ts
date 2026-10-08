// ReelQuiet — the Catch Card and the sighting line (V-CARD, D-T3).
//
// V-CARD: three borderless `ui.log` lines for a rare+ catch, one line for a
// rare+ sighting, nothing at all for common and uncommon. The lines are built
// from `toPublicCard(record)` — the D12 *projection*, not a redacted record —
// plus the species' public common and scientific names. Types alone make a
// repo, a path, a command or a prompt unreachable from here.
//
// The `● reelquiet: ` prefix belongs to `ui.log`; these are bare lines.

import { toPublicCard, type CatchRecord } from '../core/records.ts'
import { isRareTier, type Species } from '../core/types.ts'
import { displayName, rarityLabel, sizeText } from './model.ts'

/**
 * The transcript lines for one settled encounter.
 *
 * - rare+ caught   → 3 lines (F-CARD-RARE / F-CARD-LEGENDARY)
 * - rare+ sighted  → 1 line  (F-LOG-SIGHTED-RARE)
 * - anything else  → no lines at all ("common/uncommon 的结果：不写 transcript")
 */
export function catchCardLines(
  record: CatchRecord,
  species?: Species | null,
  offsetMinutes = 0,
): string[] {
  if (!isRareTier(record.rarity)) return []

  const card = toPublicCard(record, offsetMinutes)
  const label = rarityLabel(card.rarity)
  const name = displayName(species?.common_name ?? card.species)

  if (record.outcome === 'sighted') {
    return [`${label} sighting · ${name} · slipped away · ${card.date}`]
  }

  const scientific = species?.scientific_name ?? ''
  const size = sizeText(card.size_cm)
  return [
    `★ ${label} CATCH · ${name}`,
    scientific.length > 0 ? `${scientific} · ${size}` : size,
    `${card.event} · ${card.date}`,
  ]
}

/** Find a species by id without reaching for the data module. */
export function lookupSpecies(species: readonly Species[], id: string): Species | undefined {
  return species.find((entry) => entry.id === id)
}

export type EmitOnce = {
  /** The updated "already written" set, newest last. Never the same array. */
  seen: string[]
  emit: boolean
}

/**
 * V-RESULT: "只有 rare 及以上的结果会写入 transcript，每个事件只写一组."
 *
 * Pure dedupe by event id: the first call for an id reports `emit: true` and
 * remembers it, every later call reports `false`. The caller owns the set, so a
 * hot reload simply restores it from the plugin's own state.
 */
export function emitOnce(seenIds: readonly string[], eventId: string): EmitOnce {
  const id = String(eventId)
  if (seenIds.includes(id)) return { seen: [...seenIds], emit: false }
  return { seen: [...seenIds, id], emit: true }
}

export type EmittedCard = {
  seen: string[]
  lines: string[]
}

/**
 * F-RESULT-DEDUPE: lines come back only for an event id that has not been
 * written before. A result that produces no lines is not remembered either,
 * so the set only ever grows by things actually written.
 */
export function emitCatchCard(
  seenIds: readonly string[],
  eventId: string,
  record: CatchRecord,
  species?: Species | null,
  offsetMinutes = 0,
): EmittedCard {
  const lines = catchCardLines(record, species, offsetMinutes)
  if (lines.length === 0) return { seen: [...seenIds], lines: [] }

  const gate = emitOnce(seenIds, eventId)
  return { seen: gate.seen, lines: gate.emit ? lines : [] }
}
