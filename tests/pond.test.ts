import { describe, expect, test } from 'claude-code/testing'

import { advance, createClock } from '../src/core/clock.ts'
import {
  createPondState,
  reelActionable,
  reelAvailable,
  step,
  timerOn,
  type PondState,
} from '../src/core/pond.ts'
import { withParams } from '../src/core/params.ts'
import {
  COMMON_FISH,
  LEGENDARY_FISH,
  RARE_FISH,
  T0,
  TEST_PARAMS,
  debugMessages,
  encounters,
  hookRare,
  makeHarness,
  recordKeys,
  records,
  timerFlips,
} from './helpers.ts'

describe('bite and auto-reel', () => {
  test('D-REEL: a common fish auto-reels on the bite and needs no input', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    h.send({ type: 'cast' })
    expect(h.state.phase).toBe('waiting')

    const effects = h.advanceBy(1000)
    const caught = records(effects)

    expect(caught).toHaveLength(1)
    expect(caught[0].outcome).toBe('caught')
    expect(caught[0].rarity).toBe('common')
    expect(caught[0].species).toBe('test-common')
    expect(h.state.phase).toBe('idle')
    expect(h.state.lastResult?.from).toBe('bite')
  })

  test('the timer runs for waiting/hooked and stops at idle', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    expect(timerOn(h.state)).toBe(false)

    expect(timerFlips(h.send({ type: 'cast' }))).toEqual([true])
    expect(timerOn(h.state)).toBe(true)

    expect(timerFlips(h.advanceBy(1000))).toEqual([false])
    expect(timerOn(h.state)).toBe(false)
  })

  test('long pure reasoning (only ticks, no tool events) still advances the pond', () => {
    // No `activity` event ever fires, so D9 ① keeps the rare gate shut, but the
    // sim clock still runs off plain ticks and the common fish still bites.
    const h = makeHarness({ species: [COMMON_FISH, RARE_FISH] })
    h.send({ type: 'cast' })
    const effects = h.advanceBy(1000)

    expect(h.state.contextActive).toBe(false)
    expect(records(effects)).toHaveLength(1)
    expect(records(effects)[0].rarity).toBe('common')
  })
})

describe('manual reel for the rare tier', () => {
  test('rare needs a manual reel and lands one on time', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    expect(h.state.phase).toBe('hooked')
    expect(h.state.fish?.tier).toBe('rare')
    expect(reelAvailable(h.state)).toBe(true)

    const effects = h.send({ type: 'reel' })
    const caught = records(effects)
    expect(caught).toHaveLength(1)
    expect(caught[0].outcome).toBe('caught')
    expect(caught[0].rarity).toBe('rare')
    expect(h.state.phase).toBe('idle')
  })

  test('legendary needs a manual reel too', () => {
    const h = makeHarness({ species: [LEGENDARY_FISH] })
    hookRare(h)

    expect(h.state.phase).toBe('hooked')
    expect(h.state.fish?.tier).toBe('legendary')

    const caught = records(h.send({ type: 'reel' }))
    expect(caught[0].rarity).toBe('legendary')
    expect(caught[0].outcome).toBe('caught')
  })

  test('D-SIGHT: a missed rare window becomes a sighting, not nothing', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    const effects = h.advanceBy(5100)
    const settled = records(effects)
    expect(settled).toHaveLength(1)
    expect(settled[0].outcome).toBe('sighted')
    expect(recordKeys(effects)[0].startsWith('v1:s:')).toBe(true)
    expect(h.state.phase).toBe('idle')
    expect(h.state.lastResult?.from).toBe('timeout')
  })

  test('D9: a rare encounter also appends one v1:e: budget key', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    const keys = encounters(h.all).map((e) => (e as { key: string }).key)
    expect(keys).toHaveLength(1)
    expect(/^v1:e:\d{4}-\d{2}-\d{2}:sess-1:\d+$/.test(keys[0])).toBe(true)
  })
})

