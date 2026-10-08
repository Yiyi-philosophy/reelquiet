// ReelQuiet — hand-written validators. No dependencies, no JSON Schema runtime.
//
// D10: `species` records biology only. Any bait name, affinity, probability,
//      multiplier or other game number is rejected by name as well as by the
//      `additionalProperties: false` rule.
// D12: `CatchRecord` and `PublicCatchCard` are both closed schemas, and the card
//      is its own schema rather than a trimmed record.

import {
  CATCH_RECORD_FIELDS,
  PUBLIC_CARD_FIELDS,
  SCHEMA_VERSION,
  type CatchRecord,
  type PublicCatchCard,
} from './records.ts'
import {
  CONTROLLED_EVENT_TYPES,
  DEPTH_ZONES,
  DIET_TAGS,
  TIER_ORDER,
  type Species,
} from './types.ts'

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

export const SPECIES_FIELDS: readonly string[] = [
  'id',
  'common_name',
  'scientific_name',
  'size_cm',
  'depth_zone',
  'activity',
  'rarity',
  'source_refs',
  'diet',
]

export const DIET_FIELDS: readonly string[] = ['tags', 'source_refs', 'note']

/**
 * Field names that must never appear in species data, at any depth (D10).
 * Game numbers belong in `src/core/params.ts`, never in the biology.
 */
export const FORBIDDEN_SPECIES_FIELDS: readonly string[] = [
  'bait',
  'baits',
  'bait_affinity',
  'affinity',
  'probability',
  'prob',
  'weight',
  'weights',
  'rarity_multiplier',
  'multiplier',
  'catch_rate',
  'catch_chance',
  'chance',
  'odds',
  'spawn_rate',
  'drop_rate',
  'score',
  'points',
  'xp',
  'value',
]

const SIZE_FIELDS: readonly string[] = ['min', 'typical', 'max']
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const BINOMIAL_PATTERN = /^[A-Z][a-z]+ [a-z][a-z-]+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BASENAME_PATTERN = /^[A-Za-z0-9._-]+$/

// ------------------------------------------------------------------ species

export function validateSpecies(value: unknown, path = 'species'): ValidationResult {
  const errors: string[] = []
  const obj = asObject(value, path, errors)
  if (!obj) return fail(errors)

  collectForbidden(obj, path, errors)
  collectUnknown(obj, SPECIES_FIELDS, path, errors)

  requireString(obj.id, `${path}.id`, errors, ID_PATTERN)
  requireString(obj.common_name, `${path}.common_name`, errors)
  requireString(obj.scientific_name, `${path}.scientific_name`, errors, BINOMIAL_PATTERN)
  requireEnum(obj.depth_zone, DEPTH_ZONES, `${path}.depth_zone`, errors)
  requireEnum(obj.activity, ['diurnal', 'nocturnal'], `${path}.activity`, errors)
  requireEnum(obj.rarity, TIER_ORDER, `${path}.rarity`, errors)
  requireSourceRefs(obj.source_refs, `${path}.source_refs`, errors)
  validateSize(obj.size_cm, `${path}.size_cm`, errors)

  if ('diet' in obj && obj.diet !== undefined) validateDiet(obj.diet, `${path}.diet`, errors)

  return errors.length === 0 ? { ok: true } : fail(errors)
}

export function validateSpeciesList(value: unknown): ValidationResult {
  const errors: string[] = []
  if (!Array.isArray(value)) return fail(['species list must be an array'])
  if (value.length === 0) errors.push('species list must not be empty')

  const ids = new Set<string>()
  value.forEach((entry, index) => {
    const result = validateSpecies(entry, `species[${index}]`)
    if (!result.ok) errors.push(...result.errors)
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id === 'string') {
      if (ids.has(id)) errors.push(`species[${index}].id duplicates "${id}"`)
      ids.add(id)
    }
  })

  return errors.length === 0 ? { ok: true } : fail(errors)
}

function validateSize(value: unknown, path: string, errors: string[]): void {
  const size = asObject(value, path, errors)
  if (!size) return
  collectForbidden(size, path, errors)
  collectUnknown(size, SIZE_FIELDS, path, errors)
  for (const field of SIZE_FIELDS) requirePositiveNumber(size[field], `${path}.${field}`, errors)

  const min = size.min
  const typical = size.typical
  const max = size.max
  if (typeof min === 'number' && typeof typical === 'number' && typeof max === 'number') {
    if (!(min <= typical && typical <= max)) {
      errors.push(`${path} must satisfy min <= typical <= max (got ${min}, ${typical}, ${max})`)
    }
  }
}

