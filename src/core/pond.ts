// ReelQuiet — the pond state machine.
//
// A pure reducer: `step(state, event, ctx) -> { state, effects }`. No host API,
// no timers, no clock reads, no randomness beyond the seeded RNG carried in
// state. Effects are plain data for `hooks/register.ts` to carry out.
//
// Rules implemented here, with the decision each one comes from:
//   D-REEL   common/uncommon auto-reel on the bite; `tier >= rare` needs `reel`.
//   D-SIGHT  a missed rare+ becomes a sighting record, never nothing.
//   D11      `activeFreezes` is an identity set; while it is non-empty sim time
//            does not advance, no countdown runs, and the reel button is gone.
//            complete/abort/reset clear it; `cast` (turn.start) is the fallback
//            clear and says so in a debug effect.
//   D13      the rare window and the carried grace only run while a reel would
//            actually work (no draft, not frozen). A turn completing on a hooked
//            rare+ carries it; with a draft up it is draft-blocked and has no
//            timer at all. Clearing or sending the draft starts a fixed
//            `postSubmitGraceMs` — Stage 1 never resumes a partial window.
//            At most one unresolved rare encounter: a `cast` arriving while
//            carried does not start a new one, it waits.
//   D-ABORT  no rewards; a hooked common escapes with no record; a hooked rare+
//            becomes a sighting; freezes are cleared.
//   D9       a rare+ encounter also appends one `v1:e:` key for the day's soft
//            budget.
//   Stage 1  no sound, no bait numbers, no rewards, no store compaction.

import { advance, createClock, resync, type SimClock } from './clock.ts'
import { roll, type Bait } from './loot.ts'
import { DEFAULT_PARAMS, type PondParams } from './params.ts'
import {
  catchKey,
  encounterKey,
  makeEncounterRecord,
  makeRecord,
  sightingKey,
  type CatchRecord,
  type RareEncounterRecord,
} from './records.ts'
import { createRng } from './rng.ts'
import {
  isRareTier,
  utcDateOf,
  utcHourOf,
  type ControlledEventType,
  type DepthZone,
  type Species,
  type Tier,
} from './types.ts'

export type PondPhase = 'idle' | 'waiting' | 'hooked' | 'carried'

export type HookedFish = {
  speciesId: string
  tier: Tier
  sizeCm: number
  depthZone: DepthZone
  bitAtSim: number
}

/** D13: `blocked` means a draft is up — no timer, and it never times out. */
export type CarryState = {
  grace: 'blocked' | 'running'
  remainingMs: number
}

export type ResultKind = 'caught' | 'sighted' | 'escaped'

export type PondResult = {
  kind: ResultKind
  speciesId: string
  tier: Tier
  sizeCm: number
  /** Real `now` the result settled at. */
  at: number
  from: 'bite' | 'reel' | 'timeout' | 'abort' | 'reset' | 'complete'
}

export type PondState = {
  phase: PondPhase
  clock: SimClock
  castAtSim: number | null
  nextBiteAtSim: number | null
  fish: HookedFish | null
  /** Remaining active-reel window for a hooked rare+, in ms. */
  windowRemainingMs: number | null
  carry: CarryState | null
  /** D11: identity-keyed freeze set, kept as a sorted array so plugin state can hold it. */
  activeFreezes: string[]
  /** Last known `PromptHint.isDraft` (F3). */
  isDraft: boolean
  /** D9 ①: this turn has had a tool call or model request. */
  contextActive: boolean
  /** D13: a cast arrived while a carried rare was unresolved; throw it once resolved. */
  pendingCast: boolean
  lastEventType: ControlledEventType
  lastResult: PondResult | null
  /** Monotonic sequence for this session's `v1:` keys. */
  seq: number
  rngState: number
}

export type ActivityKind = 'tool-call' | 'model-request' | 'edit' | 'tests-green'