describe('D11 activeFreezes is an identity set', () => {
  test('two parallel ids both have to be released before time runs again', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    const windowAtFreeze = h.state.windowRemainingMs

    h.send({ type: 'freeze', id: 'tool-call-1' })
    h.send({ type: 'freeze', id: 'elicitation:9' })
    expect(h.state.activeFreezes).toEqual(['elicitation:9', 'tool-call-1'])
    expect(reelAvailable(h.state)).toBe(false)

    h.advanceBy(60000)
    expect(h.state.phase).toBe('hooked')
    expect(h.state.windowRemainingMs).toBe(windowAtFreeze)

    h.send({ type: 'unfreeze', id: 'tool-call-1' })
    expect(h.state.activeFreezes).toEqual(['elicitation:9'])
    h.advanceBy(60000)
    expect(h.state.phase).toBe('hooked')

    h.send({ type: 'unfreeze', id: 'elicitation:9' })
    expect(h.state.activeFreezes).toEqual([])
    expect(reelAvailable(h.state)).toBe(true)

    const effects = h.advanceBy(5100)
    expect(records(effects)[0].outcome).toBe('sighted')
  })

  test('it is a set, not a counter: the same id twice releases once', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    h.send({ type: 'freeze', id: 'tool-call-1' })
    h.send({ type: 'freeze', id: 'tool-call-1' })
    expect(h.state.activeFreezes).toEqual(['tool-call-1'])

    h.send({ type: 'unfreeze', id: 'tool-call-1' })
    expect(h.state.activeFreezes).toEqual([])
  })

  test('an unfreeze for an id we never held changes nothing', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'freeze', id: 'a' })

    const effects = h.send({ type: 'unfreeze', id: 'ghost' })
    expect(h.state.activeFreezes).toEqual(['a'])
    expect(debugMessages(effects).join(' ')).toContain('not held')
  })

  for (const event of ['complete', 'abort', 'reset', 'cast'] as const) {
    test(`${event} clears stale freezes and says so in a debug effect`, () => {
      const h = makeHarness({ species: [COMMON_FISH] })
      h.send({ type: 'cast' })
      h.send({ type: 'freeze', id: 'leaked-1' })
      expect(h.state.activeFreezes).toEqual(['leaked-1'])

      const effects = h.send({ type: event })
      expect(h.state.activeFreezes).toEqual([])
      expect(debugMessages(effects).join(' ')).toContain('stale freeze')
    })
  }

  test('after a freeze leaked through a complete, the next cast fishes normally', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    h.send({ type: 'cast' })
    h.send({ type: 'freeze', id: 'leaked-1' })
    h.send({ type: 'complete' })

    h.send({ type: 'cast' })
    expect(h.state.phase).toBe('waiting')
    expect(records(h.advanceBy(1000))).toHaveLength(1)
  })
})

describe('D13 carried, draft-blocked, grace', () => {
  function carryWithDraft() {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'draftChanged', isDraft: true })
    h.send({ type: 'complete' })
    return h
  }

  test('a turn completing on a hooked rare carries it with a grace countdown', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    const effects = h.send({ type: 'complete' })
    expect(h.state.phase).toBe('carried')
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 10000 })
    expect(timerFlips(effects)).toEqual([])
    expect(timerOn(h.state)).toBe(true)
  })

  test('draft-blocked carried has no timer and never times out', () => {
    const h = carryWithDraft()
    expect(h.state.phase).toBe('carried')
    expect(h.state.carry).toEqual({ grace: 'blocked', remainingMs: 0 })
    expect(timerOn(h.state)).toBe(false)

    h.advanceBy(600000)
    expect(h.state.phase).toBe('carried')
    expect(records(h.all)).toHaveLength(0)
  })

  test('clearing the draft starts a fixed postSubmitGraceMs that expires to a sighting', () => {
    const h = carryWithDraft()
    h.advanceBy(600000)

    h.send({ type: 'draftChanged', isDraft: false })
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 45000 })
    expect(timerOn(h.state)).toBe(true)

    h.advanceBy(44900)
    expect(h.state.phase).toBe('carried')

    const effects = h.advanceBy(200)
    expect(records(effects)[0].outcome).toBe('sighted')
    expect(h.state.phase).toBe('idle')
  })

  test('typing during the grace window blocks it again, and clearing restarts it fixed', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })
    h.advanceBy(5000)
    expect(h.state.carry?.remainingMs).toBe(5000)

    h.send({ type: 'draftChanged', isDraft: true })
    expect(h.state.carry).toEqual({ grace: 'blocked', remainingMs: 0 })

    // Stage 1 never resumes a remainder: the window comes back at full length.
    h.send({ type: 'draftChanged', isDraft: false })
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 45000 })
  })

  test('the grace window pauses while frozen', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })

    h.send({ type: 'freeze', id: 'permission:1' })
    h.advanceBy(600000)
    expect(h.state.phase).toBe('carried')
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 10000 })

    h.send({ type: 'unfreeze', id: 'permission:1' })
    expect(records(h.advanceBy(10100))[0].outcome).toBe('sighted')
  })

  test('a carried fish can still be reeled in', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })

    const caught = records(h.send({ type: 'reel' }))
    expect(caught[0].outcome).toBe('caught')
    expect(caught[0].rarity).toBe('rare')
    expect(h.state.phase).toBe('idle')
  })

  test('at most one unresolved rare encounter: a cast while carried starts nothing', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })

    const effects = h.send({ type: 'cast' })
    expect(h.state.phase).toBe('carried')
    expect(h.state.pendingCast).toBe(true)
    expect(debugMessages(effects).join(' ')).toContain('cast held')

    // No new bite can happen while it is unresolved.
    h.advanceBy(5000)
    expect(h.state.phase).toBe('carried')
    expect(h.state.fish?.tier).toBe('rare')

    // Once it resolves, the held cast finally goes out.
    h.send({ type: 'reel' })
    expect(h.state.phase).toBe('waiting')
    expect(h.state.pendingCast).toBe(false)
  })
})

