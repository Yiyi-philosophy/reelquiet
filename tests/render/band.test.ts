// Gate G1: every `F-BAND-*`, `F-RESULT-*` and `F-COLOR-*` fixture from the
// Stage 1 Visual Spec, encoded as plain-text snapshots.
//
// The expected strings below are copied character for character out of
// `docs/designs/claude-fish-v0.1.md` → "## Stage 1 Visual Spec". Nothing in this
// file computes an expectation: if a line here disagrees with the spec, the spec
// wins and the renderer is wrong.

import { describe, expect, test } from 'claude-code/testing'

import { createPondState, type PondResult, type PondState } from '../../src/core/pond.ts'
import {
  AMBIENT_FIXTURE_SEED,
  RESULT_DIM_AFTER_MS,
  RESULT_MIN_HOLD_MS,
  RESULT_MIN_HOLD_RARE_MS,
  renderBand,
  type BandInput,
} from '../../src/render/band.ts'
import { stripColor, toPlainText } from '../../src/render/model.ts'

/** 2026-10-08T23:41:00Z — the instant the Recent-memories fixtures also use. */
const NOW = 1_791_502_860_000

function baseState(over: Partial<PondState> = {}): PondState {
  return { ...createPondState(1), ...over }
}

const IDLE = baseState()

/** 0:42 of waiting → `depth 3 m` in the spec's F-BAND-WAITING. */
const WAITING = baseState({
  phase: 'waiting',
  clock: { simMs: 42_000, lastRealNow: NOW },
  castAtSim: 0,
  nextBiteAtSim: 60_000,
})

function biteState(tier: 'common' | 'uncommon'): PondState {
  return baseState({
    phase: 'waiting',
    clock: { simMs: 42_000, lastRealNow: NOW },
    castAtSim: 0,
    nextBiteAtSim: null,
    fish: {
      speciesId: 'atlantic-mackerel',
      tier,
      sizeCm: 31,
      depthZone: 'epipelagic',
      bitAtSim: 42_000,
    },
  })
}

function hookedState(tier: 'rare' | 'legendary', remainingMs = 14_000): PondState {
  return baseState({
    phase: 'hooked',
    clock: { simMs: 42_000, lastRealNow: NOW },
    castAtSim: 0,
    nextBiteAtSim: null,
    fish: {
      speciesId: 'common-fangtooth',
      tier,
      sizeCm: 14,
      depthZone: 'bathypelagic',
      bitAtSim: 28_000,
    },
    windowRemainingMs: remainingMs,
  })
}

function carriedState(grace: 'running' | 'blocked', remainingMs = 41_000): PondState {
  return baseState({
    phase: 'carried',
    clock: { simMs: 90_000, lastRealNow: NOW },
    castAtSim: 0,
    nextBiteAtSim: null,
    fish: {
      speciesId: 'common-fangtooth',
      tier: 'rare',
      sizeCm: 14,
      depthZone: 'bathypelagic',
      bitAtSim: 28_000,
    },
    carry: { grace, remainingMs: grace === 'running' ? remainingMs : 0 },
  })
}

const CAUGHT_COMMON: PondResult = {
  kind: 'caught',
  speciesId: 'atlantic-mackerel',
  tier: 'common',
  sizeCm: 31,
  at: NOW,
  from: 'bite',
}

const CAUGHT_RARE: PondResult = {
  kind: 'caught',
  speciesId: 'common-fangtooth',
  tier: 'rare',
  sizeCm: 14,
  at: NOW,
  from: 'reel',
}

const SIGHTED_RARE: PondResult = {
  kind: 'sighted',
  speciesId: 'common-fangtooth',
  tier: 'rare',
  sizeCm: 14,
  at: NOW,
  from: 'timeout',
}

const ESCAPED_COMMON: PondResult = {
  kind: 'escaped',
  speciesId: 'atlantic-mackerel',
  tier: 'common',
  sizeCm: 31,
  at: NOW,
  from: 'complete',
}

/** Monochrome baseline: `noColor` on, 75 body columns, the ≥70 tier. */
function mono(over: Partial<BandInput> & { state: PondState }): BandInput {
  return {
    now: NOW,
    bodyColumns: 75,
    sessionSeed: AMBIENT_FIXTURE_SEED,
    noColor: true,
    ...over,
  }
}

function text(input: BandInput): string {
  const model = renderBand(input)
  if (model == null) throw new Error('expected a band model, got null')
  return toPlainText(model)
}

// --------------------------------------------------------------- F-BAND-* ≥70

