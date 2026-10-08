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
import { createSignalsState, observeCommand, type SignalsState } from '../src/core/signals.ts'
import { isRareTier, utcDateOf } from '../src/core/types.ts'
import { SPECIES } from '../src/data/species.ts'
import { renderBand, RESULT_DIM_AFTER_MS } from '../src/render/band.ts'
import { emitCatchCard, lookupSpecies } from '../src/render/card.ts'
import { recentMemoryLines } from '../src/render/memories.ts'
import { toPlainText, type RenderModel } from '../src/render/model.ts'
import { BOLD_TOKENS, resolveColor, resolveRasterColor } from '../src/render/palette.ts'

// ------------------------------------------------------------------ state

const pondAtom = atom({ plugin: 'reelquiet', key: 'pond' } as const, null as object | null)
const signalsAtom = atom({ plugin: 'reelquiet', key: 'signals' } as const, { red: {} })
const seenAtom = atom({ plugin: 'reelquiet', key: 'seenCards' } as const, [] as string[])
const shownAtAtom = atom({ plugin: 'reelquiet', key: 'resultShownAt' } as const, null as number | null)

const TICK_MS = 100
const RECORD_PREFIXES = ['v1:c:', 'v1:s:']
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const MAX_FILES = 3

// Module variables: a working copy, restored from $.state on every load.
let enabled = false
let pond: PondState = createPondState(1)
let signals: SignalsState = createSignalsState()
let seenCards: string[] = []
let resultShownAt: number | null = null
let shownResultAt: number | null = null
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
let lastCells = ''
let ticker: { cancel: () => void } | null = null
const askPending = new Set<string>()

// ---------------------------------------------------------------- helpers

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
    resultShownAt,
  })
}

async function persist($: any) {
  await update($, pondAtom, () => pond)
  await update($, signalsAtom, () => signals)
  await update($, seenAtom, () => seenCards)
  await update($, shownAtAtom, () => resultShownAt)
}