function validateDiet(value: unknown, path: string, errors: string[]): void {
  const diet = asObject(value, path, errors)
  if (!diet) return
  collectForbidden(diet, path, errors)
  collectUnknown(diet, DIET_FIELDS, path, errors)

  // D10: missing diet means "not researched yet". An empty tag list is invalid —
  // it must never be used to mean unknown.
  if (!Array.isArray(diet.tags)) {
    errors.push(`${path}.tags must be an array of diet tags`)
  } else if (diet.tags.length === 0) {
    errors.push(`${path}.tags must have at least 1 tag (omit diet entirely when unknown)`)
  } else {
    const seen = new Set<string>()
    diet.tags.forEach((tag, index) => {
      requireEnum(tag, DIET_TAGS, `${path}.tags[${index}]`, errors)
      if (typeof tag === 'string') {
        if (seen.has(tag)) errors.push(`${path}.tags[${index}] duplicates "${tag}"`)
        seen.add(tag)
      }
    })
  }

  requireSourceRefs(diet.source_refs, `${path}.source_refs`, errors)
  if ('note' in diet && diet.note !== undefined) requireString(diet.note, `${path}.note`, errors)
}

// ------------------------------------------------------------------ records

export function validateCatchRecord(value: unknown, path = 'record'): ValidationResult {
  const errors: string[] = []
  const obj = asObject(value, path, errors)
  if (!obj) return fail(errors)

  collectUnknown(obj, CATCH_RECORD_FIELDS, path, errors)

  if (obj.schema_version !== SCHEMA_VERSION) {
    errors.push(`${path}.schema_version must be ${SCHEMA_VERSION}`)
  }
  requireString(obj.species, `${path}.species`, errors)
  requireNonNegativeNumber(obj.size_cm, `${path}.size_cm`, errors)
  requireEnum(obj.rarity, TIER_ORDER, `${path}.rarity`, errors)
  requireEnum(obj.outcome, ['caught', 'sighted'], `${path}.outcome`, errors)
  requireNonNegativeNumber(obj.timestamp, `${path}.timestamp`, errors)
  requireEnum(obj.event_type, CONTROLLED_EVENT_TYPES, `${path}.event_type`, errors)

  if (typeof obj.repo !== 'string') errors.push(`${path}.repo must be a string`)
  else if (obj.repo.length > 64) errors.push(`${path}.repo must be at most 64 chars`)

  if (!Array.isArray(obj.files)) {
    errors.push(`${path}.files must be an array`)
  } else {
    if (obj.files.length > 3) errors.push(`${path}.files must hold at most 3 basenames`)
    obj.files.forEach((file, index) => {
      const at = `${path}.files[${index}]`
      if (typeof file !== 'string') {
        errors.push(`${at} must be a string`)
        return
      }
      if (file.length > 64) errors.push(`${at} must be at most 64 chars`)
      if (!BASENAME_PATTERN.test(file)) errors.push(`${at} must be a bare basename`)
    })
  }
  if (obj.local_date !== undefined && !(typeof obj.local_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.local_date))) {
    errors.push(`${path}.local_date must be YYYY-MM-DD`)
  }

  return errors.length === 0 ? { ok: true } : fail(errors)
}

export function validatePublicCatchCard(value: unknown, path = 'card'): ValidationResult {
  const errors: string[] = []
  const obj = asObject(value, path, errors)
  if (!obj) return fail(errors)

  collectUnknown(obj, PUBLIC_CARD_FIELDS, path, errors)

  if (obj.schema_version !== SCHEMA_VERSION) {
    errors.push(`${path}.schema_version must be ${SCHEMA_VERSION}`)
  }
  requireString(obj.species, `${path}.species`, errors)
  requireNonNegativeNumber(obj.size_cm, `${path}.size_cm`, errors)
  requireEnum(obj.rarity, TIER_ORDER, `${path}.rarity`, errors)
  requireString(obj.date, `${path}.date`, errors, DATE_PATTERN)
  requireString(obj.event, `${path}.event`, errors)

  return errors.length === 0 ? { ok: true } : fail(errors)
}

/** Narrowing helpers for callers that want the typed value back. */
export function isSpecies(value: unknown): value is Species {
  return validateSpecies(value).ok
}

export function isCatchRecord(value: unknown): value is CatchRecord {
  return validateCatchRecord(value).ok
}

export function isPublicCatchCard(value: unknown): value is PublicCatchCard {
  return validatePublicCatchCard(value).ok
}

// ----------------------------------------------------------------- plumbing

function fail(errors: string[]): ValidationResult {
  return { ok: false, errors }
}

function asObject(value: unknown, path: string, errors: string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return null
  }
  return value as Record<string, unknown>
}

/** `additionalProperties: false` semantics. */
function collectUnknown(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key} is not an allowed field`)
  }
}

function collectForbidden(obj: Record<string, unknown>, path: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_SPECIES_FIELDS.includes(key.toLowerCase())) {
      errors.push(`${path}.${key} is a forbidden game-number field (D10: biology only)`)
    }
  }
}

function requireString(value: unknown, path: string, errors: string[], pattern?: RegExp): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`)
    return
  }
  if (pattern && !pattern.test(value)) errors.push(`${path} does not match ${pattern.source}`)
}

function requireEnum(value: unknown, allowed: readonly string[], path: string, errors: string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(', ')}`)
  }
}

function requirePositiveNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be a positive number`)
  }
}

function requireNonNegativeNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a non-negative number`)
  }
}

function requireSourceRefs(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array of sources`)
    return
  }
  if (value.length === 0) errors.push(`${path} must have at least 1 source`)
  value.forEach((entry, index) => requireString(entry, `${path}[${index}]`, errors))
}
