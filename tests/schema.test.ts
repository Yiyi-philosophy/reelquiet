import { describe, expect, test } from 'claude-code/testing'

import { makeRecord, toPublicCard } from '../src/core/records.ts'
import {
  FORBIDDEN_SPECIES_FIELDS,
  validateCatchRecord,
  validatePublicCatchCard,
  validateSpecies,
  validateSpeciesList,
} from '../src/core/schema.ts'
import { DIET_TAGS, type Species } from '../src/core/types.ts'
import { SPECIES, SPECIES_BY_ID } from '../src/data/species.ts'

const GOOD: Species = {
  id: 'atlantic-mackerel',
  common_name: 'Atlantic mackerel',
  scientific_name: 'Scomber scombrus',
  size_cm: { min: 20, typical: 30, max: 60 },
  depth_zone: 'epipelagic',
  activity: 'diurnal',
  rarity: 'common',
  source_refs: ['Written summary: test fixture.'],
  diet: {
    tags: ['plankton'],
    source_refs: ['Written summary: test fixture.'],
  },
}

function errorsOf(value: unknown): string[] {
  const result = validateSpecies(value)
  return result.ok ? [] : result.errors
}

describe('species schema', () => {
  test('a well-formed species validates', () => {
    expect(validateSpecies(GOOD).ok).toBe(true)
  })

  test('D10: a forbidden game-number field is rejected by name', () => {
    const withBait = { ...GOOD, bait_affinity: { shrimp: 2 } }
    const errors = errorsOf(withBait)
    expect(errors.join(' ')).toContain('forbidden game-number field')
    expect(validateSpecies(withBait).ok).toBe(false)
  })

  test('D10: every forbidden name is caught, at the top level and inside diet', () => {
    for (const field of FORBIDDEN_SPECIES_FIELDS) {
      expect(validateSpecies({ ...GOOD, [field]: 1 }).ok).toBe(false)
      expect(
        validateSpecies({ ...GOOD, diet: { ...GOOD.diet, [field]: 1 } }).ok,
      ).toBe(false)
    }
  })

  test('additionalProperties: false — an unknown field is rejected', () => {
    expect(errorsOf({ ...GOOD, habitat_note: 'north atlantic' }).join(' ')).toContain('not an allowed field')
    expect(errorsOf({ ...GOOD, size_cm: { ...GOOD.size_cm, mode: 30 } }).join(' ')).toContain('not an allowed field')
  })

  test('D10: diet.tags must have at least one tag; [] is invalid', () => {
    const empty = { ...GOOD, diet: { tags: [], source_refs: ['Written summary: test.'] } }
    expect(validateSpecies(empty).ok).toBe(false)
    expect(errorsOf(empty).join(' ')).toContain('at least 1 tag')

    // Missing diet is fine — it means "not researched yet".
    const { diet: _diet, ...noDiet } = GOOD
    expect(validateSpecies(noDiet).ok).toBe(true)
  })

  test('D10: diet tags come from the controlled vocabulary, with no duplicates', () => {
    const offVocab = { ...GOOD, diet: { tags: ['pizza'], source_refs: ['Written summary: test.'] } }
    expect(validateSpecies(offVocab).ok).toBe(false)

    const duplicated = {
      ...GOOD,
      diet: { tags: ['plankton', 'plankton'], source_refs: ['Written summary: test.'] },
    }
    expect(errorsOf(duplicated).join(' ')).toContain('duplicates')
  })

  test('diet and species both need at least one source', () => {
    expect(validateSpecies({ ...GOOD, source_refs: [] }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, diet: { tags: ['plankton'], source_refs: [] } }).ok).toBe(false)
  })

  test('sizes must be positive and ordered', () => {
    expect(validateSpecies({ ...GOOD, size_cm: { min: 30, typical: 20, max: 60 } }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, size_cm: { min: 0, typical: 20, max: 60 } }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, size_cm: { min: 20, typical: 30 } }).ok).toBe(false)
  })

  test('enums and the binomial name are checked', () => {
    expect(validateSpecies({ ...GOOD, depth_zone: 'abyss' }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, activity: 'crepuscular' }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, rarity: 'mythic' }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, scientific_name: 'mackerel' }).ok).toBe(false)
    expect(validateSpecies({ ...GOOD, id: 'Atlantic Mackerel' }).ok).toBe(false)
    expect(validateSpecies(null).ok).toBe(false)
    expect(validateSpecies([]).ok).toBe(false)
  })

  test('a list rejects duplicate ids and an empty table', () => {
    expect(validateSpeciesList([GOOD, GOOD]).ok).toBe(false)
    expect(validateSpeciesList([]).ok).toBe(false)
    expect(validateSpeciesList({}).ok).toBe(false)
  })
})