// Redraw: text changes rebuild the tree; raster-only changes use blit (V6).
async function redraw($: any, now: number) {
  const m = model(now)
  const text = m ? toPlainText(m) : ''
  const cells = m && m.raster ? encodeCells(m) : ''
  const textOnly = m ? toPlainText({ ...m, raster: null }) : ''
  const lastTextOnly = lastText
  if (textOnly !== lastTextOnly || !bandRequestId || !m || !m.raster) {
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
  void text
}

function resultVisible(now: number): boolean {
  return pond.lastResult !== null && resultShownAt !== null && now - resultShownAt <= RESULT_DIM_AFTER_MS + 1000
}

function ensureTicker($: any, now: number) {
  const wanted = timerOn(pond) || resultVisible(now)
  if (wanted && !ticker) {
    ticker = $.clock.every(TICK_MS, () => onTick($))
  } else if (!wanted && ticker) {
    ticker.cancel()
    ticker = null
  }
}

async function onTick($: any) {
  try {
    const now = await $.clock.now()
    if (timerOn(pond)) await advance($, { type: 'tick', now }, now)
    else ensureTicker($, now)
    await redraw($, now)
  } catch (err) {
    $.ui.log('tick failed: ' + String(err), { to: 'debug' })
  }
}

// One core step, then its effects. All game state changes go through here.
async function advance($: any, event: PondEvent, now: number) {
  const date = utcDateOf(now)
  if (date !== todayDate) {
    todayDate = date
    todayRareCount = await countToday($, date)
  }
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
  ensureTicker($, now)
  await persist($)
}

async function applyEffects($: any, effects: PondEffect[], now: number) {
  for (const fx of effects) {
    if (fx.type === 'record') {
      await storeSet($, fx.key, fx.record)
      if (fx.key.startsWith('v1:c:')) detailedCount += 1
      emitCard($, fx.key, fx.record)
    } else if (fx.type === 'encounter') {
      await storeSet($, fx.key, fx.record)
      todayRareCount += 1
    } else if (fx.type === 'result') {
      if (shownResultAt !== fx.result.at) {
        shownResultAt = fx.result.at
        resultShownAt = fx.result.kind === 'escaped' ? null : now
      }
    } else if (fx.type === 'debug') {
      $.ui.log(fx.msg, { to: 'debug' })
    }
  }
}

// V-CARD / V-RESULT: rare+ only, one ordered group per event id, public fields only.
function emitCard($: any, key: string, record: CatchRecord) {
  if (!isRareTier(record.rarity)) return
  const out = emitCatchCard(seenCards, key, record, lookupSpecies(SPECIES, record.species))
  seenCards = out.seen.slice(-200)
  for (const line of out.lines) $.ui.log(line)
}

async function storeSet($: any, key: string, value: unknown) {
  if (storeFailed) return
  try {
    await $.store.set(key, value)
  } catch {
    storeFailed = true
    $.ui.toast('ReelQuiet: storage is full or unavailable; this session keeps catches in memory only.')
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
  const out: CatchRecord[] = []
  for (const key of keys) {
    if (!RECORD_PREFIXES.some(p => key.startsWith(p))) continue
    const value = await $.store.get(key)
    if (value && typeof value === 'object') out.push(value as CatchRecord)
  }
  return out
}

// --------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const extra = (options as Record<string, unknown> | undefined)?.testCommands
  extraTestPatterns = typeof extra === 'string' && extra.trim() ? [extra.trim()] : []

  on('session.start', async ($, e, next) => {
    try {
      const surfaces = await $.session.surfaces()
      enabled = surfaces.length > 0 && surfaces.every(s => s === 'terminal')
      if (enabled) {
        const now = await $.clock.now()
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
        pond = saved ? resume(saved as PondState, now) : createPondState(sessionSeed)
        signals = await read($, signalsAtom)
        seenCards = await read($, seenAtom)
        resultShownAt = await read($, shownAtAtom)
        shownResultAt = pond.lastResult ? pond.lastResult.at : null
        try {
          const keys: string[] = await $.store.keys()
          detailedCount = keys.filter(k => k.startsWith('v1:c:')).length
        } catch {
          detailedCount = 0
        }
        await $.command.register({
          name: 'reelquiet',
          description: 'ReelQuiet: show Recent memories',
          argumentHint: 'log',
          immediate: true,
        })
        ensureTicker($, now)
      }
    } catch (err) {
      enabled = false
      $.ui.log('session.start failed, ReelQuiet disabled: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    try {
      if (enabled) {
        const now = await $.clock.now()
        askPending.clear()
        await advance($, { type: 'reset' }, now)
        signals = createSignalsState()
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('reset failed: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    try {
      if (enabled) {
        const now = await $.clock.now()
        askPending.clear()
        recentFiles = []
        await advance($, { type: 'cast' }, now)
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('cast failed: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    try {
      if (enabled) await advance($, { type: 'activity', kind: 'model-request' }, await $.clock.now())
    } catch (err) {
      $.ui.log('activity failed: ' + String(err), { to: 'debug' })
    }
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    try {
      if (enabled && !e.agentId) {
        const now = await $.clock.now()
        askPending.clear()
        await advance($, { type: e.isAborted ? 'abort' : 'complete' }, now)
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('complete failed: ' + String(err), { to: 'debug' })
    }
    return r
  }).catch(($, e, next) => next(e))

  // D11: a permission ask freezes this call until its next(e) settles (conservative scope).
  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    try {
      if (enabled && r.decision === 'ask' && e.tool_use_id) {
        askPending.add(e.tool_use_id)
        const now = await $.clock.now()
        await advance($, { type: 'freeze', id: e.tool_use_id }, now)
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('freeze failed: ' + String(err), { to: 'debug' })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    const agentId = (e as { agentId?: string }).agentId
    const isQuestion = e.tool === 'AskUserQuestion'
    try {
      if (enabled) {
        const now = await $.clock.now()
        if (EDIT_TOOLS.has(e.tool)) {
          const name = basenameOf((e as { file_path?: unknown }).file_path)
          if (name) recentFiles = [name, ...recentFiles.filter(f => f !== name)].slice(0, MAX_FILES)
        }
        await advance($, { type: 'activity', kind: EDIT_TOOLS.has(e.tool) ? 'edit' : 'tool-call' }, now)
        if (isQuestion) {
          askPending.add(id)
          await advance($, { type: 'freeze', id }, now)
          await redraw($, now)
        }
      }
    } catch (err) {
      $.ui.log('tool.call pre failed: ' + String(err), { to: 'debug' })
    }

    let r
    try {
      r = await next(e)
    } finally {
      try {
        if (enabled && askPending.has(id)) {
          askPending.delete(id)
          const now = await $.clock.now()
          await advance($, { type: 'unfreeze', id }, now)
          await redraw($, now)
        }
      } catch (err) {
        $.ui.log('unfreeze failed: ' + String(err), { to: 'debug' })
      }
    }

    try {
      if (enabled && e.tool === 'Bash') {
        const command = (e as { command?: unknown }).command
        if (typeof command === 'string') {
          const isError = Boolean((r as { isError?: boolean } | undefined)?.isError)
          const out = observeCommand(signals, { sessionId, command, isError, agentId }, extraTestPatterns)
          signals = out.state
          if (out.signals.length > 0) {
            await advance($, { type: 'activity', kind: 'tests-green' }, await $.clock.now())
          }
        }
      }
    } catch (err) {
      $.ui.log('tool.call post failed: ' + String(err), { to: 'debug' })
    }
    return r
  }).catch(($, e, next) => next(e))

  on('classic.Elicitation', async ($, e, next) => {
    try {
      if (enabled) {
        const id = 'elicitation:' + String((e as { elicitation_id?: string }).elicitation_id ?? 'mcp')
        const now = await $.clock.now()
        await advance($, { type: 'freeze', id }, now)
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('elicitation freeze failed: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.ElicitationResult', async ($, e, next) => {
    try {
      if (enabled) {
        const id = 'elicitation:' + String((e as { elicitation_id?: string }).elicitation_id ?? 'mcp')
        const now = await $.clock.now()
        await advance($, { type: 'unfreeze', id }, now)
        await redraw($, now)
      }
    } catch (err) {
      $.ui.log('elicitation unfreeze failed: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // V1: draft state, read-only; the hint line is passed through unchanged.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    try {
      if (enabled && e.props.isDraft !== pond.isDraft) {
        const isDraft = e.props.isDraft
        $.clock.after(0, () => {
          $.clock.now().then(now => advance($, { type: 'draftChanged', isDraft }, now).then(() => redraw($, now)))
        })
      }
    } catch (err) {
      $.ui.log('draft observe failed: ' + String(err), { to: 'debug' })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!enabled || e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const now = await $.clock.now()
    bodyColumns = e.props.bodyColumns
    bandRequestId = e.requestId
    const m = model(now)
    if (!m) return next(e)

    if (m.meta.reelBlockedByLayout !== pond.layoutBlocked) {
      const blocked = m.meta.reelBlockedByLayout
      $.clock.after(0, () => {
        $.clock.now().then(t => advance($, { type: 'layoutChanged', blocked }, t).then(() => redraw($, t)))
      })
    }
    lastText = toPlainText({ ...m, raster: null })
    lastCells = m.raster ? encodeCells(m) : ''

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
            onPress={() =>
              $.clock.now().then(t => advance($, { type: 'reel' }, t).then(() => redraw($, t)))
            }
          />
        ) : null}
      </Box>
    ))

    return (
      <Box flexDirection="row" columnGap={m.raster ? 2 : 0}>
        {m.raster ? (
          <Raster key="pond" columns={m.raster.columns} rows={m.raster.rows} cells={encodeCells(m)} />
        ) : null}
        <Box flexDirection="column">{rows}</Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // D14: Recent memories, a read-only product probe. Returns {} so nothing reaches Claude.
  on('command.run', { command: 'reelquiet' }, async ($, e) => {
    try {
      if ((e.args ?? '').trim() !== 'log') {
        $.ui.log('Usage: /reelquiet log')
        return {}
      }
      const records = await loadRecords($)
      const lines = recentMemoryLines(records, { total: records.length, columns: bodyColumns })
      for (const line of lines) $.ui.log(line)
    } catch (err) {
      $.ui.log('Recent memories are unavailable right now.')
      $.ui.log('log failed: ' + String(err), { to: 'debug' })
    }
    return {}
  })
}
