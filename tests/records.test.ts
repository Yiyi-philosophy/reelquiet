import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_MEMORIES_LINE, localMemoryLine, publicEventPhrase } from '../src/core/memory.ts'
import {
  CATCH_RECORD_FIELDS,
  PUBLIC_CARD_FIELDS,
  SCHEMA_VERSION,
  catchKey,
  encounterDatePrefix,
  encounterKey,
  makeEncounterRecord,
  makeRecord,
  prefKey,
  recentMemories,
  recordKey,
  sightingKey,
  toPublicCard,
  type CatchRecord,
} from '../src/core/records.ts'
import { validateCatchRecord, validatePublicCatchCard } from '../src/core/schema.ts'
import { utcDateOf, utcHourOf } from '../src/core/types.ts'

const BASE = {
  species: 'atlantic-mackerel',
  size_cm: 31.25,
  rarity: 'common' as const,
  outcome: 'caught' as const,
  timestamp: 1_700_000_000_000,
  event_type: 'tests-green' as const,
  repo: 'reelquiet',
  files: ['pond.ts'],
}

describe('v1: key space and schema_version', () => {
  test('every key builder stamps the v1: prefix', () => {
    expect(catchKey('sess-1', 0)).toBe('v1:c:sess-1:0')
    expect(sightingKey('sess-1', 12)).toBe('v1:s:sess-1:12')
    expect(encounterKey('2026-10-07', 'sess-1', 3)).toBe('v1:e:2026-10-07:sess-1:3')
    expect(prefKey('sound.enabled')).toBe('v1:p:sound.enabled')
    expect(encounterDatePrefix('2026-10-07')).toBe('v1:e:2026-10-07:')
  })

  test('a key segment can never smuggle in a separator or a path', () => {
    expect(catchKey('sess:1 2/3', 0)).toBe('v1:c:sess-1-2-3:0')
    expect(sightingKey('', 0)).toBe('v1:s:unknown:0')
    expect(catchKey('sess-1', -4)).toBe('v1:c:sess-1:0')
    expect(catchKey('sess-1', 2.7)).toBe('v1:c:sess-1:2')
  })

  test('recordKey follows the outcome', () => {
    const caught = makeRecord(BASE)
    const sighted = makeRecord({ ...BASE, outcome: 'sighted' })
    expect(recordKey(caught, 'sess-1', 1)).toBe('v1:c:sess-1:1')
    expect(recordKey(sighted, 'sess-1', 1)).toBe('v1:s:sess-1:1')
  })

  test('records carry an explicit schema_version', () => {
    expect(makeRecord(BASE).schema_version).toBe(1)
    expect(makeEncounterRecord(BASE).schema_version).toBe(1)
    expect(toPublicCard(makeRecord(BASE)).schema_version).toBe(SCHEMA_VERSION)
  })
})

describe('D12 CatchRecord allowlist', () => {
  test('it keeps exactly the allowlisted fields and drops everything else', () => {
    const record = makeRecord({
      ...BASE,
      command: 'npm test -- --watch',
      prompt: 'please fix the failing test',
      stdout: 'FAIL src/pond.test.ts',
      token: 'sk-test-123',
      cwd: '/home/x/secret',
      tool_arguments: { path: '/home/x/secret/api.ts' },
      schema_version: 99,
      local_date: '2026-10-08',
    })

    expect(Object.keys(record).sort()).toEqual([...CATCH_RECORD_FIELDS].sort())
    expect(record.schema_version).toBe(1)
    expect(validateCatchRecord(record).ok).toBe(true)
  })

  test('full paths are reduced to basenames and capped at 3 of at most 64 chars', () => {
    const long = `${'a'.repeat(80)}.ts`
    const record = makeRecord({
      ...BASE,
      repo: '/home/x/secret/reelquiet',
      files: [
        '/home/x/secret/api.ts',
        'src\\core\\pond.ts',
        `deep/nested/${long}`,
        'fourth.ts',
        'fifth.ts',
      ],
    })

    expect(record.repo).toBe('reelquiet')
    expect(record.files).toHaveLength(3)
    expect(record.files[0]).toBe('api.ts')
    expect(record.files[1]).toBe('pond.ts')
    expect(record.files[2].length).toBe(64)
    expect(JSON.stringify(record)).not.toContain('/home/x/secret')
  })

  test('duplicate and empty basenames are dropped', () => {
    const record = makeRecord({ ...BASE, files: ['a/pond.ts', 'b/pond.ts', '', '   ', 'card.ts'] })
    expect(record.files).toEqual(['pond.ts', 'card.ts'])
  })

  test('out-of-range and unreadable values are clamped, never passed through', () => {
    const record = makeRecord({
      species: '  ../../etc/passwd  ',
      size_cm: -5,
      rarity: 'mythic',
      outcome: 'escaped',
      timestamp: -1,
      event_type: 'freeform note',
      repo: 'a repo with spaces!',
      files: 'not-an-array',
    })

    expect(record.species).toBe('passwd')
    expect(record.size_cm).toBe(0)
    expect(record.rarity).toBe('common')
    // An unreadable outcome settles as a sighting: never a reward.
    expect(record.outcome).toBe('sighted')
    expect(record.timestamp).toBe(0)
    expect(record.event_type).toBe('unknown')
    expect(record.repo).toBe('a-repo-with-spaces')
    expect(record.files).toEqual([])
  })

  test('sizes are rounded to a tenth of a centimetre', () => {
    expect(makeRecord({ ...BASE, size_cm: 31.25 }).size_cm).toBe(31.3)
    expect(makeRecord({ ...BASE, size_cm: 31.24 }).size_cm).toBe(31.2)
  })
})

