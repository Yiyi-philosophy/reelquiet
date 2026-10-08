// ReelQuiet hooks module: the single capability boundary (D4).
// Every $ call, store write, timer and hook registration lives in this file.
// src/** stays pure; this file only translates events and materializes models.
//
// Every hook is observe-only and fail-open (A2/O1): game logic runs inside
// try/catch, the agent's result is returned exactly as next(e) produced it,
// and each hook's .catch replays next(e).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  createPondState,
  isFrozen,
  reelAvailable,
  resume,
  step,
  timerOn,
  type PondEffect,
  type PondEvent,
  type PondState,
} from '../src/core/pond.ts'
import { encounterDatePrefix, type CatchRecord } from '../src/core/records.ts'
import {
  castAllowed,
  compilePatterns,
  createSignalsState,
  observeCommand,
  type SignalsState,
} from '../src/core/signals.ts'
import { isRareTier, utcDateOf, type Tier } from '../src/core/types.ts'
import { SPECIES } from '../src/data/species.ts'
import { renderBand, RESULT_DIM_AFTER_MS, RESULT_MIN_HOLD_MS, RESULT_MIN_HOLD_RARE_MS } from '../src/render/band.ts'
import { emitCatchCard, lookupSpecies } from '../src/render/card.ts'
import { recentMemoryLines } from '../src/render/memories.ts'
import { toPlainText, type RenderModel } from '../src/render/model.ts'
import { BOLD_TOKENS, resolveColor, resolveRasterColor } from '../src/render/palette.ts'

// ------------------------------------------------------------------ state

const pondAtom = atom({ plugin: 'reelquiet', key: 'pond' } as const, null as object | null)
const signalsAtom = atom({ plugin: 'reelquiet', key: 'signals' } as const, { red: {} })
const seenAtom = atom({ plugin: 'reelquiet', key: 'seenCards' } as const, [] as string[])
const shownAtAtom = atom({ plugin: 'reelquiet', key: 'resultShownAt' } as const, null as number | null)
const retireAtom = atom({ plugin: 'reelquiet', key: 'clearResultAfterHold' } as const, false)

// The worker period: also the pond's tick (design: 10 Hz).
const TICK_MS = 100
const RECORD_PREFIXES = ['v1:c:', 'v1:s:']
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_FILES = 3
// Measured in G3: transcript log rows wrap near 80 columns, and each row carries a
// `● reelquiet: ` prefix. Recent memories lay out to this width so the V-MEM narrow
// rule (drop basename, repo, event, size) runs before the host wraps a line.
const LOG_MAX_COLUMNS = 80
const LOG_PREFIX_COLUMNS = 15

// Module variables: a working copy, restored from $.state on every load.
let enabled = false
let pond: PondState = createPondState(1)
let signals: SignalsState = createSignalsState()
let seenCards: string[] = []
let resultShownAt: number | null = null
let shownResultAt: number | null = null
// V-RESULT: a result stays up until the next cast, but never less than its minimum hold.
let clearResultAfterHold = false
let heldTier: Tier | null = null
let sessionId = 'session'
let sessionSeed = 1
let repoName = ''
let noColor = true
let extraTestPatterns: string[] = []
let recentFiles: string[] = []
let todayRareCount = 0
let todayDate = ''
let detailedCount = 0
let storeFailed = false
let bodyColumns = 75
let bandRequestId = ''
let lastText = ''
// Latest host observations; detached work applies these, never a stale capture.
let observedDraft = false
let observedBlocked = false
let lastCells = ''
// A batch that changed state persists at once; quiet ticks at most once a second.
let lastPersistAt = 0
const PERSIST_MS = 1000
const askPending = new Set<string>()

// ---------------------------------------------------------------- helpers

// The viewer's UTC offset in minutes (east positive). Display only: records stay UTC.
function localOffsetMinutes(now: number): number {
  try {
    return -new Date(now).getTimezoneOffset()
  } catch {
    return 0
  }
}

// Restored $.state is untrusted: an older build or a bad write must degrade, not disable the mod.
function isPondState(v: unknown): v is PondState {
  const s = v as PondState | null
  return (
    !!s &&
    typeof s === 'object' &&
    typeof s.phase === 'string' &&
    ['idle', 'waiting', 'hooked', 'carried'].includes(s.phase) &&
    !!s.clock &&
    typeof s.clock.simMs === 'number' &&
    Array.isArray(s.activeFreezes) &&
    typeof s.seq === 'number' &&
    typeof s.rngState === 'number'
  )
}