describe('D-ABORT and reset', () => {
  test('abort while waiting gives no record and no reward', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    h.send({ type: 'cast' })

    const effects = h.send({ type: 'abort' })
    expect(records(effects)).toHaveLength(0)
    expect(h.state.phase).toBe('idle')
    expect(debugMessages(effects).join(' ')).toContain('no rewards')
  })

  test('abort on a hooked rare records a sighting and clears freezes', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'freeze', id: 'permission:1' })

    const effects = h.send({ type: 'abort' })
    expect(records(effects)[0].outcome).toBe('sighted')
    expect(h.state.activeFreezes).toEqual([])
    expect(h.state.phase).toBe('idle')
  })

  test('abort on a hooked common lets it go with no record at all', () => {
    // Not reachable through the reducer (commons auto-reel) — this covers the
    // defensive branch D-ABORT spells out.
    const params = withParams(TEST_PARAMS)
    const hooked: PondState = {
      ...createPondState(1),
      phase: 'hooked',
      fish: { speciesId: 'test-common', tier: 'common', sizeCm: 10, depthZone: 'epipelagic', bitAtSim: 0 },
    }
    const { state, effects } = step(hooked, { type: 'abort' }, { now: T0, params, species: [COMMON_FISH] })

    expect(records(effects)).toHaveLength(0)
    expect(state.lastResult?.kind).toBe('escaped')
    expect(state.phase).toBe('idle')
  })

  test('reset turns a hooked rare into a sighting and returns to idle', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    const effects = h.send({ type: 'reset' })
    expect(records(effects)[0].outcome).toBe('sighted')
    expect(h.state.phase).toBe('idle')
    expect(h.state.activeFreezes).toEqual([])
  })

  test('reset turns a carried rare into a sighting and drops the held cast', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })
    h.send({ type: 'cast' })

    const effects = h.send({ type: 'reset' })
    expect(records(effects)[0].outcome).toBe('sighted')
    expect(h.state.phase).toBe('idle')
    expect(h.state.pendingCast).toBe(false)
  })

  test('complete while waiting settles to idle with no record', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    h.send({ type: 'cast' })

    const effects = h.send({ type: 'complete' })
    expect(records(effects)).toHaveLength(0)
    expect(h.state.phase).toBe('idle')
    expect(timerFlips(effects)).toEqual([false])
  })
})

describe('D-HOTKEY reelAvailable truth table', () => {
  const base = createPondState(1)
  const fish = (tier: 'common' | 'rare') => ({
    speciesId: 'x',
    tier,
    sizeCm: 10,
    depthZone: 'epipelagic' as const,
    bitAtSim: 0,
  })

  const cases: Array<[string, PondState, boolean]> = [
    ['idle', base, false],
    ['waiting', { ...base, phase: 'waiting' }, false],
    ['hooked common', { ...base, phase: 'hooked', fish: fish('common') }, false],
    ['hooked rare', { ...base, phase: 'hooked', fish: fish('rare') }, true],
    ['hooked rare, frozen', { ...base, phase: 'hooked', fish: fish('rare'), activeFreezes: ['a'] }, false],
    ['carried', { ...base, phase: 'carried', fish: fish('rare'), carry: { grace: 'running', remainingMs: 1 } }, true],
    ['carried, frozen', { ...base, phase: 'carried', fish: fish('rare'), activeFreezes: ['a'] }, false],
  ]

  for (const [name, state, expected] of cases) {
    test(`${name} -> ${expected}`, () => {
      expect(reelAvailable(state, state.isDraft)).toBe(expected)
    })
  }

  test('a draft does not hide the button (D-HOTKEY) but does stop the countdown (D13)', () => {
    const hooked: PondState = { ...base, phase: 'hooked', fish: fish('rare'), isDraft: true }
    expect(reelAvailable(hooked, true)).toBe(true)
    expect(reelActionable(hooked, true)).toBe(false)
    expect(reelActionable({ ...hooked, isDraft: false }, false)).toBe(true)
  })

  test('a reel with nothing on the line is ignored with a debug note', () => {
    const h = makeHarness({ species: [COMMON_FISH] })
    h.send({ type: 'cast' })

    const effects = h.send({ type: 'reel' })
    expect(records(effects)).toHaveLength(0)
    expect(debugMessages(effects).join(' ')).toContain('reel ignored')
  })

  test('a reel while frozen is ignored', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'freeze', id: 'permission:1' })

    expect(records(h.send({ type: 'reel' }))).toHaveLength(0)
    expect(h.state.phase).toBe('hooked')
  })
})

