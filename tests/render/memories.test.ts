// Gate G1: the `F-MEM-*` fixtures from "## Stage 1 Visual Spec" → "Recent
// memories fixtures（`/reelquiet log`）".
//
// Again the `● reelquiet: ` prefix belongs to `$.ui.log`; these are bare lines.

import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_MEMORIES_LINE } from '../../src/core/memory.ts'
import { makeRecord, type CatchRecord } from '../../src/core/records.ts'
import { recentMemoryLines } from '../../src/render/memories.ts'

const AT_2341 = 1_791_502_860_000 // 2026-10-08T23:41:00Z
const AT_2205 = 1_791_497_100_000 // 2026-10-08T22:05:00Z
const AT_2110 = 1_791_493_800_000 // 2026-10-08T21:10:00Z

const WIDE = 120

function record(over: Partial<Record<string, unknown>> = {}): CatchRecord {
  return makeRecord({
    species: 'common-fangtooth',
    size_cm: 14,
    rarity: 'rare',
    outcome: 'caught',
    timestamp: AT_2341,
    event_type: 'tests-green',
    repo: 'claude-fish',
    files: ['pagination.ts'],
    ...over,
  })
}

const THREE: CatchRecord[] = [
  record(),
  record({
    species: 'atlantic-mackerel',
    size_cm: 31,
    rarity: 'common',
    timestamp: AT_2205,
    event_type: 'turn-complete',
    files: ['pond.ts'],
  }),
  record({ outcome: 'sighted', timestamp: AT_2110, event_type: 'edit', files: [] }),
]

describe('F-MEM-EMPTY', () => {
  test('the header and one gentle, accurate empty line', () => {
    expect(recentMemoryLines([], { columns: WIDE })).toEqual([
      'Recent memories',
      'Nothing here yet. Catches and rare sightings will appear here gradually as Claude works.',
    ])
  })

  test('the empty line is the approved copy, and core agrees with it', () => {
    expect(EMPTY_MEMORIES_LINE).toBe(
      'Nothing here yet. Catches and rare sightings will appear here gradually as Claude works.',
    )
  })

  test('an empty list never grows a count, with or without a total', () => {
    expect(recentMemoryLines([], { columns: WIDE, total: 0 })[0]).toBe('Recent memories')
  })
})

describe('F-MEM-SOME', () => {
  test('header plus one line per record, fields in the fixed order', () => {
    expect(recentMemoryLines(THREE, { columns: WIDE })).toEqual([
      'Recent memories · latest 3',
      '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green  claude-fish  pagination.ts',
      '10-08 22:05  Atlantic mackerel  31 cm  caught  turn complete  claude-fish  pond.ts',
      '10-08 21:10  ★ Common fangtooth  RARE  sighted  edit  claude-fish',
    ])
  })

  test('V-MEM: `N of M` only when a total is supplied', () => {
    expect(recentMemoryLines(THREE, { columns: WIDE, total: 57 })[0]).toBe('Recent memories · 3 of 57')
    expect(recentMemoryLines(THREE, { columns: WIDE })[0]).toBe('Recent memories · latest 3')
  })

  test('D12: no line can carry a path, a command or free text', () => {
    const lines = recentMemoryLines(
      [record({ repo: '/home/me/claude-fish', files: ['src/core/pond.ts'] })],
      { columns: WIDE },
    )
    expect(lines[1]).toContain('claude-fish')
    expect(lines[1]).toContain('pond.ts')
    expect(lines[1]).not.toContain('/')
  })
})

describe('F-MEM-20 / F-MEM-OVER-20', () => {
  const many = (count: number): CatchRecord[] =>
    Array.from({ length: count }, (_, i) =>
      record({ timestamp: AT_2110 + i * 60_000, species: `fish-${i}`, rarity: 'common' }),
    )

  test('exactly 20 records give 20 lines', () => {
    const lines = recentMemoryLines(many(20), { columns: WIDE })
    expect(lines).toHaveLength(21)
    expect(lines[0]).toBe('Recent memories · latest 20')
  })

  test('more than 20 are capped at 20, newest first', () => {
    const lines = recentMemoryLines(many(25), { columns: WIDE })
    expect(lines).toHaveLength(21)
    expect(lines[0]).toBe('Recent memories · latest 20')
    expect(lines[1]).toContain('Fish 24')
    expect(lines[20]).toContain('Fish 5')
  })

  test('a total larger than the cap reads `20 of M`', () => {
    expect(recentMemoryLines(many(25), { columns: WIDE, total: 25 })[0]).toBe(
      'Recent memories · 20 of 25',
    )
  })
})

describe('F-MEM-MISSING-FIELDS', () => {
  test('a missing basename or repo is simply left out, with no placeholder', () => {
    expect(recentMemoryLines([record({ repo: '', files: [] })], { columns: WIDE })[1]).toBe(
      '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green',
    )
    expect(recentMemoryLines([record({ files: [] })], { columns: WIDE })[1]).toBe(
      '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green  claude-fish',
    )
    expect(recentMemoryLines([record({ repo: '' })], { columns: WIDE })[1]).toBe(
      '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green  pagination.ts',
    )
  })
})

describe('F-MEM-NARROW', () => {
  const FULL =
    '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green  claude-fish  pagination.ts'
  const NO_BASENAME =
    '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green  claude-fish'
  const NO_REPO = '10-08 23:41  ★ Common fangtooth  RARE  14 cm  caught  tests turned green'

  test('the full line survives when it fits', () => {
    expect(FULL.length).toBe(100)
    expect(recentMemoryLines([record()], { columns: 100 })[1]).toBe(FULL)
  })

  test('basename goes first', () => {
    expect(NO_BASENAME.length).toBe(85)
    expect(recentMemoryLines([record()], { columns: 90 })[1]).toBe(NO_BASENAME)
  })

  test('then repo, keeping species, rarity and status', () => {
    expect(NO_REPO.length).toBe(72)
    const line = recentMemoryLines([record()], { columns: 80 })[1]
    expect(line).toBe(NO_REPO)
    expect(line).toContain('Common fangtooth')
    expect(line).toContain('RARE')
    expect(line).toContain('caught')
  })

  test('narrower than that keeps species, status and rarity rather than truncating', () => {
    const line = recentMemoryLines([record()], { columns: 30 })[1]
    expect(line).toBe(NO_REPO)
  })
})
