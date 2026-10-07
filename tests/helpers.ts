// Shared test fixtures and a tiny deterministic pond harness.
//
// Everything is injected: time comes from a fixed epoch, randomness from a
// seeded RNG, and the bite delay is pinned so no test depends on luck.

import { withParams, type PondParams } from '../src/core/params.ts'
import {
  createPondState,
  step,
  type PondCtx,
  type PondEffect,
  type PondEvent,
  type PondState,
} from '../src/core/pond.ts'
import type { CatchRecord } from '../src/core/records.ts'
import type { Species, Tier } from '../src/core/types.ts'

/** A fixed, boring instant. Nothing in src/** ever reads a real clock. */
export const T0 = 1_700_000_000_000

function fixture(id: string, rarity: Tier, overrides: Partial<Species> = {}): Species {
  return {
    id,
    common_name: `Test ${rarity}`,
    scientific_name: 'Testus fixtura',
    // min === typical === max keeps the size draw from consuming the RNG.
    size_cm: { min: 10, typical: 10, max: 10 },
    depth_zone: 'epipelagic',
    activity: 'diurnal',
    rarity,
    source_refs: ['Written summary: synthetic test fixture, not a real species.'],
    ...overrides,
  }
}

export const COMMON_FISH = fixture('test-common', 'common')
export const UNCOMMON_FISH = fixture('test-uncommon', 'uncommon')
export const RARE_FISH = fixture('test-rare', 'rare')
export const LEGENDARY_FISH = fixture('test-legendary', 'legendary')

export const TEST_PARAMS: Partial<PondParams> = {
  biteDelayMinMs: 1000,
  biteDelayMaxMs: 1000,
  biteRetryMs: 1000,
  rareWindowMs: 5000,
  carryGraceMs: 10000,
  postSubmitGraceMs: 45000,
  // The gate's luck draw always passes; context and budget still have to hold.
  rareEncounterChance: 1,
}

export type Harness = {
  readonly state: PondState
  readonly now: number
  readonly params: PondParams
  readonly all: PondEffect[]
  send(event: PondEvent, overrides?: Partial<PondCtx>): PondEffect[]
  advanceBy(ms: number, overrides?: Partial<PondCtx>): PondEffect[]
}

export function makeHarness(
  options: {
    params?: Partial<PondParams>
    species?: readonly Species[]
    ctx?: Partial<PondCtx>
    seed?: number
  } = {},
): Harness {
  const params = withParams({ ...TEST_PARAMS, ...(options.params ?? {}) })
  const species = options.species ?? [COMMON_FISH]
  let state = createPondState(options.seed ?? 7)
  let now = T0
  const all: PondEffect[] = []

  const ctxFor = (overrides: Partial<PondCtx>): PondCtx => ({
    now,
    params,
    species,
    hourOfDay: 12,
    sessionId: 'sess-1',
    repo: 'reelquiet',
    files: ['pond.ts'],
    ...(options.ctx ?? {}),
    ...overrides,
  })

  const send = (event: PondEvent, overrides: Partial<PondCtx> = {}): PondEffect[] => {
    const result = step(state, event, ctxFor(overrides))
    state = result.state
    all.push(...result.effects)
    return result.effects
  }

  const advanceBy = (ms: number, overrides: Partial<PondCtx> = {}): PondEffect[] => {
    const ticks = Math.max(1, Math.round(ms / params.tickMs))
    const effects: PondEffect[] = []
    for (let i = 0; i < ticks; i++) {
      now += params.tickMs
      effects.push(...send({ type: 'tick' }, overrides))
    }
    return effects
  }

  return {
    get state() {
      return state
    },
    get now() {
      return now
    },
    params,
    all,
    send,
    advanceBy,
  }
}

export function records(effects: readonly PondEffect[]): CatchRecord[] {
  return effects.filter((e) => e.type === 'record').map((e) => (e as { record: CatchRecord }).record)
}

export function recordKeys(effects: readonly PondEffect[]): string[] {
  return effects.filter((e) => e.type === 'record').map((e) => (e as { key: string }).key)
}

export function encounters(effects: readonly PondEffect[]): PondEffect[] {
  return effects.filter((e) => e.type === 'encounter')
}

export function timerFlips(effects: readonly PondEffect[]): boolean[] {
  return effects.filter((e) => e.type === 'timer').map((e) => (e as { on: boolean }).on)
}

export function debugMessages(effects: readonly PondEffect[]): string[] {
  return effects.filter((e) => e.type === 'debug').map((e) => (e as { msg: string }).msg)
}

/** Drive a cast through to a hooked rare+ fish, with a live coding context. */
export function hookRare(harness: Harness): void {
  harness.send({ type: 'cast' })
  // D9 ①: a tool call inside the turn is what makes the context "active".
  harness.send({ type: 'activity', kind: 'tool-call' })
  harness.advanceBy(1000)
}