export type PondEvent =
  | { type: 'cast' }
  | { type: 'tick'; now?: number }
  | { type: 'reel' }
  | { type: 'freeze'; id: string }
  | { type: 'unfreeze'; id: string }
  | { type: 'draftChanged'; isDraft: boolean }
  | { type: 'activity'; kind: ActivityKind }
  | { type: 'complete' }
  | { type: 'abort' }
  | { type: 'reset' }

export type PondCtx = {
  /** Injected real time, epoch ms. The only clock src/** ever sees. */
  now: number
  params?: PondParams
  species?: readonly Species[]
  /** Injected hour of day (0-23); defaults to UTC from `now`. */
  hourOfDay?: number
  /** Injected UTC day for `v1:e:` keys; defaults to UTC from `now`. */
  date?: string
  sessionId?: string
  /** D9 ②: rare encounters already recorded today (soft, read before write). */
  todayRareCount?: number
  /** D2: `'none'` is the only legal value in Stage 1. */
  bait?: Bait
  repo?: string
  files?: readonly string[]
  /** D1 safety cap input: how many detailed records the store already holds. */
  detailedRecordCount?: number
  /** Authoritative draft state from the host, if it just told us. */
  isDraft?: boolean
}

export type PondEffect =
  | { type: 'record'; record: CatchRecord; key: string }
  | { type: 'encounter'; record: RareEncounterRecord; key: string }
  | { type: 'result'; result: PondResult }
  | { type: 'timer'; on: boolean }
  | { type: 'debug'; msg: string }

export type StepResult = {
  state: PondState
  effects: PondEffect[]
}

export function createPondState(seed = 1): PondState {
  return {
    phase: 'idle',
    clock: createClock(null),
    castAtSim: null,
    nextBiteAtSim: null,
    fish: null,
    windowRemainingMs: null,
    carry: null,
    activeFreezes: [],
    isDraft: false,
    contextActive: false,
    pendingCast: false,
    lastEventType: 'unknown',
    lastResult: null,
    seq: 0,
    rngState: seed,
  }
}

// --------------------------------------------------------------- selectors

export function isFrozen(state: PondState): boolean {
  return state.activeFreezes.length > 0
}

/**
 * D-HOTKEY: the reel button exists only while the state is `hooked(tier >= rare)`
 * or `carried`, and nothing is frozen.
 *
 * `isDraft` is accepted for call-site symmetry but deliberately does NOT affect
 * the answer: D-HOTKEY renders the button (with a different hint) while a draft
 * is up, and a chord binding can still fire it. Use `reelActionable` for the
 * D13 question "would a reel work right now", which is what gates the timers.
 */
export function reelAvailable(state: PondState, _isDraft: boolean = state.isDraft): boolean {
  if (isFrozen(state)) return false
  if (state.phase === 'carried') return true
  if (state.phase === 'hooked') return state.fish != null && isRareTier(state.fish.tier)
  return false
}

/** D13: the rare window and the carried grace only run while this is true. */
export function reelActionable(state: PondState, isDraft: boolean = state.isDraft): boolean {
  return reelAvailable(state, isDraft) && !isDraft
}

/**
 * The timer runs only where time has something to do: waiting, hooked, or a
 * carried fish whose grace is counting. Never idle, never draft-blocked carried.
 */
export function timerOn(state: PondState): boolean {
  if (state.phase === 'waiting' || state.phase === 'hooked') return true
  return state.phase === 'carried' && state.carry?.grace === 'running'
}

/**
 * Absolute deadline for the running countdown, or null when there is none or it
 * is paused (frozen, draft-blocked, or a draft pausing a hooked rare).
 *
 * The state stores a *remaining* duration rather than an absolute deadline so
 * that pausing cannot drift; this selector reconstitutes the deadline for
 * rendering.
 */
