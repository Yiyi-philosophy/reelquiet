// ReelQuiet — "Recent memories" (V-MEM, D14, D-T3).
//
// D14 fixed the scope: read-only, newest first, at most 20 entries, no
// arguments, no paging, no search, no filtering, no deleting, no export. The
// title is "Recent memories" — `log` is not a product concept.
//
// V-MEM: one line per record, a fixed field order, and a count in the header
// only when it can be counted cheaply and correctly (`N of M`); otherwise
// `latest N`. The empty state is gentle and accurate.
//
// D12: every field printed here is on the local allowlist. The event is looked
// up through a `Record<ControlledEventType, string>`, so no free text can
// reach a line even in principle.

import { EMPTY_MEMORIES_LINE } from '../core/memory.ts'
import { recentMemories, type CatchRecord } from '../core/records.ts'
import { isRareTier, type ControlledEventType } from '../core/types.ts'
import {
  displayName,
  hourMinuteText,
  monthDayText,
  rarityLabel,
  sizeText,
} from './model.ts'

export const MEMORIES_TITLE = 'Recent memories'

/** Two spaces between fields — the spec's own column rhythm. */
export const FIELD_SEPARATOR = '  '

/** D12: the controlled event enum as a short, column-sized phrase. */
const EVENT_COLUMN: Readonly<Record<ControlledEventType, string>> = {
  'tests-green': 'tests turned green',
  edit: 'edit',
  'tool-call': 'tool call',
  'turn-complete': 'turn complete',
  'turn-start': 'turn start',
  'session-reset': 'session reset',
  unknown: 'working',
}

export type MemoryOptions = {
  /**
   * Total number of records held, when it is cheap and correct to know. Present
   * → `N of M`; absent → `latest N` (V-MEM).
   */
  total?: number
  /** Columns available, for the F-MEM-NARROW degradation. */
  columns: number
}

/**
 * The whole output of `/reelquiet log`, header first, as bare `ui.log` lines.
 */
export function recentMemoryLines(
  records: readonly CatchRecord[],
  opts: MemoryOptions,
): string[] {
  const shown = recentMemories(records)
  if (shown.length === 0) return [MEMORIES_TITLE, EMPTY_MEMORIES_LINE]

  const columns = Number.isFinite(opts.columns) ? Math.floor(opts.columns) : 0
  return [header(shown.length, opts.total), ...shown.map((record) => memoryLine(record, columns))]
}

function header(shown: number, total?: number): string {
  if (total == null) return `${MEMORIES_TITLE} · latest ${shown}`
  return `${MEMORIES_TITLE} · ${shown} of ${total}`
}

/**
 * One record, fields in the V-MEM order: date time, [★] species, rarity label,
 * size (caught only), caught|sighted, generalized event, repo, basenames.
 *
 * F-MEM-MISSING-FIELDS: an absent repo or basename is left out, never replaced
 * by a placeholder. F-MEM-NARROW: when the line will not fit, the basenames go
 * first and the repo second; species, status and rarity always stay.
 */
export function memoryLine(record: CatchRecord, columns: number): string {
  const full = compose(record, true, true)
  if (columns <= 0 || full.length <= columns) return full

  const withoutFiles = compose(record, true, false)
  if (withoutFiles.length <= columns) return withoutFiles

  return compose(record, false, false)
}

function compose(record: CatchRecord, repo: boolean, files: boolean): string {
  const label = rarityLabel(record.rarity)
  const star = isRareTier(record.rarity) ? '★ ' : ''

  const parts: string[] = [
    `${monthDayText(record.timestamp)} ${hourMinuteText(record.timestamp)}`,
    `${star}${displayName(record.species)}`,
  ]
  if (label.length > 0) parts.push(label)
  if (record.outcome === 'caught') parts.push(sizeText(record.size_cm))
  parts.push(record.outcome)
  parts.push(EVENT_COLUMN[record.event_type] ?? EVENT_COLUMN.unknown)
  if (repo && record.repo.length > 0) parts.push(record.repo)
  if (files) for (const basename of record.files) parts.push(basename)

  return parts.join(FIELD_SEPARATOR)
}