function elicitationId(e: unknown): string {
  const ev = e as { elicitation_id?: string; mcp_server_name?: string }
  return 'elicitation:' + (ev.elicitation_id ?? 'server:' + String(ev.mcp_server_name ?? 'mcp'))
}

function hashString(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

function hex(color: number | null): string | undefined {
  return color === null ? undefined : '#' + color.toString(16).padStart(6, '0')
}

function encodeCells(model: RenderModel): string {
  const nums: number[] = []
  for (const cell of model.raster?.cells ?? []) {
    nums.push(
      cell.ch.codePointAt(0) ?? 32,
      resolveRasterColor(cell.fg, noColor),
      resolveRasterColor(cell.bg, noColor),
    )
  }
  const bytes = new Uint8Array(Uint32Array.from(nums).buffer)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function basenameOf(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return null
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || null
}

function model(now: number): RenderModel | null {
  return renderBand({
    state: pond,
    now,
    bodyColumns,
    sessionSeed,
    noColor,
    lastResult: resultShownAt === null ? null : pond.lastResult,
    resultShownAt,
  })
}

function holdMs(): number {
  const tier = heldTier
  return tier && isRareTier(tier) ? RESULT_MIN_HOLD_RARE_MS : RESULT_MIN_HOLD_MS
}

// Retire a shown result once a later cast exists and its minimum hold has passed.
function retireResult(now: number) {
  if (clearResultAfterHold && resultShownAt !== null && now - resultShownAt >= holdMs()) {
    resultShownAt = null
    clearResultAfterHold = false
  }
}

async function persist($: any) {
  try {
    await update($, pondAtom, () => pond)
    await update($, signalsAtom, () => signals)
    await update($, seenAtom, () => seenCards)
    await update($, shownAtAtom, () => resultShownAt)
    await update($, retireAtom, () => clearResultAfterHold)
  } catch (err) {
    // A refused write (for example during a draw) keeps the module copy; the next batch persists again.
    $.ui.log('persist deferred: ' + String(err), { to: 'debug' })
  }
}

// Redraw: text changes rebuild the tree; raster-only changes use blit (V6).
async function redraw($: any, now: number) {
  retireResult(now)
  const m = model(now)
  const cells = m && m.raster ? encodeCells(m) : ''
  const textOnly = m ? toPlainText({ ...m, raster: null }) + (m.meta.resultDimmed ? '\u0000dim' : '') : ''
  if (textOnly !== lastText || !bandRequestId || !m || !m.raster) {
    lastText = textOnly
    lastCells = cells
    $.ui.invalidate('ui.render')
    return
  }
  if (cells !== lastCells) {
    lastCells = cells
    const r = await $.ui.blit({ requestId: bandRequestId, key: 'pond', cells })
    if (r.deny) $.ui.invalidate('ui.render')
  }
}

function resultVisible(now: number): boolean {
  if (pond.lastResult === null || resultShownAt === null) return false
  return clearResultAfterHold || now - resultShownAt <= RESULT_DIM_AFTER_MS + 1000
}

// ------------------------------------------------------------ the queue
//
// Hooks never await game work. They push plain jobs here and go straight on to
// next(e); one worker, started in session.start, drains the queue in order on
// $.clock.every (the documented home for work that outlives a dispatch). A slow
// or failing $.state / $.store therefore delays the pond, never the agent.

type Job =
  | { kind: 'init' }
  | { kind: 'event'; event: PondEvent }
  | { kind: 'cast'; turnId: string }
  | { kind: 'complete'; turnId: string; aborted: boolean }
  | { kind: 'sync' }

const queue: Job[] = []
let working = false
let initialized = false
let castTurnId: string | null = null
let lastNow = 0

// Inputs that only refresh state (activity, draft/layout sync) coalesce; every
// event that can settle a fish (cast, complete, freeze, unfreeze, reel, reset)
// is always kept, in order.
function enqueue(job: Job) {
  if (!enabled) return
  const last = queue[queue.length - 1]
  if (job.kind === 'sync' && queue.some(j => j.kind === 'sync')) return
  if (
    job.kind === 'event' &&
    job.event.type === 'activity' &&
    last?.kind === 'event' &&
    last.event.type === 'activity' &&
    last.event.kind === job.event.kind
  ) {
    return
  }
  queue.push(job)
}

async function init($: any, now: number) {
  sessionId = await $.session.id()
  sessionSeed = hashString(sessionId)
  const repo = await $.session.repo()
  repoName = repo ? basenameOf(repo.root) ?? '' : ''
  try {
    const value = await $.env.get('NO_COLOR')
    noColor = typeof value === 'string' && value.length > 0
  } catch {
    noColor = true
  }
  const saved = await read($, pondAtom)
  pond = isPondState(saved) ? resume(saved, now) : createPondState(sessionSeed)
  const savedSignals = await read($, signalsAtom)
  signals =
    savedSignals && typeof savedSignals.red === 'object' && savedSignals.red !== null
      ? savedSignals
      : createSignalsState()
  const savedSeen = await read($, seenAtom)
  seenCards = Array.isArray(savedSeen) ? savedSeen.filter(x => typeof x === 'string') : []
  const savedShown = await read($, shownAtAtom)
  resultShownAt = typeof savedShown === 'number' ? savedShown : null
  heldTier = resultShownAt !== null && pond.lastResult ? pond.lastResult.tier : null
  clearResultAfterHold = (await read($, retireAtom)) === true
  shownResultAt = pond.lastResult ? pond.lastResult.at : null
  try {
    const keys: string[] = await $.store.keys()
    detailedCount = keys.filter(k => k.startsWith('v1:c:')).length
  } catch {
    detailedCount = 0
  }
  initialized = true
}

// Runs one job; returns true when it changed game state.
async function runJob($: any, job: Job, now: number): Promise<boolean> {
  if (job.kind === 'init') {
    await init($, now)
    return true
  }
  if (!initialized) return false
  if (job.kind === 'cast') {
    castTurnId = job.turnId
    await advance($, { type: 'cast' }, now)
    return true
  }
  if (job.kind === 'complete') {
    // A completion for a turn this pond never cast (stale, or a turn that
    // started while ReelQuiet was off) must not settle the current one.
    if (castTurnId !== null && job.turnId !== castTurnId) {
      $.ui.log('complete ignored: turn ' + job.turnId + ' is not the cast turn', { to: 'debug' })
      return false
    }
    castTurnId = null
    await advance($, { type: job.aborted ? 'abort' : 'complete' }, now)
    return true
  }
  if (job.kind === 'sync') {
    let changed = false
    if (observedDraft !== pond.isDraft) {
      await advance($, { type: 'draftChanged', isDraft: observedDraft }, now)
      changed = true
    }
    if (observedBlocked !== pond.layoutBlocked) {
      await advance($, { type: 'layoutChanged', blocked: observedBlocked }, now)
      changed = true
    }
    return changed
  }
  await advance($, job.event, now)
  return true
}

// The single worker. Queued inputs always apply before the tick, so a reel or a
// freeze that waited behind slow storage is never out-raced by elapsed time.
async function work($: any) {
  if (working) return
  working = true
  try {
    const now = await $.clock.now()
    lastNow = now
    let changed = false
    while (queue.length > 0) {
      const job = queue.shift() as Job
      try {
        if (await runJob($, job, now)) changed = true
      } catch (err) {
        $.ui.log('job ' + job.kind + ' failed: ' + String(err), { to: 'debug' })
      }
    }
    if (!initialized) return
    let ticked = false
    if (timerOn(pond) && !isFrozen(pond)) {
      await advance($, { type: 'tick', now }, now)
      ticked = true
    }
    if (changed || ticked || resultVisible(now)) await redraw($, now)
    if (changed || now - lastPersistAt >= PERSIST_MS) {
      lastPersistAt = now
      await persist($)
    }
  } catch (err) {
    $.ui.log('worker failed: ' + String(err), { to: 'debug' })
  } finally {
    working = false
  }
}

// One core step, then its effects. All game state changes go through here.
async function advance($: any, event: PondEvent, now: number) {
  const date = utcDateOf(now)
  if (date !== todayDate) {
    todayDate = date
    todayRareCount = await countToday($, date)
  }
  if (event.type === 'cast' && resultShownAt !== null) clearResultAfterHold = true
  const r = step(pond, event, {
    now,
    species: SPECIES,
    sessionId,
    date,
    todayRareCount,
    bait: 'none',
    repo: repoName,
    files: recentFiles,
    detailedRecordCount: detailedCount,
  })
  pond = r.state
  await applyEffects($, r.effects, now)
}

async function applyEffects($: any, effects: PondEffect[], now: number) {
  for (const fx of effects) {
    if (fx.type === 'record') {
      const saved = await storeSet($, fx.key, fx.record)
      if (saved && fx.key.startsWith('v1:c:')) detailedCount += 1
      if (saved) emitCard($, fx.key, fx.record)
    } else if (fx.type === 'encounter') {
      await storeSet($, fx.key, fx.record)
      todayRareCount += 1
    } else if (fx.type === 'result') {
      if (shownResultAt !== fx.result.at) {
        shownResultAt = fx.result.at
        if (fx.result.kind === 'escaped') {
          resultShownAt = null
          heldTier = null
        } else {
          resultShownAt = now
          heldTier = fx.result.tier
          clearResultAfterHold = false
        }
      }
    } else if (fx.type === 'debug') {
      $.ui.log(fx.msg, { to: 'debug' })
    }
  }
}

// V-CARD / V-RESULT: rare+ only, one ordered group per event id, public fields only.
function emitCard($: any, key: string, record: CatchRecord) {
  if (!isRareTier(record.rarity)) return
  const out = emitCatchCard(seenCards, key, record, lookupSpecies(SPECIES, record.species), localOffsetMinutes(record.timestamp))
  seenCards = out.seen.slice(-200)
  for (const line of out.lines) $.ui.log(line)
}

async function storeSet($: any, key: string, value: unknown): Promise<boolean> {
  if (storeFailed) return false
  try {
    await $.store.set(key, value)
    return true
  } catch {
    storeFailed = true
    $.ui.toast('ReelQuiet: storage is full or unavailable; new catches are not being saved.')
    return false
  }
}

async function countToday($: any, date: string): Promise<number> {
  try {
    const prefix = encounterDatePrefix(date)
    const keys: string[] = await $.store.keys()
    return keys.filter(k => k.startsWith(prefix)).length
  } catch {
    return 0
  }
}

async function loadRecords($: any): Promise<CatchRecord[]> {
  const keys: string[] = await $.store.keys()
  const wanted = keys.filter(key => RECORD_PREFIXES.some(p => key.startsWith(p)))
  const values: unknown[] = await Promise.all(wanted.map(key => $.store.get(key)))
  return values.filter((v): v is CatchRecord => v !== null && typeof v === 'object')
}

// --------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const extra = (options as Record<string, unknown> | undefined)?.testCommands
  extraTestPatterns = typeof extra === 'string' && extra.trim() ? [extra.trim()] : []
  compilePatterns(extraTestPatterns)

  // Host setup only: decide the surface, register the command, start the one
  // worker. Every game read (state, store, env, session) runs in the worker.
  on('session.start', async ($, e, next) => {
    try {
      const surfaces = await $.session.surfaces()
      enabled = surfaces.length > 0 && surfaces.every(s => s === 'terminal')
      if (enabled) {
        queue.length = 0
        initialized = false
        enqueue({ kind: 'init' })
        $.clock.every(TICK_MS, () => work($))
        await $.command.register({
          name: 'reelquiet',
          description: 'ReelQuiet: show Recent memories',
          argumentHint: 'log',
          immediate: true,
        })
      }
    } catch (err) {
      enabled = false
      $.ui.log('session.start failed, ReelQuiet disabled: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, ($, e, next) => {
    if (enabled) {
      askPending.clear()
      signals = createSignalsState()
      castTurnId = null
      enqueue({ kind: 'event', event: { type: 'reset' } })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    if (enabled && castAllowed(e as { agentId?: string | null })) {
      askPending.clear()
      recentFiles = []
      enqueue({ kind: 'cast', turnId: e.turnId })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    enqueue({ kind: 'event', event: { type: 'activity', kind: 'model-request' } })
    return yield* next(e)
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (enabled && !e.agentId) {
      askPending.clear()
      enqueue({ kind: 'complete', turnId: e.turnId, aborted: e.isAborted })
    }
    return r
  }).catch(($, e, next) => next(e))

  // D11: a permission ask freezes this call until its next(e) settles (conservative scope).
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    if (enabled && r.decision === 'ask' && e.tool_use_id) {
      askPending.add(e.tool_use_id)
      enqueue({ kind: 'event', event: { type: 'freeze', id: e.tool_use_id } })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const agentId = (e as { agentId?: string }).agentId
    if (enabled) {
      if (EDIT_TOOLS.has(e.tool)) {
        const name = basenameOf((e as { file_path?: unknown }).file_path)
        if (name) recentFiles = [name, ...recentFiles.filter(f => f !== name)].slice(0, MAX_FILES)
      }
      enqueue({ kind: 'event', event: { type: 'activity', kind: EDIT_TOOLS.has(e.tool) ? 'edit' : 'tool-call' } })
      if (e.tool === 'AskUserQuestion') {
        askPending.add(id)
        enqueue({ kind: 'event', event: { type: 'freeze', id } })
      }
    }

    let r
    try {
      r = await next(e)
    } finally {
      if (askPending.delete(id)) enqueue({ kind: 'event', event: { type: 'unfreeze', id } })
    }

    if (enabled && e.tool === 'Bash') {
      const command = (e as { command?: unknown }).command
      if (typeof command === 'string') {
        try {
          const isError = Boolean((r as { isError?: boolean } | undefined)?.isError)
          const out = observeCommand(signals, { sessionId, command, isError, agentId }, extraTestPatterns)
          signals = out.state
          if (out.signals.length > 0) enqueue({ kind: 'event', event: { type: 'activity', kind: 'tests-green' } })
        } catch {
          // Signals are pure; a failure here only loses one red-to-green bonus.
        }
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.Elicitation', ($, e, next) => {
    enqueue({ kind: 'event', event: { type: 'freeze', id: elicitationId(e) } })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.ElicitationResult', ($, e, next) => {
    enqueue({ kind: 'event', event: { type: 'unfreeze', id: elicitationId(e) } })
    return next(e)
  }).catch(($, e, next) => next(e))

  // V1: draft state, read-only; the hint line is passed through unchanged.
  on('ui.render', { component: 'PromptHint' }, ($, e, next) => {
    observedDraft = e.props.isDraft
    if (observedDraft !== pond.isDraft) enqueue({ kind: 'sync' })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (!enabled || !initialized || e.surface !== 'terminal' || e.props.hasSurvey) {
      bandRequestId = ''
      return next(e)
    }
    bodyColumns = e.props.bodyColumns
    bandRequestId = e.requestId
    const m = model(lastNow)
    if (!m) return next(e)

    observedBlocked = m.meta.reelBlockedByLayout
    if (observedBlocked !== pond.layoutBlocked) enqueue({ kind: 'sync' })
    lastText = toPlainText({ ...m, raster: null }) + (m.meta.resultDimmed ? '\u0000dim' : '')
    const cells = m.raster ? encodeCells(m) : ''
    lastCells = cells

    const { Box, Text, Button, Raster } = $.ui.resolve(e)
    const canReel = m.reelButton !== null && reelAvailable(pond) && !isFrozen(pond)
    const rows = m.rows.map((row, i) => (
      <Box key={'row' + i} flexDirection="row" columnGap={row.segments.length > 0 && row.button ? 2 : 0}>
        {row.segments.map((seg, j) => (
          <Text
            key={'s' + j}
            color={hex(resolveColor(seg.color, noColor))}
            bold={seg.bold || (seg.color !== null && BOLD_TOKENS.includes(seg.color)) || undefined}
            dimColor={seg.dim || m.meta.resultDimmed || undefined}
          >
            {seg.text}
          </Text>
        ))}
        {row.button && canReel && m.reelButton ? (
          <Button
            key="reel"
            label={m.reelButton.label}
            hotkey="1"
            plain
            onPress={() => enqueue({ kind: 'event', event: { type: 'reel' } })}
          />
        ) : null}
      </Box>
    ))

    return (
      <Box flexDirection="row" columnGap={m.raster ? 2 : 0}>
        {m.raster ? (
          <Raster key="pond" columns={m.raster.columns} rows={m.raster.rows} cells={cells} />
        ) : null}
        <Box flexDirection="column">{rows}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // D14: Recent memories, a read-only product probe the user runs. Returns {} so
  // nothing reaches Claude. Not on any agent path, so it reads the store directly.
  on('command.run', { command: 'reelquiet' }, async ($, e) => {
    try {
      if ((e.args ?? '').trim() !== 'log') {
        $.ui.log('Usage: /reelquiet log')
        return {}
      }
      const records = await loadRecords($)
      const now = await $.clock.now()
      const columns = Math.max(24, Math.min(bodyColumns, LOG_MAX_COLUMNS) - LOG_PREFIX_COLUMNS)
      const lines = recentMemoryLines(records, { total: records.length, columns, offsetMinutes: localOffsetMinutes(now) })
      for (const line of lines) $.ui.log(line)
    } catch (err) {
      $.ui.log('Recent memories are unavailable right now.')
      $.ui.log('log failed: ' + String(err), { to: 'debug' })
    }
    return {}
  }).catch(() => ({}))
}