export function deadlineAt(state: PondState, now: number): number | null {
  if (isFrozen(state)) return null
  if (state.phase === 'hooked') {
    if (state.isDraft || state.windowRemainingMs == null) return null
    return now + state.windowRemainingMs
  }
  if (state.phase === 'carried' && state.carry?.grace === 'running' && !state.isDraft) {
    return now + state.carry.remainingMs
  }
  return null
}

/** After a hot reload: keep the simulated clock from crediting the gap. */
export function resume(state: PondState, now: number): PondState {
  return { ...state, clock: resync(state.clock, now) }
}

// ----------------------------------------------------------------- reducer

export function step(state: PondState, event: PondEvent, ctx: PondCtx): StepResult {
  const params = ctx.params ?? DEFAULT_PARAMS
  const effects: PondEffect[] = []
  const before = state

  let s = ctx.isDraft === undefined ? state : setDraft(state, ctx.isDraft, params, effects)

  switch (event.type) {
    case 'cast':
      s = onCast(s, ctx, params, effects)
      break
    case 'tick':
      s = onTick(s, event.now ?? ctx.now, ctx, params, effects)
      break
    case 'reel':
      s = onReel(s, ctx, params, effects)
      break
    case 'freeze':
      s = onFreeze(s, event.id, ctx, effects)
      break
    case 'unfreeze':
      s = onUnfreeze(s, event.id, ctx, effects)
      break
    case 'draftChanged':
      s = setDraft(s, event.isDraft === true, params, effects)
      break
    case 'activity':
      s = onActivity(s, event.kind)
      break
    case 'complete':
      s = onComplete(s, ctx, params, effects)
      break
    case 'abort':
      s = onAbort(s, ctx, params, effects)
      break
    case 'reset':
      s = onReset(s, ctx, params, effects)
      break
    default:
      effects.push({ type: 'debug', msg: `ignored unknown event ${JSON.stringify(event)}` })
      break
  }

  if (timerOn(before) !== timerOn(s)) effects.push({ type: 'timer', on: timerOn(s) })
  return { state: s, effects }
}

// ------------------------------------------------------------- transitions

function onCast(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  // D11 fallback: turn.start clears whatever freeze records survived.
  let next = clearFreezes(s, ctx, effects, 'cast (turn.start fallback)')
  next = { ...next, contextActive: false, lastEventType: 'turn-start' }

  if (next.phase === 'carried') {
    // D13: at most one unresolved rare encounter — no new cast until it resolves.
    effects.push({ type: 'debug', msg: 'cast held: a carried rare encounter is still unresolved' })
    return { ...next, pendingCast: true }
  }
  if (next.phase === 'hooked' || next.phase === 'waiting') {
    effects.push({ type: 'debug', msg: `cast ignored: already ${next.phase}` })
    return next
  }
  return startCast(next, ctx, params, effects)
}

function startCast(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  const clock = resync(s.clock, ctx.now)
  const rng = createRng(s.rngState)
  const delay = rng.nextFloat(params.biteDelayMinMs, params.biteDelayMaxMs)
  effects.push({ type: 'debug', msg: `cast; first bite roll in ${Math.round(delay)}ms of sim time` })
  return {
    ...s,
    phase: 'waiting',
    clock,
    castAtSim: clock.simMs,
    nextBiteAtSim: clock.simMs + delay,
    fish: null,
    windowRemainingMs: null,
    carry: null,
    pendingCast: false,
    rngState: rng.state(),
  }
}

function onTick(
  s: PondState,
  now: number,
  ctx: PondCtx,
  params: PondParams,
  effects: PondEffect[],
): PondState {
  const frozen = isFrozen(s)
  const stepped = advance(s.clock, now, frozen)
  let next: PondState = { ...s, clock: stepped.clock }
  if (frozen || stepped.dt === 0) return next

  switch (next.phase) {
    case 'waiting':
      next = tickWaiting(next, ctx, params, effects)
      break
    case 'hooked':
      next = tickHooked(next, stepped.dt, ctx, params, effects)
      break
    case 'carried':
      next = tickCarried(next, stepped.dt, ctx, params, effects)
      break
    default:
      break
  }
  return next
}