describe('the simulated clock', () => {
  test('it advances from the injected now and never while frozen', () => {
    const start = createClock(T0)
    const running = advance(start, T0 + 500, false)
    expect(running.dt).toBe(500)
    expect(running.clock.simMs).toBe(500)

    const frozen = advance(running.clock, T0 + 5000, true)
    expect(frozen.dt).toBe(0)
    expect(frozen.clock.simMs).toBe(500)
    expect(frozen.clock.lastRealNow).toBe(T0 + 5000)

    const backwards = advance(frozen.clock, T0, false)
    expect(backwards.dt).toBe(0)
    expect(backwards.clock.simMs).toBe(500)
  })
})

describe('the D1 record safety cap', () => {
  test('a plain catch is dropped at the cap; a sighting never is', () => {
    const h = makeHarness({ species: [COMMON_FISH], ctx: { detailedRecordCount: 2000 } })
    h.send({ type: 'cast' })
    const effects = h.advanceBy(1000)

    expect(records(effects)).toHaveLength(0)
    expect(debugMessages(effects).join(' ')).toContain('record cap 2000 reached')

    const rare = makeHarness({ species: [RARE_FISH], ctx: { detailedRecordCount: 2000 } })
    hookRare(rare)
    expect(records(rare.send({ type: 'reel' }))).toHaveLength(1)
  })
})

describe('D-T2 / V-NARROW: a reel button that cannot fit pauses the same way a draft does', () => {
  test('the rare window stops counting while the layout blocks the reel', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    expect(h.state.windowRemainingMs).toBe(5000)

    h.send({ type: 'layoutChanged', blocked: true })
    expect(h.state.layoutBlocked).toBe(true)
    expect(reelActionable(h.state)).toBe(false)

    h.advanceBy(600000)
    expect(h.state.phase).toBe('hooked')
    expect(h.state.windowRemainingMs).toBe(5000)
    expect(records(h.all)).toHaveLength(0)
  })

  test('widening the terminal lets the same window run out to a sighting', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'layoutChanged', blocked: true })
    h.advanceBy(600000)

    h.send({ type: 'layoutChanged', blocked: false })
    expect(reelActionable(h.state)).toBe(true)

    h.advanceBy(4900)
    expect(h.state.phase).toBe('hooked')
    expect(records(h.advanceBy(200))[0].outcome).toBe('sighted')
  })

  test('the layout never loses the fish: a reel still lands it while blocked', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'layoutChanged', blocked: true })

    expect(reelAvailable(h.state)).toBe(true)
    const caught = records(h.send({ type: 'reel' }))
    expect(caught[0].outcome).toBe('caught')
    expect(caught[0].rarity).toBe('rare')
  })

  test('the carried grace blocks and restarts exactly like the draft path', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 10000 })

    h.send({ type: 'layoutChanged', blocked: true })
    expect(h.state.carry).toEqual({ grace: 'blocked', remainingMs: 0 })
    expect(timerOn(h.state)).toBe(false)

    h.advanceBy(600000)
    expect(h.state.phase).toBe('carried')

    h.send({ type: 'layoutChanged', blocked: false })
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 45000 })
    expect(timerOn(h.state)).toBe(true)
  })

  test('a draft and a blocked layout both have to clear before the grace runs again', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'complete' })

    h.send({ type: 'draftChanged', isDraft: true })
    h.send({ type: 'layoutChanged', blocked: true })
    expect(h.state.carry).toEqual({ grace: 'blocked', remainingMs: 0 })

    h.send({ type: 'draftChanged', isDraft: false })
    expect(h.state.carry).toEqual({ grace: 'blocked', remainingMs: 0 })

    h.send({ type: 'layoutChanged', blocked: false })
    expect(h.state.carry).toEqual({ grace: 'running', remainingMs: 45000 })
  })

  test('ctx.reelBlockedByLayout carries the same signal as the event', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)

    h.advanceBy(1000, { reelBlockedByLayout: true })
    expect(h.state.layoutBlocked).toBe(true)
    expect(h.state.windowRemainingMs).toBe(5000)
  })

  test('blocking the layout adds no new phase', () => {
    const h = makeHarness({ species: [RARE_FISH] })
    hookRare(h)
    h.send({ type: 'layoutChanged', blocked: true })
    expect(h.state.phase).toBe('hooked')
    h.send({ type: 'complete' })
    expect(h.state.phase).toBe('carried')
  })
})