describe('F-BAND-* (mono baseline, ≥70 columns, bodyColumns = 75)', () => {
  test('F-BAND-IDLE renders nothing', () => {
    expect(renderBand(mono({ state: IDLE }))).toBe(null)
  })

  test('F-BAND-WAITING', () => {
    expect(text(mono({ state: WAITING }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~~~  waiting · 0:42',
        '   ><>                     <><           depth 3 m',
      ].join('\n'),
    )
  })

  test('F-BAND-BITE-COMMON', () => {
    expect(text(mono({ state: biteState('common') }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! bite',
        '                   ><>',
      ].join('\n'),
    )
  })

  test('F-BAND-BITE-UNCOMMON', () => {
    const lines = text(mono({ state: biteState('uncommon') })).split('\n')
    // The spec prints only the status row for this fixture; the pond row is the
    // same non-rare silhouette as F-BAND-BITE-COMMON (see report: ambiguity 3).
    expect(lines[0]).toBe('~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! bite · uncommon')
    expect(lines[1]).toBe('                   ><>')
    expect(lines).toHaveLength(2)
  })

  test('F-BAND-RARE-HOOKED', () => {
    expect(text(mono({ state: hookedState('rare') }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! RARE bite · 0:14',
        '                   ><)))°>               1: reel in',
      ].join('\n'),
    )
  })

  test('F-BAND-LEGENDARY-HOOKED', () => {
    expect(text(mono({ state: hookedState('legendary') }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! LEGENDARY bite · 0:14',
        '                   ><)))°>               1: reel in',
      ].join('\n'),
    )
  })

  test('F-BAND-RARE-DRAFT', () => {
    expect(text(mono({ state: hookedState('rare'), isDraft: true }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! RARE bite · paused',
        '                   ><)))°>               1: reel in',
        '                                         Send your draft, then reel it in.',
      ].join('\n'),
    )
  })

  test('F-BAND-FROZEN', () => {
    expect(text(mono({ state: WAITING, isFrozen: true }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~~~  paused · Claude needs you',
        '   ><>                     <><',
      ].join('\n'),
    )
  })

  test('F-BAND-FROZEN-RARE', () => {
    expect(text(mono({ state: hookedState('rare'), isFrozen: true }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  RARE on the line · paused',
        '                   ><)))°>               Claude needs you first',
      ].join('\n'),
    )
  })

  test('F-BAND-CARRIED', () => {
    expect(text(mono({ state: carriedState('running') }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! RARE still on the line · 0:41',
        '                   ><)))°>               1: reel in',
      ].join('\n'),
    )
  })

  test('F-BAND-CARRIED-DRAFT', () => {
    expect(text(mono({ state: carriedState('blocked'), isDraft: true }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~!~~~~~~~~~~~~~~~~~~~  ! RARE still on the line',
        '                   ><)))°>               1: reel in',
        '                                         Send your draft, then reel it in.',
      ].join('\n'),
    )
  })

  test('F-BAND-CAUGHT-COMMON', () => {
    expect(
      text(mono({ state: IDLE, lastResult: CAUGHT_COMMON, resultShownAt: NOW - 1000 })),
    ).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  caught · Atlantic mackerel',
        '                                         31 cm',
      ].join('\n'),
    )
  })

  test('F-BAND-CAUGHT-RARE', () => {
    expect(text(mono({ state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - 1000 }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  ★ caught · Common fangtooth',
        '                                         14 cm · RARE',
      ].join('\n'),
    )
  })

  test('F-BAND-SIGHTED', () => {
    expect(text(mono({ state: IDLE, lastResult: SIGHTED_RARE, resultShownAt: NOW - 1000 }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  sighted · Common fangtooth',
        '                                         slipped away · RARE · noted',
      ].join('\n'),
    )
  })

  test('F-BAND-RESULT-DIM: same characters, dimColor throughout', () => {
    const fresh = mono({ state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - 1000 })
    const old = mono({ state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - RESULT_DIM_AFTER_MS })

    expect(text(old)).toBe(text(fresh))

    const model = renderBand(old)
    expect(model?.meta.resultDimmed).toBe(true)
    expect(renderBand(fresh)?.meta.resultDimmed).toBe(false)
    for (const row of model?.rows ?? []) {
      for (const segment of row.segments) {
        expect(segment.dim).toBe(true)
        expect(segment.bold).toBe(false)
      }
    }
  })

  test('F-BAND-ESCAPED-COMMON shows no result at all', () => {
    expect(renderBand(mono({ state: IDLE, lastResult: ESCAPED_COMMON, resultShownAt: NOW }))).toBe(null)
    // …and it does not mask a live cast either.
    expect(text(mono({ state: WAITING, lastResult: ESCAPED_COMMON, resultShownAt: NOW }))).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~~~  waiting · 0:42',
        '   ><>                     <><           depth 3 m',
      ].join('\n'),
    )
  })

  test('V-AMBIENT: at most 2 silhouettes, seeded, and they stop while frozen', () => {
    const moving = text(mono({ state: { ...WAITING, clock: { simMs: 46_000, lastRealNow: NOW } } }))
    const still = text(mono({ state: WAITING }))
    expect(moving).not.toBe(still)

    const frozenLater = text(
      mono({ state: { ...WAITING, clock: { simMs: 42_000, lastRealNow: NOW } }, isFrozen: true }),
    )
    // Sim time does not advance while frozen (D11), so the silhouettes hold still.
    expect(frozenLater.split('\n')[1]).toBe('   ><>                     <><')

    const other = text(mono({ state: WAITING, sessionSeed: AMBIENT_FIXTURE_SEED + 1 }))
    expect(other).not.toBe(still)
  })
})

// ------------------------------------------------------------- narrow tiers

describe('F-BAND-60COL-* (40–69 columns: pond 16 columns, no silhouettes)', () => {
  test('F-BAND-60COL-WAITING', () => {
    expect(text(mono({ state: WAITING, bodyColumns: 60 }))).toBe('~~~~~~~o~~~~~~~~  waiting · 0:42')
  })

  test('F-BAND-60COL-RARE', () => {
    expect(text(mono({ state: hookedState('rare'), bodyColumns: 60 }))).toBe(
      '~~~~~~~!~~~~~~~~  ! RARE · 0:14  1: reel',
    )
  })
})

describe('F-BAND-36COL-* (<40 columns: text only)', () => {
  test('F-BAND-36COL-WAITING', () => {
    expect(text(mono({ state: WAITING, bodyColumns: 36 }))).toBe('waiting · 0:42')
  })

  test('F-BAND-36COL-RARE', () => {
    expect(text(mono({ state: hookedState('rare'), bodyColumns: 36 }))).toBe('! RARE · 0:14  1: reel')
  })
})

describe('F-BAND-TOO-NARROW (the button cannot fit)', () => {
  test('the countdown pauses, the fish is kept, and the model says why', () => {
    const input = mono({ state: hookedState('rare'), bodyColumns: 20 })
    expect(text(input)).toBe('! RARE · paused')

    const model = renderBand(input)
    expect(model?.reelButton).toBe(null)
    expect(model?.meta.reelBlockedByLayout).toBe(true)
  })

  test('a width that fits the button is not blocked', () => {
    const model = renderBand(mono({ state: hookedState('rare'), bodyColumns: 36 }))
    expect(model?.meta.reelBlockedByLayout).toBe(false)
    expect(model?.reelButton).toEqual({ label: 'reel', hotkey: '1' })
  })

  test('a frozen encounter hides the button without blaming the layout', () => {
    const model = renderBand(mono({ state: hookedState('rare'), bodyColumns: 20, isFrozen: true }))
    expect(model?.reelButton).toBe(null)
    expect(model?.meta.reelBlockedByLayout).toBe(false)
  })
})

// ------------------------------------------------------------ F-RESULT-* holds

describe('F-RESULT-MIN-HOLD', () => {
  test('a result inside its minimum hold survives the next cast', () => {
    const held = mono({
      state: WAITING,
      lastResult: CAUGHT_RARE,
      resultShownAt: NOW - (RESULT_MIN_HOLD_RARE_MS - 1000),
    })
    expect(text(held)).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~  ★ caught · Common fangtooth',
        '                                         14 cm · RARE',
      ].join('\n'),
    )
    expect(renderBand(held)?.meta.resultHeld).toBe(true)
  })

  test('once the hold is over the new cast takes the band back', () => {
    const over = mono({
      state: WAITING,
      lastResult: CAUGHT_RARE,
      resultShownAt: NOW - RESULT_MIN_HOLD_RARE_MS,
    })
    expect(text(over)).toBe(
      [
        '~~~~~~~~~~~~~~~~~~~o~~~~~~~~~~~~~~~~~~~  waiting · 0:42',
        '   ><>                     <><           depth 3 m',
      ].join('\n'),
    )
    expect(renderBand(over)?.meta.resultHeld).toBe(false)
  })

  test('common and uncommon hold for 3 s, rare and legendary for 6 s', () => {
    expect(RESULT_MIN_HOLD_MS).toBe(3000)
    expect(RESULT_MIN_HOLD_RARE_MS).toBe(6000)

    const commonAt = (ageMs: number): boolean =>
      renderBand(
        mono({ state: WAITING, lastResult: CAUGHT_COMMON, resultShownAt: NOW - ageMs }),
      )?.meta.resultHeld === true

    expect(commonAt(2999)).toBe(true)
    expect(commonAt(3000)).toBe(false)

    const rareAt = (ageMs: number): boolean =>
      renderBand(
        mono({ state: WAITING, lastResult: CAUGHT_RARE, resultShownAt: NOW - ageMs }),
      )?.meta.resultHeld === true

    expect(rareAt(5999)).toBe(true)
    expect(rareAt(6000)).toBe(false)
  })

  test('an idle pond keeps showing the result long after the hold, dimmed past 60 s', () => {
    const model = renderBand(
      mono({ state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - 120_000 }),
    )
    expect(model).not.toBe(null)
    expect(model?.meta.resultHeld).toBe(false)
    expect(model?.meta.resultDimmed).toBe(true)
  })
})

// --------------------------------------------------------------- F-COLOR-*

describe('F-COLOR-*: the coloured model, stripped of colour, is the mono baseline', () => {
  const cases: Array<[string, Partial<BandInput> & { state: PondState }]> = [
    ['F-BAND-WAITING', { state: WAITING }],
    ['F-BAND-BITE-COMMON', { state: biteState('common') }],
    ['F-BAND-BITE-UNCOMMON', { state: biteState('uncommon') }],
    ['F-BAND-RARE-HOOKED', { state: hookedState('rare') }],
    ['F-BAND-LEGENDARY-HOOKED', { state: hookedState('legendary') }],
    ['F-BAND-RARE-DRAFT', { state: hookedState('rare'), isDraft: true }],
    ['F-BAND-FROZEN', { state: WAITING, isFrozen: true }],
    ['F-BAND-FROZEN-RARE', { state: hookedState('rare'), isFrozen: true }],
    ['F-BAND-CARRIED', { state: carriedState('running') }],
    ['F-BAND-CARRIED-DRAFT', { state: carriedState('blocked'), isDraft: true }],
    ['F-BAND-CAUGHT-COMMON', { state: IDLE, lastResult: CAUGHT_COMMON, resultShownAt: NOW - 1000 }],
    ['F-BAND-CAUGHT-RARE', { state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - 1000 }],
    ['F-BAND-SIGHTED', { state: IDLE, lastResult: SIGHTED_RARE, resultShownAt: NOW - 1000 }],
    [
      'F-BAND-RESULT-DIM',
      { state: IDLE, lastResult: CAUGHT_RARE, resultShownAt: NOW - RESULT_DIM_AFTER_MS },
    ],
    ['F-BAND-60COL-WAITING', { state: WAITING, bodyColumns: 60 }],
    ['F-BAND-60COL-RARE', { state: hookedState('rare'), bodyColumns: 60 }],
    ['F-BAND-36COL-WAITING', { state: WAITING, bodyColumns: 36 }],
    ['F-BAND-36COL-RARE', { state: hookedState('rare'), bodyColumns: 36 }],
    ['F-BAND-TOO-NARROW', { state: hookedState('rare'), bodyColumns: 20 }],
  ]

  for (const [name, over] of cases) {
    test(`${name} in colour carries the same characters`, () => {
      const monoModel = renderBand(mono(over))
      const colourModel = renderBand({ ...mono(over), noColor: false })
      expect(monoModel).not.toBe(null)
      expect(colourModel).not.toBe(null)
      expect(toPlainText(colourModel!)).toBe(toPlainText(monoModel!))
      expect(stripColor(colourModel!)).toEqual(monoModel!)
    })
  }

  test('a coloured model really does carry palette tokens', () => {
    const model = renderBand({ ...mono({ state: hookedState('rare') }), noColor: false })
    const cells = model?.raster?.cells ?? []
    expect(cells.some((cell) => cell.bg === 'water.surface')).toBe(true)
    expect(cells.some((cell) => cell.fg === 'fish.rare')).toBe(true)

    const ambient = renderBand({ ...mono({ state: WAITING }), noColor: false })
    expect((ambient?.raster?.cells ?? []).some((cell) => cell.fg === 'fish.common')).toBe(true)
  })

  test('noColor leaves every token null without changing a character', () => {
    const model = renderBand(mono({ state: hookedState('rare') }))
    for (const cell of model?.raster?.cells ?? []) {
      expect(cell.fg).toBe(null)
      expect(cell.bg).toBe(null)
    }
    for (const row of model?.rows ?? []) {
      for (const segment of row.segments) expect(segment.color).toBe(null)
    }
    expect(model?.meta.noColor).toBe(true)
  })
})
