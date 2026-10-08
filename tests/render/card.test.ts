// Gate G1: the `F-CARD-*`, `F-LOG-SIGHTED-RARE` and `F-RESULT-DEDUPE` fixtures.
//
// Expected strings come straight from "## Stage 1 Visual Spec" → "Catch Card 与
// transcript fixtures", minus the `● reelquiet: ` prefix that `$.ui.log` adds
// itself (the renderer returns bare lines; the host owns the prefix).

import { describe, expect, test } from 'claude-code/testing'

import { makeRecord, type CatchRecord } from '../../src/core/records.ts'
import type { Species, Tier } from '../../src/core/types.ts'
import { catchCardLines, emitCatchCard, emitOnce } from '../../src/render/card.ts'

/** 2026-10-08T21:10:00Z — a date the spec fixtures print as `2026-10-08`. */
const AT = 1_791_493_800_000

const FANGTOOTH: Species = {
  id: 'common-fangtooth',
  common_name: 'common fangtooth',
  scientific_name: 'Anoplogaster cornuta',
  size_cm: { min: 6, typical: 12, max: 18 },
  depth_zone: 'bathypelagic',
  activity: 'nocturnal',
  rarity: 'rare',
  source_refs: ['Written summary: see src/data/species.ts.'],
}

const MACKEREL: Species = {
  id: 'atlantic-mackerel',
  common_name: 'Atlantic mackerel',
  scientific_name: 'Scomber scombrus',
  size_cm: { min: 20, typical: 30, max: 60 },
  depth_zone: 'epipelagic',
  activity: 'diurnal',
  rarity: 'common',
  source_refs: ['Written summary: see src/data/species.ts.'],
}

/** Stage 1 ships no legendary species, so F-CARD-LEGENDARY needs a stand-in. */
const OARFISH: Species = {
  id: 'giant-oarfish',
  common_name: 'giant oarfish',
  scientific_name: 'Regalecus glesne',
  size_cm: { min: 100, typical: 300, max: 800 },
  depth_zone: 'mesopelagic',
  activity: 'diurnal',
  rarity: 'legendary',
  source_refs: ['Written summary: synthetic fixture for the legendary tier.'],
}

function record(over: Partial<Record<string, unknown>> = {}): CatchRecord {
  return makeRecord({
    species: 'common-fangtooth',
    size_cm: 14,
    rarity: 'rare',
    outcome: 'caught',
    timestamp: AT,
    event_type: 'tests-green',
    repo: 'claude-fish',
    files: ['pagination.ts'],
    ...over,
  })
}

describe('F-CARD-RARE / F-CARD-LEGENDARY', () => {
  test('F-CARD-RARE is exactly three lines, in order', () => {
    expect(catchCardLines(record(), FANGTOOTH)).toEqual([
      '★ RARE CATCH · Common fangtooth',
      'Anoplogaster cornuta · 14 cm',
      'caught as tests turned green · 2026-10-08',
    ])
  })

  test('F-CARD-LEGENDARY uses the same three-line shape', () => {
    const lines = catchCardLines(
      record({
        species: 'giant-oarfish',
        rarity: 'legendary',
        size_cm: 410,
        event_type: 'turn-complete',
      }),
      OARFISH,
    )
    expect(lines).toEqual([
      '★ LEGENDARY CATCH · Giant oarfish',
      'Regalecus glesne · 410 cm',
      'caught as the task finished · 2026-10-08',
    ])
  })

  test('V-CARD: never a repo, file, path or command, whatever the record holds', () => {
    const lines = catchCardLines(
      record({ repo: 'secret-repo', files: ['/home/me/secret/pagination.ts'] }),
      FANGTOOTH,
    )
    const joined = lines.join('\n')
    for (const leak of ['secret-repo', 'secret', 'pagination.ts', '/home/me', 'npm test', '/']) {
      expect(joined).not.toContain(leak)
    }
  })
})

describe('F-LOG-SIGHTED-RARE', () => {
  test('a sighted rare is one line', () => {
    expect(catchCardLines(record({ outcome: 'sighted' }), FANGTOOTH)).toEqual([
      'RARE sighting · Common fangtooth · slipped away · 2026-10-08',
    ])
  })

  test('a sighted legendary says LEGENDARY', () => {
    const lines = catchCardLines(
      record({ species: 'giant-oarfish', rarity: 'legendary', outcome: 'sighted' }),
      OARFISH,
    )
    expect(lines).toEqual([
      'LEGENDARY sighting · Giant oarfish · slipped away · 2026-10-08',
    ])
  })
})

describe('common and uncommon write no transcript', () => {
  for (const rarity of ['common', 'uncommon'] as const) {
    for (const outcome of ['caught', 'sighted'] as const) {
      test(`a ${outcome} ${rarity} produces no lines`, () => {
        const species = rarity === 'common' ? MACKEREL : { ...MACKEREL, rarity: rarity as Tier }
        expect(catchCardLines(record({ rarity, outcome, species: 'atlantic-mackerel' }), species)).toEqual([])
      })
    }
  }
})

describe('F-RESULT-DEDUPE', () => {
  test('emitOnce reports the first sighting of an id and remembers it', () => {
    const first = emitOnce([], 'evt-1')
    expect(first.emit).toBe(true)
    expect(first.seen).toEqual(['evt-1'])

    const second = emitOnce(first.seen, 'evt-1')
    expect(second.emit).toBe(false)
    expect(second.seen).toEqual(['evt-1'])

    const third = emitOnce(second.seen, 'evt-2')
    expect(third.emit).toBe(true)
    expect(third.seen).toEqual(['evt-1', 'evt-2'])
  })

  test('emitOnce never mutates the list it is given', () => {
    const seen = ['evt-1']
    emitOnce(seen, 'evt-2')
    expect(seen).toEqual(['evt-1'])
  })

  test('the card emitter returns lines only for an unseen event id', () => {
    const first = emitCatchCard([], 'catch:7', record(), FANGTOOTH)
    expect(first.lines).toHaveLength(3)
    expect(first.seen).toEqual(['catch:7'])

    const again = emitCatchCard(first.seen, 'catch:7', record(), FANGTOOTH)
    expect(again.lines).toEqual([])
    expect(again.seen).toEqual(['catch:7'])
  })

  test('a non-rare result is never remembered, because it never emits', () => {
    const out = emitCatchCard([], 'catch:8', record({ rarity: 'common' }), MACKEREL)
    expect(out.lines).toEqual([])
    expect(out.seen).toEqual([])
  })
})
