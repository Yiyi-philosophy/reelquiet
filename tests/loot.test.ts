import { describe, expect, test } from 'claude-code/testing'

import { InvalidBaitError, candidates, rareGateOpen, roll, type LootCtx } from '../src/core/loot.ts'
import { depthForWait, timeOfDayForHour, withParams } from '../src/core/params.ts'
import { createRng, deriveRng, hashSeed } from '../src/core/rng.ts'
import type { Species } from '../src/core/types.ts'
import { COMMON_FISH, RARE_FISH } from './helpers.ts'

const SIZED: Species = {
  ...COMMON_FISH,
  id: 'sized-common',
  size_cm: { min: 20, typical: 30, max: 60 },
}

const DEEP_NIGHT_RARE: Species = {
  ...RARE_FISH,
  id: 'deep-rare',
  depth_zone: 'bathypelagic',
  activity: 'nocturnal',
}

function ctxFor(overrides: Partial<LootCtx> = {}): LootCtx {
  return {
    species: [SIZED],
    params: withParams(),
    waitMs: 0,
    hourOfDay: 12,
    bait: 'none',
    codingContextActive: false,
    todayRareCount: 0,
    ...overrides,
  }
}

describe('rng', () => {
  test('the same seed replays the same sequence', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const left = [a.next(), a.next(), a.nextInt(100), a.nextFloat(1, 2)]
    const right = [b.next(), b.next(), b.nextInt(100), b.nextFloat(1, 2)]
    expect(left).toEqual(right)
  })

  test('different seeds diverge, and every draw stays in range', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a.next()).not.toBe(b.next())

    const rng = createRng(99)
    for (let i = 0; i < 500; i++) {
      const value = rng.next()
      expect(value >= 0 && value < 1).toBe(true)
      expect(rng.nextInt(7) < 7).toBe(true)
    }
    expect(createRng(5).nextInt(0)).toBe(0)
    expect(createRng(5).nextFloat(3, 3)).toBe(3)
    expect(createRng(5).pick([])).toBeUndefined()
  })

  test('state() round-trips so a reload resumes the same stream', () => {
    const first = createRng(7)
    first.next()
    const resumed = createRng(first.state())
    expect(resumed.next()).toBe(createRng(first.state()).next())
  })

  test('string seeds are stable and label-derived streams differ', () => {
    expect(hashSeed('sess-1')).toBe(hashSeed('sess-1'))
    expect(hashSeed('sess-1')).not.toBe(hashSeed('sess-2'))
    expect(deriveRng(5, 'bite').next()).not.toBe(deriveRng(5, 'size').next())
  })
})

describe('depth and time mapping', () => {
  test('waiting longer reaches a deeper zone', () => {
    const params = withParams()
    expect(depthForWait(params, 0)).toBe('epipelagic')
    expect(depthForWait(params, 29999)).toBe('epipelagic')
    expect(depthForWait(params, 30000)).toBe('mesopelagic')
    expect(depthForWait(params, 119999)).toBe('mesopelagic')
    expect(depthForWait(params, 120000)).toBe('bathypelagic')
    expect(depthForWait(params, 10 ** 7)).toBe('bathypelagic')
  })

  test('night wraps across midnight', () => {
    const params = withParams()
    expect(timeOfDayForHour(params, 12)).toBe('day')
    expect(timeOfDayForHour(params, 18)).toBe('day')
    expect(timeOfDayForHour(params, 19)).toBe('night')
    expect(timeOfDayForHour(params, 2)).toBe('night')
    expect(timeOfDayForHour(params, 6)).toBe('day')
  })
})