function tickWaiting(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  if (s.nextBiteAtSim == null || s.clock.simMs < s.nextBiteAtSim) return s

  const waitMs = s.clock.simMs - (s.castAtSim ?? 0)
  const rng = createRng(s.rngState)
  const rolled = roll(rng, {
    species: ctx.species ?? [],
    params,
    waitMs,
    hourOfDay: ctx.hourOfDay ?? utcHourOf(ctx.now),
    bait: ctx.bait ?? 'none',
    codingContextActive: s.contextActive,
    todayRareCount: ctx.todayRareCount ?? 0,
  })
  let next: PondState = { ...s, rngState: rng.state() }

  if (!rolled) {
    effects.push({ type: 'debug', msg: `nothing bit at ${waitMs}ms; still waiting` })
    return { ...next, nextBiteAtSim: next.clock.simMs + params.biteRetryMs }
  }

  const fish: HookedFish = {
    speciesId: rolled.species.id,
    tier: rolled.tier,
    sizeCm: rolled.sizeCm,
    depthZone: rolled.depthZone,
    bitAtSim: next.clock.simMs,
  }
  next = { ...next, fish, nextBiteAtSim: null }

  if (!isRareTier(fish.tier)) {
    // D-REEL: common and uncommon reel themselves in. No interruption, ever.
    effects.push({ type: 'debug', msg: `${fish.tier} bite: auto-reeled` })
    return settle(next, ctx, params, effects, 'caught', 'bite')
  }

  // D9: one append-only encounter key per rare+ encounter, for the soft budget.
  next = appendEncounter(next, ctx, effects, fish)
  effects.push({ type: 'debug', msg: `${fish.tier} bite: ${params.rareWindowMs}ms to reel` })
  return { ...next, phase: 'hooked', windowRemainingMs: params.rareWindowMs }
}

function tickHooked(
  s: PondState,
  dt: number,
  ctx: PondCtx,
  params: PondParams,
  effects: PondEffect[],
): PondState {
  if (!s.fish || !isRareTier(s.fish.tier)) return s
  // D13: the countdown only runs while the reel would actually work.
  if (!reelActionable(s)) return s

  const remaining = (s.windowRemainingMs ?? 0) - dt
  if (remaining > 0) return { ...s, windowRemainingMs: remaining }

  effects.push({ type: 'debug', msg: 'rare window expired' })
  return settle({ ...s, windowRemainingMs: 0 }, ctx, params, effects, 'sighted', 'timeout')
}

function tickCarried(
  s: PondState,
  dt: number,
  ctx: PondCtx,
  params: PondParams,
  effects: PondEffect[],
): PondState {
  // D13: draft-blocked carried has no timer and never times out.
  if (!s.carry || s.carry.grace !== 'running') return s
  if (!reelActionable(s)) return s

  const remaining = s.carry.remainingMs - dt
  if (remaining > 0) return { ...s, carry: { grace: 'running', remainingMs: remaining } }

  effects.push({ type: 'debug', msg: 'carried grace expired' })
  return settle(s, ctx, params, effects, 'sighted', 'timeout')
}

function onReel(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  if (!reelAvailable(s)) {
    effects.push({
      type: 'debug',
      msg: `reel ignored in ${s.phase}${isFrozen(s) ? ' (frozen)' : ''}`,
    })
    return s
  }
  return settle(s, ctx, params, effects, 'caught', 'reel')
}

function onFreeze(s: PondState, id: string, ctx: PondCtx, effects: PondEffect[]): PondState {
  const key = String(id)
  if (s.activeFreezes.includes(key)) {
    effects.push({ type: 'debug', msg: `freeze ${key} already held` })
    return s
  }
  const activeFreezes = [...s.activeFreezes, key].sort()
  effects.push({ type: 'debug', msg: `freeze +${key} (${activeFreezes.length} active)` })
  return { ...s, activeFreezes, clock: resync(s.clock, ctx.now) }
}