describe('D12 PublicCatchCard projection', () => {
  test('★ CI gate: a loaded record yields a card with no repo/file/path/command/prompt', () => {
    const record = makeRecord({
      species: 'common-fangtooth',
      size_cm: 17.4,
      rarity: 'rare',
      outcome: 'caught',
      timestamp: 1_700_000_000_000,
      event_type: 'tests-green',
      repo: 'secret-client-repo',
      files: ['/home/x/secret/api.ts'],
      command: 'npm test -- --grep auth',
      prompt: 'rotate the credentials in api.ts',
      token: 'sk-test-123',
      path: '/home/x/secret/api.ts',
    })

    const card = toPublicCard(record)
    const json = JSON.stringify(card)

    for (const fieldName of ['repo', 'file', 'files', 'path', 'command', 'prompt', 'token']) {
      expect(json).not.toContain(fieldName)
    }
    for (const value of [
      'secret-client-repo',
      '/home/x/secret/api.ts',
      'api.ts',
      'secret',
      'sk-test-123',
      'npm test -- --grep auth',
      'rotate the credentials in api.ts',
    ]) {
      expect(json).not.toContain(value)
    }

    expect(Object.keys(card).sort()).toEqual([...PUBLIC_CARD_FIELDS].sort())
    expect(validatePublicCatchCard(card).ok).toBe(true)
  })

  test('the card projects only species, size, rarity, date and a generic event', () => {
    const card = toPublicCard(makeRecord(BASE))
    expect(card).toEqual({
      schema_version: 1,
      species: 'atlantic-mackerel',
      size_cm: 31.3,
      rarity: 'common',
      date: utcDateOf(BASE.timestamp),
      event: publicEventPhrase('tests-green'),
    })
  })

  test('the event phrase is generic for every controlled event type', () => {
    for (const eventType of ['tests-green', 'edit', 'tool-call', 'turn-complete', 'unknown'] as const) {
      const phrase = publicEventPhrase(eventType)
      expect(typeof phrase).toBe('string')
      expect(phrase.length > 0).toBe(true)
      expect(phrase).not.toContain('/')
    }
  })
})

describe('D14 recentMemories', () => {
  const at = (timestamp: number, species: string): CatchRecord =>
    makeRecord({ ...BASE, timestamp, species })

  test('newest first, capped at 20', () => {
    const many = Array.from({ length: 50 }, (_, i) => at(1000 + i, `s-${i}`))
    const recent = recentMemories(many)

    expect(recent).toHaveLength(20)
    expect(recent[0].species).toBe('s-49')
    expect(recent[19].species).toBe('s-30')
    for (let i = 1; i < recent.length; i++) {
      expect(recent[i - 1].timestamp >= recent[i].timestamp).toBe(true)
    }
  })

  test('it never mutates the input and takes an explicit cap', () => {
    const input = [at(1, 'a'), at(3, 'c'), at(2, 'b')]
    const recent = recentMemories(input, 2)
    expect(recent.map((r) => r.species)).toEqual(['c', 'b'])
    expect(input.map((r) => r.species)).toEqual(['a', 'c', 'b'])
    expect(recentMemories(input, 0)).toEqual([])
    expect(recentMemories([])).toEqual([])
  })
})

describe('zero-token memory text', () => {
  test('the local line uses only allowlisted fields', () => {
    const line = localMemoryLine(makeRecord(BASE))
    expect(line).toContain('atlantic-mackerel')
    expect(line).toContain('31.3 cm')
    expect(line).toContain('reelquiet')
    expect(line).toContain('pond.ts')
    expect(line).not.toContain('/')
  })

  test('there is an empty-state line for the probe', () => {
    expect(EMPTY_MEMORIES_LINE.length > 0).toBe(true)
  })
})

describe('pure date helpers', () => {
  test('UTC date and hour come out of arithmetic, not a Date read', () => {
    expect(utcDateOf(0)).toBe('1970-01-01')
    expect(utcHourOf(0)).toBe(0)
    expect(utcDateOf(86400000 - 1)).toBe('1970-01-01')
    expect(utcDateOf(86400000)).toBe('1970-01-02')
    expect(utcDateOf(1_700_000_000_000)).toBe('2023-11-14')
    expect(utcHourOf(1_700_000_000_000)).toBe(22)
    expect(utcDateOf(1_767_225_600_000)).toBe('2026-01-01')
  })
})
