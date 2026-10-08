// ReelQuiet — `v1:` keys, the CatchRecord allowlist and the public card.
//
// D1: every key carries the `v1:` prefix and every record an explicit
//     `schema_version`.
// D12: the local record may only hold allowlisted fields; the shareable card is
//     a separate schema produced by allowlist *projection*, never by redacting
//     a local record.

import { DEFAULT_PARAMS, type PondParams } from './params.ts'
import { publicEventPhrase } from './memory.ts'
import {
  CONTROLLED_EVENT_TYPES,
  TIER_ORDER,
  utcDateOf,
  type ControlledEventType,
  type Outcome,
  type Tier,
} from './types.ts'

export const SCHEMA_VERSION = 1 as const

/** D12 allowlist. Exactly these fields, nothing else. */
export type CatchRecord = {
  schema_version: typeof SCHEMA_VERSION
  species: string
  size_cm: number
  rarity: Tier
  outcome: Outcome
  timestamp: number
  event_type: ControlledEventType
  repo: string
  files: string[]
}

/** The separate share schema (D12). Carries no repo, file, path, command or prompt. */
export type PublicCatchCard = {
  schema_version: typeof SCHEMA_VERSION
  species: string
  size_cm: number
  rarity: Tier
  date: string
  event: string
}

/**
 * D9: one append-only key per rare+ encounter, used to count the day's soft
 * budget. Deliberately tiny — it is a counter, not a memory.
 */
export type RareEncounterRecord = {
  schema_version: typeof SCHEMA_VERSION
  species: string
  rarity: Tier
  timestamp: number
}

export const CATCH_RECORD_FIELDS: readonly string[] = [
  'schema_version',
  'species',
  'size_cm',
  'rarity',
  'outcome',
  'timestamp',
  'event_type',
  'repo',
  'files',
]

export const PUBLIC_CARD_FIELDS: readonly string[] = [
  'schema_version',
  'species',
  'size_cm',
  'rarity',
  'date',
  'event',
]

// ---------------------------------------------------------------- key space

export const KEY_PREFIX = 'v1:'

/** `v1:c:<session>:<seq>` — a catch. */
export function catchKey(sessionId: string, seq: number): string {
  return `${KEY_PREFIX}c:${keySegment(sessionId)}:${seqSegment(seq)}`
}

/** `v1:s:<session>:<seq>` — a sighting (D-SIGHT). */
export function sightingKey(sessionId: string, seq: number): string {
  return `${KEY_PREFIX}s:${keySegment(sessionId)}:${seqSegment(seq)}`
}

/** `v1:e:<date>:<session>:<seq>` — a rare encounter, for the daily budget (D9). */
export function encounterKey(date: string, sessionId: string, seq: number): string {
  return `${KEY_PREFIX}e:${keySegment(date)}:${keySegment(sessionId)}:${seqSegment(seq)}`
}

/** Prefix to count a day's rare encounters with `keys()` (D9). */
export function encounterDatePrefix(date: string): string {
  return `${KEY_PREFIX}e:${keySegment(date)}:`
}

/** `v1:p:<name>` — a preference or one-shot flag (R3-10). Never compacted. */
export function prefKey(name: string): string {
  return `${KEY_PREFIX}p:${keySegment(name)}`
}

/** The key a record belongs under, chosen by its outcome. */
export function recordKey(record: CatchRecord, sessionId: string, seq: number): string {
  return record.outcome === 'caught' ? catchKey(sessionId, seq) : sightingKey(sessionId, seq)
}

function keySegment(value: string): string {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '-')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'unknown'
}

function seqSegment(seq: number): string {
  const n = Number(seq)
  return String(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)
}

// ------------------------------------------------------------ record builder

export type RecordInput = Readonly<Record<string, unknown>>

/**
 * Build a CatchRecord by allowlist.
 *
 * Anything outside the allowlist is dropped; everything inside is clamped,
 * enum-checked or reduced to a basename. No field accepts free text: the three
 * string fields that are not enums (`species`, `repo`, `files[]`) are stripped
 * of directory parts and of every character outside `[A-Za-z0-9._-]`, so a
 * command line, a prompt or an absolute path cannot survive as prose.
 */
export function makeRecord(input: RecordInput, params: PondParams = DEFAULT_PARAMS): CatchRecord {
  return {
    schema_version: SCHEMA_VERSION,
    species: identifier(input.species, 64, 'unknown'),
    size_cm: sizeCm(input.size_cm),
    rarity: oneOf(input.rarity, TIER_ORDER, 'common'),
    // A record with an unreadable outcome settles as a sighting: never a reward.
    outcome: oneOf(input.outcome, ['caught', 'sighted'] as const, 'sighted'),
    timestamp: timestamp(input.timestamp),
    event_type: oneOf(input.event_type, CONTROLLED_EVENT_TYPES, 'unknown'),
    repo: identifier(input.repo, params.maxFileBasenameChars, ''),
    files: basenames(input.files, params),
  }
}

export function makeEncounterRecord(input: RecordInput): RareEncounterRecord {
  return {
    schema_version: SCHEMA_VERSION,
    species: identifier(input.species, 64, 'unknown'),
    rarity: oneOf(input.rarity, TIER_ORDER, 'rare'),
    timestamp: timestamp(input.timestamp),
  }
}

/**
 * D12: projection, not redaction. The card is assembled field by field from the
 * allowlist, so a field added to CatchRecord later cannot leak into a card.
 */
/** `offsetMinutes`: the viewer's UTC offset (east positive), injected by register; 0 = UTC. */
export function toPublicCard(record: CatchRecord, offsetMinutes = 0): PublicCatchCard {
  return {
    schema_version: SCHEMA_VERSION,
    species: record.species,
    size_cm: record.size_cm,
    rarity: record.rarity,
    date: utcDateOf(record.timestamp + offsetMinutes * 60000),
    event: publicEventPhrase(record.event_type),
  }
}

/**
 * D14: the "Recent memories" probe — newest first, capped, read-only.
 * Pure: the input array is never mutated.
 */
export function recentMemories(
  records: readonly CatchRecord[],
  n: number = DEFAULT_PARAMS.recentMemoriesLimit,
): CatchRecord[] {
  const limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => b.record.timestamp - a.record.timestamp || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.record)
}

// ----------------------------------------------------------------- clamping

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function sizeCm(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.min(n, 100000) * 10) / 10
}

function timestamp(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/** Last path segment only, then identifier-safe, then clamped. */
export function basename(value: unknown): string {
  if (typeof value !== 'string') return ''
  const segments = value.split(/[/\\]/)
  return segments[segments.length - 1] ?? ''
}

function identifier(value: unknown, maxChars: number, fallback: string): string {
  const cleaned = basename(value).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned.length === 0) return fallback
  return cleaned.slice(0, Math.max(1, Math.floor(maxChars)))
}

function basenames(value: unknown, params: PondParams): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const name = identifier(entry, params.maxFileBasenameChars, '')
    if (name.length === 0 || out.includes(name)) continue
    out.push(name)
    if (out.length >= params.maxFileBasenames) break
  }
  return out
}