function onUnfreeze(s: PondState, id: string, ctx: PondCtx, effects: PondEffect[]): PondState {
  const key = String(id)
  if (!s.activeFreezes.includes(key)) {
    effects.push({ type: 'debug', msg: `unfreeze ${key} ignored: not held` })
    return s
  }
  const activeFreezes = s.activeFreezes.filter((entry) => entry !== key)
  effects.push({ type: 'debug', msg: `freeze -${key} (${activeFreezes.length} active)` })
  return { ...s, activeFreezes, clock: resync(s.clock, ctx.now) }
}

function onActivity(s: PondState, kind: ActivityKind): PondState {
  const eventType: ControlledEventType =
    kind === 'tests-green' ? 'tests-green' : kind === 'edit' ? 'edit' : 'tool-call'
  return { ...s, contextActive: true, lastEventType: eventType }
}

function onComplete(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  let next = clearFreezes(s, ctx, effects, 'complete')
  next = { ...next, contextActive: false, lastEventType: 'turn-complete' }

  if (next.phase === 'hooked' && next.fish && isRareTier(next.fish.tier)) {
    // D13: carry it into the gap between turns.
    const blocked = next.isDraft
    effects.push({
      type: 'debug',
      msg: blocked
        ? 'carried: draft-blocked, no countdown'
        : `carried: grace ${params.carryGraceMs}ms`,
    })
    return {
      ...next,
      phase: 'carried',
      windowRemainingMs: null,
      nextBiteAtSim: null,
      carry: blocked
        ? { grace: 'blocked', remainingMs: 0 }
        : { grace: 'running', remainingMs: params.carryGraceMs },
      clock: resync(next.clock, ctx.now),
    }
  }

  if (next.phase === 'carried') return next

  if (next.phase === 'hooked' && next.fish) {
    // Non-rare should have auto-reeled; if it somehow lingers it just leaves.
    return settle(next, ctx, params, effects, 'escaped', 'complete')
  }

  return toIdle(next, ctx, params, effects)
}

function onAbort(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  // D-ABORT: no rewards, no bait, nothing. Just clean up.
  let next = clearFreezes(s, ctx, effects, 'abort')
  next = { ...next, contextActive: false, pendingCast: false }
  effects.push({ type: 'debug', msg: 'abort: no rewards' })

  if (next.fish && (next.phase === 'hooked' || next.phase === 'carried')) {
    const rare = isRareTier(next.fish.tier)
    return settle(next, ctx, params, effects, rare ? 'sighted' : 'escaped', 'abort')
  }
  return toIdle(next, ctx, params, effects)
}

function onReset(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  let next = clearFreezes(s, ctx, effects, 'reset')
  next = { ...next, contextActive: false, pendingCast: false }
  effects.push({ type: 'debug', msg: 'reset: back to idle' })

  if (next.fish && (next.phase === 'hooked' || next.phase === 'carried')) {
    const rare = isRareTier(next.fish.tier)
    return settle(next, ctx, params, effects, rare ? 'sighted' : 'escaped', 'reset')
  }
  return toIdle(next, ctx, params, effects)
}

// ---------------------------------------------------------------- settling

function settle(
  s: PondState,
  ctx: PondCtx,
  params: PondParams,
  effects: PondEffect[],
  outcome: ResultKind,
  from: PondResult['from'],
): PondState {
  const fish = s.fish
  if (!fish) return toIdle(s, ctx, params, effects)

  let next = s
  if (outcome !== 'escaped') {
    const record = makeRecord(
      {
        species: fish.speciesId,
        size_cm: fish.sizeCm,
        rarity: fish.tier,
        outcome,
        timestamp: ctx.now,
        event_type: next.lastEventType,
        repo: ctx.repo,
        files: ctx.files,
      },
      params,
    )
    next = appendRecord(next, ctx, params, effects, record)
  } else {
    effects.push({ type: 'debug', msg: `${fish.tier} got away with no record (${from})` })
  }

  const result: PondResult = {
    kind: outcome,
    speciesId: fish.speciesId,
    tier: fish.tier,
    sizeCm: fish.sizeCm,
    at: ctx.now,
    from,
  }
  effects.push({ type: 'result', result })
  return toIdle({ ...next, lastResult: result }, ctx, params, effects)
}