describe('loot.roll', () => {
  test('a fixed seed gives a fixed result', () => {
    const a = createRng(2024)
    const b = createRng(2024)
    const ctx = ctxFor()
    const left = [roll(a, ctx), roll(a, ctx), roll(a, ctx)]
    const right = [roll(b, ctx), roll(b, ctx), roll(b, ctx)]
    expect(left).toEqual(right)
    expect(left[0]?.species.id).toBe('sized-common')
  })

  test('a different seed gives a different size', () => {
    const ctx = ctxFor()
    const sizes = new Set([1, 2, 3, 4, 5].map((seed) => roll(createRng(seed), ctx)?.sizeCm))
    expect(sizes.size > 1).toBe(true)
  })

  test('sizes stay inside the species distribution', () => {
    const ctx = ctxFor()
    const rng = createRng(31)
    for (let i = 0; i < 300; i++) {
      const result = roll(rng, ctx)
      expect(result).toBeDefined()
      expect((result?.sizeCm ?? 0) >= SIZED.size_cm.min).toBe(true)
      expect((result?.sizeCm ?? 0) <= SIZED.size_cm.max).toBe(true)
    }
  })

  test("D2: bait 'none' is the only legal value in Stage 1", () => {
    const rng = createRng(1)
    expect(roll(rng, ctxFor({ bait: 'none' }))).toBeDefined()
    expect(roll(createRng(1), ctxFor({ bait: undefined }))).toBeDefined()
    expect(() => roll(createRng(1), ctxFor({ bait: 'golden' as never }))).toThrow(InvalidBaitError)
    expect(() => roll(createRng(1), ctxFor({ bait: '' as never }))).toThrow()
  })

  test('depth and time of day decide who is even available', () => {
    const ctx = ctxFor({
      species: [SIZED, DEEP_NIGHT_RARE],
      codingContextActive: true,
      params: withParams({ rareEncounterChance: 1 }),
    })

    // Shallow and daylight: only the epipelagic diurnal fish is home.
    expect(roll(createRng(3), { ...ctx, waitMs: 0, hourOfDay: 12 })?.species.id).toBe('sized-common')
    // Deep and dark: only the bathypelagic nocturnal fish is home.
    expect(roll(createRng(3), { ...ctx, waitMs: 200000, hourOfDay: 23 })?.species.id).toBe('deep-rare')
    // Deep and bright: nobody is home, and we do not invent a fish.
    expect(roll(createRng(3), { ...ctx, waitMs: 200000, hourOfDay: 12 })).toBeNull()
  })
})

describe('D9 encounter budget gate', () => {
  const rareCtx = (overrides: Partial<LootCtx> = {}): LootCtx =>
    ctxFor({
      species: [DEEP_NIGHT_RARE],
      waitMs: 200000,
      hourOfDay: 23,
      codingContextActive: true,
      params: withParams({ rareEncounterChance: 1, dailyRareBudget: 2 }),
      ...overrides,
    })

  test('all three conditions have to hold', () => {
    expect(roll(createRng(9), rareCtx())?.tier).toBe('rare')

    // ① no active coding context
    expect(roll(createRng(9), rareCtx({ codingContextActive: false }))).toBeNull()
    // ② today's budget is spent
    expect(roll(createRng(9), rareCtx({ todayRareCount: 2 }))).toBeNull()
    expect(roll(createRng(9), rareCtx({ todayRareCount: 5 }))).toBeNull()
    // ③ the RNG said no
    expect(
      roll(createRng(9), rareCtx({ params: withParams({ rareEncounterChance: 0, dailyRareBudget: 2 }) })),
    ).toBeNull()
  })

  test('the gate itself reports the same thing', () => {
    expect(rareGateOpen(createRng(1), rareCtx())).toBe(true)
    expect(rareGateOpen(createRng(1), rareCtx({ todayRareCount: 2 }))).toBe(false)
    expect(rareGateOpen(createRng(1), rareCtx({ codingContextActive: false }))).toBe(false)
  })

  test('the budget is a soft cap: the count comes in as a plain number, never locked', () => {
    // O4: with no CAS there is no upper bound on concurrent overshoot. All the
    // core can promise is that it honours whatever count it was handed.
    const atCap = rareCtx({ todayRareCount: 2 })
    expect(rareGateOpen(createRng(1), atCap)).toBe(false)
    // A stale read of 1 (a sibling session wrote after we read) still passes,
    // which is exactly the documented overshoot.
    expect(rareGateOpen(createRng(1), rareCtx({ todayRareCount: 1 }))).toBe(true)
  })

  test('a shut gate hides rare species from the candidate list entirely', () => {
    const pool = [SIZED, { ...DEEP_NIGHT_RARE, depth_zone: 'epipelagic' as const, activity: 'diurnal' as const }]
    expect(candidates(pool, 'epipelagic', 'day', true).map((s) => s.id)).toEqual(['sized-common', 'deep-rare'])
    expect(candidates(pool, 'epipelagic', 'day', false).map((s) => s.id)).toEqual(['sized-common'])
  })
})