describe('record and card schemas', () => {
  const record = makeRecord({
    species: 'atlantic-mackerel',
    size_cm: 31.3,
    rarity: 'common',
    outcome: 'caught',
    timestamp: 1_700_000_000_000,
    event_type: 'tests-green',
    repo: 'reelquiet',
    files: ['pond.ts'],
  })

  test('a built record and its card both validate', () => {
    expect(validateCatchRecord(record).ok).toBe(true)
    expect(validatePublicCatchCard(toPublicCard(record)).ok).toBe(true)
  })

  test('CatchRecord is closed: an extra field fails the schema', () => {
    expect(validateCatchRecord({ ...record, command: 'npm test' }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, schema_version: 2 }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'] }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, files: ['src/pond.ts'] }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, files: ['x'.repeat(65)] }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, outcome: 'escaped' }).ok).toBe(false)
    expect(validateCatchRecord({ ...record, event_type: 'free text' }).ok).toBe(false)
  })

  test('PublicCatchCard is closed: repo or files cannot be bolted on', () => {
    const card = toPublicCard(record)
    expect(validatePublicCatchCard({ ...card, repo: 'reelquiet' }).ok).toBe(false)
    expect(validatePublicCatchCard({ ...card, files: ['pond.ts'] }).ok).toBe(false)
    expect(validatePublicCatchCard({ ...card, date: '7 October 2026' }).ok).toBe(false)
  })
})

describe('Stage 1 species data', () => {
  test('the whole table validates against the schema', () => {
    const result = validateSpeciesList(SPECIES as unknown[])
    expect(result.ok ? [] : result.errors).toEqual([])
  })

  test('exactly two species: one common, one rare', () => {
    expect(SPECIES).toHaveLength(2)
    expect(SPECIES.map((s) => s.rarity).sort()).toEqual(['common', 'rare'])
  })

  test('both carry real scientific names and at least one source each', () => {
    for (const species of SPECIES) {
      expect(/^[A-Z][a-z]+ [a-z]+$/.test(species.scientific_name)).toBe(true)
      expect(species.source_refs.length > 0).toBe(true)
    }
  })

  test('D10: diet is biology only, with controlled tags and sources', () => {
    for (const species of SPECIES) {
      expect(species.diet).toBeDefined()
      const diet = species.diet
      if (!diet) continue
      expect(diet.tags.length > 0).toBe(true)
      for (const tag of diet.tags) expect(DIET_TAGS).toContain(tag)
      expect(diet.source_refs.length > 0).toBe(true)
    }
    const json = JSON.stringify(SPECIES).toLowerCase()
    for (const field of FORBIDDEN_SPECIES_FIELDS) {
      expect(json).not.toContain(`"${field}"`)
    }
  })

  test('the id index lines up with the table', () => {
    expect(Object.keys(SPECIES_BY_ID).sort()).toEqual(['atlantic-mackerel', 'common-fangtooth'])
    expect(SPECIES_BY_ID['common-fangtooth'].depth_zone).toBe('bathypelagic')
    expect(SPECIES_BY_ID['common-fangtooth'].activity).toBe('nocturnal')
  })
})