function toIdle(s: PondState, ctx: PondCtx, params: PondParams, effects: PondEffect[]): PondState {
  const idle: PondState = {
    ...s,
    phase: 'idle',
    castAtSim: null,
    nextBiteAtSim: null,
    fish: null,
    windowRemainingMs: null,
    carry: null,
  }
  if (!idle.pendingCast) return idle

  // D13: the turn's cast was held back by an unresolved carried fish. Now it goes.
  effects.push({ type: 'debug', msg: 'held cast released now that the rare encounter resolved' })
  return startCast({ ...idle, pendingCast: false }, ctx, params, effects)
}

function appendRecord(
  s: PondState,
  ctx: PondCtx,
  params: PondParams,
  effects: PondEffect[],
  record: CatchRecord,
): PondState {
  // D1: sightings and rare+ catches are never dropped; plain catches stop at the
  // conservative safety cap.
  const shielded = record.outcome === 'sighted' || isRareTier(record.rarity)
  const held = ctx.detailedRecordCount
  if (!shielded && held != null && held >= params.detailedRecordCap) {
    effects.push({
      type: 'debug',
      msg: `record cap ${params.detailedRecordCap} reached; dropped a ${record.rarity} catch`,
    })
    return s
  }

  const sessionId = ctx.sessionId ?? 'session'
  const key = record.outcome === 'caught' ? catchKey(sessionId, s.seq) : sightingKey(sessionId, s.seq)
  effects.push({ type: 'record', record, key })
  return { ...s, seq: s.seq + 1 }
}

function appendEncounter(
  s: PondState,
  ctx: PondCtx,
  effects: PondEffect[],
  fish: HookedFish,
): PondState {
  const record = makeEncounterRecord({
    species: fish.speciesId,
    rarity: fish.tier,
    timestamp: ctx.now,
  })
  const key = encounterKey(ctx.date ?? utcDateOf(ctx.now), ctx.sessionId ?? 'session', s.seq)
  effects.push({ type: 'encounter', record, key })
  return { ...s, seq: s.seq + 1 }
}

function clearFreezes(s: PondState, ctx: PondCtx, effects: PondEffect[], reason: string): PondState {
  if (s.activeFreezes.length === 0) return s
  effects.push({
    type: 'debug',
    msg: `cleared ${s.activeFreezes.length} stale freeze(s) on ${reason}: ${s.activeFreezes.join(', ')}`,
  })
  return { ...s, activeFreezes: [], clock: resync(s.clock, ctx.now) }
}

function setDraft(
  s: PondState,
  isDraft: boolean,
  params: PondParams,
  effects: PondEffect[],
): PondState {
  if (s.isDraft === isDraft) return s
  const next: PondState = { ...s, isDraft }
  if (next.phase !== 'carried' || !next.carry) return next

  if (isDraft) {
    // D13: typing blocks the grace window outright — it cannot time out.
    effects.push({ type: 'debug', msg: 'carried grace blocked: draft in the prompt' })
    return { ...next, carry: { grace: 'blocked', remainingMs: 0 } }
  }
  // D13: a fixed fresh window once the draft is cleared or sent. Never a remainder.
  effects.push({ type: 'debug', msg: `carried grace started: ${params.postSubmitGraceMs}ms` })
  return { ...next, carry: { grace: 'running', remainingMs: params.postSubmitGraceMs } }
}
