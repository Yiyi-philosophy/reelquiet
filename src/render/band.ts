// ReelQuiet — the above-prompt band (D-T1).
//
// `renderBand(input) -> RenderModel | null`. Input is plain data; output is
// plain data. No `$`, no timers, no clock read, no unseeded randomness.
//
// The contracts this file implements, each with the ID it comes from:
//
//   V-MONO    state and rarity are carried by words and glyphs; `!` means "bite
//             or needs you". Colour only raises emphasis.
//   V-LABEL   common has no label, uncommon is lowercase, RARE and LEGENDARY
//             shout. See `rarityLabel` in model.ts.
//   V-AMBIENT at most 2 decorative silhouettes while waiting, seeded from the
//             session, one cell every 2-4 s, still while frozen, gone the moment
//             something bites, gone in the narrow tiers. They never reach core.
//   V-RESULT  a result holds for 3 s (common/uncommon) or 6 s (rare+) and cannot
//             be painted over by the next cast; after that it stays until the
//             next cast and dims at 60 s.
//   V-NARROW  three width tiers (>=70 / 40-69 / <40). The reel Button has the
//             highest priority; if it cannot be laid out the countdown pauses
//             (`meta.reelBlockedByLayout`, fed back into core by D-T2) instead
//             of the fish escaping.
//   V-COLOR   palette tokens only, no blink/glow/pulse, NO_COLOR handled here.
//   D-HOTKEY  the Button exists only while a rare+ is hooked or carried and
//             nothing is frozen.

import {
  reelAvailable,
  type PondResult,
  type PondState,
} from '../core/pond.ts'
import { deriveRng } from '../core/rng.ts'
import { isRareTier, type Tier } from '../core/types.ts'
import {
  blankRow,
  clockText,
  displayName,
  rarityLabel,
  segment,
  segmentsText,
  sizeText,
  textRow,
  type ModelRow,
  type RasterCell,
  type RasterGrid,
  type ReelButton,
  type RenderModel,
  type TextSegment,
  type WidthTier,
} from './model.ts'
import { waterForRow, type PaletteToken } from './palette.ts'

// ------------------------------------------------------------------ geometry

/** ">=70 列档：鱼塘占 39 列，Raster 共 2 行；状态区占 34 列" at 75 columns. */
export const POND_COLUMNS_WIDE = 39
export const POND_ROWS_WIDE = 2
/** "40–69 列：鱼塘 16 列，没有鱼影" — one row, because there is nothing to put below. */
export const POND_COLUMNS_MID = 16
export const POND_ROWS_MID = 1
/** Columns between the pond and the status column, and before the Button. */
export const GAP_COLUMNS = 2

export const TIER_WIDE_MIN_COLUMNS = 70
export const TIER_MID_MIN_COLUMNS = 40

// -------------------------------------------------------------- tunable copy

/** V-RESULT minimum hold, common and uncommon. Tunable; OQ10 may move it. */
export const RESULT_MIN_HOLD_MS = 3000
/** V-RESULT minimum hold, rare and legendary. */
export const RESULT_MIN_HOLD_RARE_MS = 6000
/** V-RESULT: the result goes dim once it is this old. */
export const RESULT_DIM_AFTER_MS = 60_000

export const BUTTON_LABEL_WIDE = 'reel in'
export const BUTTON_LABEL_NARROW = 'reel'
export const DRAFT_HINT = 'Send your draft, then reel it in.'
export const FROZEN_LINE = 'paused · Claude needs you'
export const FROZEN_RARE_HINT = 'Claude needs you first'
export const PAUSED_WORD = 'paused'

// ------------------------------------------------------------- V-AMBIENT

export const AMBIENT_MAX = 2
/** One cell every 2, 3 or 4 s — the interval is seeded per silhouette. */
export const AMBIENT_MOVE_MIN_MS = 2000
export const AMBIENT_MOVE_INTERVAL_CHOICES = 3
export const AMBIENT_SHAPE_RIGHT = '><>'
export const AMBIENT_SHAPE_LEFT = '<><'
/** Non-rare fish on the hook. */
export const HOOKED_SHAPE_COMMON = '><>'
/** Rare and legendary on the hook — longer, but still only decoration (V-MONO). */
export const HOOKED_SHAPE_RARE = '><)))°>'

/**
 * The session seed whose silhouette layout the Visual Spec's F-BAND-WAITING and
 * F-BAND-FROZEN wireframes draw (silhouettes at columns 3 and 27 after 42 s).
 * Exported so the snapshots can reproduce the spec's own picture exactly.
 */
export const AMBIENT_FIXTURE_SEED = 1542

/**
 * Decorative depth readout. Core has depth *zones*, not metres, so the metre
 * figure is render-side decoration calibrated to the spec's own wireframe
 * (`0:42` of waiting reads `depth 3 m`). It is never fed back into the pond.
 */
export const DEPTH_MS_PER_METRE = 14_000

// --------------------------------------------------------------------- input

export type BandInput = {
  /** Pond state as plain data, straight out of `src/core/pond.ts`. */
  state: PondState
  /** Injected real time, epoch ms. */
  now: number
  /** Columns the band may use (the host's body width). */
  bodyColumns: number
  /** Stable per-session seed for the decorative silhouettes. */
  sessionSeed: number
  /** `PromptHint.isDraft`; defaults to whatever core last recorded. */
  isDraft?: boolean
  /** D11 freeze; defaults to whatever core's `activeFreezes` says. */
  isFrozen?: boolean
  /** The `NO_COLOR` environment variable, or true when the read failed. */
  noColor?: boolean
  /** V-RESULT: the result to show; defaults to `state.lastResult`. */
  lastResult?: PondResult | null
  /** Real time the result was first shown, for the hold and the 60 s dim. */
  resultShownAt?: number | null
}

// ------------------------------------------------------------------ entry

export function renderBand(input: BandInput): RenderModel | null {
  const state = input.state
  const noColor = input.noColor === true
  const frozen = input.isFrozen ?? state.activeFreezes.length > 0
  const isDraft = input.isDraft ?? state.isDraft

  const view = resultView(input)
  if (view == null && state.phase === 'idle') return null // F-BAND-IDLE

  // D-HOTKEY: a rare+ on the hook or carried, and nothing frozen. Asking core
  // with the freezes removed keeps the render's view of freezing authoritative.
  // A held result does *not* suppress the Button: hiding an actionable reel
  // would be the one way a narrow or busy band could cost someone a fish.
  const reelOk = !frozen && reelAvailable({ ...state, activeFreezes: [] }, false)

  const requestedTier = widthTier(input.bodyColumns)
  const candidates: WidthTier[] =
    requestedTier === 'mid' ? ['mid', 'text'] : [requestedTier]

  for (const tier of candidates) {
    const plan = planBand(input, { tier, frozen, isDraft, view, reelOk, layoutBlocked: false })
    if (!reelOk || buttonFits(plan, input.bodyColumns)) return materialize(plan, noColor)
  }

  // V-NARROW: the Button cannot be laid out. Keep the fish, pause the clock.
  const fallbackTier = candidates[candidates.length - 1] as WidthTier
  const blocked = planBand(input, {
    tier: fallbackTier,
    frozen,
    isDraft,
    view,
    reelOk: false,
    layoutBlocked: true,
  })
  return materialize(blocked, noColor)
}

export function widthTier(bodyColumns: number): WidthTier {
  const columns = Number.isFinite(bodyColumns) ? Math.floor(bodyColumns) : 0
  if (columns >= TIER_WIDE_MIN_COLUMNS) return 'wide'
  if (columns >= TIER_MID_MIN_COLUMNS) return 'mid'
  return 'text'
}

// ------------------------------------------------------------- result view

type ResultView = {
  result: PondResult
  held: boolean
  dimmed: boolean
}

/**
 * V-RESULT. `escaped` shows nothing at all (F-BAND-ESCAPED-COMMON), a result
 * inside its hold outranks a fresh cast (F-RESULT-MIN-HOLD), and once the hold
 * is over the result only survives while the pond is idle — the next cast takes
 * the band back.
 */
function resultView(input: BandInput): ResultView | null {
  const raw = input.lastResult !== undefined ? input.lastResult : input.state.lastResult
  if (raw == null || raw.kind === 'escaped') return null

  const shownAt = input.resultShownAt ?? null
  const age = shownAt == null ? null : Math.max(0, input.now - shownAt)
  const minHold = isRareTier(raw.tier) ? RESULT_MIN_HOLD_RARE_MS : RESULT_MIN_HOLD_MS
  const held = age != null && age < minHold

  if (!held && input.state.phase !== 'idle') return null
  return { result: raw, held, dimmed: age != null && age >= RESULT_DIM_AFTER_MS }
}

// ------------------------------------------------------------------ planning

type PlanContext = {
  tier: WidthTier
  frozen: boolean
  isDraft: boolean
  view: ResultView | null
  reelOk: boolean
  layoutBlocked: boolean
}

type BandPlan = {
  columns: number
  tier: WidthTier
  pondColumns: number
  pondRows: number
  textColumn: number
  primary: TextSegment[]
  /** Second status line (depth, size, the frozen hint) — wide tier only. */
  secondary: TextSegment[]
  /** The draft hint, on its own line — wide tier only. */
  hint: TextSegment[]
  raster: RasterGrid | null
  button: ReelButton | null
  layoutBlocked: boolean
  resultHeld: boolean
  resultDimmed: boolean
}

function planBand(input: BandInput, ctx: PlanContext): BandPlan {
  const wide = ctx.tier === 'wide'
  const pondColumns = wide ? POND_COLUMNS_WIDE : ctx.tier === 'mid' ? POND_COLUMNS_MID : 0
  const pondRows = wide ? POND_ROWS_WIDE : ctx.tier === 'mid' ? POND_ROWS_MID : 0
  const textColumn = pondColumns === 0 ? 0 : pondColumns + GAP_COLUMNS
  const dim = ctx.view?.dimmed === true

  const lines = wide ? wideStatus(input, ctx) : narrowStatus(input, ctx)

  return {
    columns: input.bodyColumns,
    tier: ctx.tier,
    pondColumns,
    pondRows,
    textColumn,
    primary: paint(lines.primary, dim),
    secondary: paint(lines.secondary, dim),
    hint: paint(lines.hint, dim),
    raster: pondRows === 0 ? null : buildRaster(input, ctx, pondColumns, pondRows),
    button: ctx.reelOk
      ? { label: wide ? BUTTON_LABEL_WIDE : BUTTON_LABEL_NARROW, hotkey: '1' }
      : null,
    layoutBlocked: ctx.layoutBlocked,
    resultHeld: ctx.view?.held === true,
    resultDimmed: dim,
  }
}

/** V-RESULT: "60 秒后 ... 整体使用 dimColor" — dim wins over bold. */
function paint(segments: TextSegment[], dim: boolean): TextSegment[] {
  if (!dim) return segments
  return segments.map((s) => ({ text: s.text, color: 'status.text' as PaletteToken, bold: false, dim: true }))
}

function buttonFits(plan: BandPlan, bodyColumns: number): boolean {
  if (plan.button == null) return true
  const label = `${plan.button.hotkey}: ${plan.button.label}`
  if (plan.tier === 'wide') {
    // The Button gets a status row of its own, so only the status column matters.
    return plan.textColumn + label.length <= bodyColumns
  }
  const primary = segmentsText(plan.primary)
  return plan.textColumn + primary.length + GAP_COLUMNS + label.length <= bodyColumns
}

// ------------------------------------------------------------- status copy

type StatusLines = {
  primary: TextSegment[]
  secondary: TextSegment[]
  hint: TextSegment[]
}

const NONE: TextSegment[] = []

function attention(text: string): TextSegment {
  return segment(text, 'status.attention')
}

function plain(text: string): TextSegment {
  return segment(text, 'status.text')
}

function hookedFish(state: PondState): { tier: Tier; label: string } | null {
  if (state.fish == null) return null
  return { tier: state.fish.tier, label: rarityLabel(state.fish.tier) }
}

/** The >=70 column tier, i.e. every F-BAND-* wireframe in the spec. */
function wideStatus(input: BandInput, ctx: PlanContext): StatusLines {
  const state = input.state
  const view = ctx.view

  if (view != null) return resultLines(view, false)

  const fish = hookedFish(state)
  const rare = fish != null && isRareTier(fish.tier)

  if (ctx.frozen) {
    if (rare && (state.phase === 'hooked' || state.phase === 'carried')) {
      // F-BAND-FROZEN-RARE
      return {
        primary: [attention(fish!.label), plain(' on the line · '), plain(PAUSED_WORD)],
        secondary: [plain(FROZEN_RARE_HINT)],
        hint: NONE,
      }
    }
    // F-BAND-FROZEN
    return { primary: [plain(FROZEN_LINE)], secondary: NONE, hint: NONE }
  }

  const paused = ctx.isDraft || ctx.layoutBlocked
  const hint = ctx.isDraft ? [plain(DRAFT_HINT)] : NONE

  if (state.phase === 'carried' && fish != null) {
    const stopped = paused || state.carry?.grace !== 'running'
    // F-BAND-CARRIED / F-BAND-CARRIED-DRAFT
    const primary: TextSegment[] = [attention('! '), attention(fish.label), plain(' still on the line')]
    if (!stopped) primary.push(plain(' · '), plain(clockText(state.carry?.remainingMs ?? 0)))
    return { primary, secondary: NONE, hint }
  }

  if (state.phase === 'hooked' && fish != null) {
    // F-BAND-RARE-HOOKED / F-BAND-LEGENDARY-HOOKED / F-BAND-RARE-DRAFT
    return {
      primary: [
        attention('! '),
        attention(fish.label),
        plain(' bite · '),
        plain(paused ? PAUSED_WORD : clockText(state.windowRemainingMs ?? 0)),
      ],
      secondary: NONE,
      hint,
    }
  }

  if (fish != null) {
    // F-BAND-BITE-COMMON / F-BAND-BITE-UNCOMMON (this frame, then auto-reel)
    const primary: TextSegment[] = [attention('! '), plain('bite')]
    if (fish.label.length > 0) primary.push(plain(' · '), attention(fish.label))
    return { primary, secondary: NONE, hint: NONE }
  }

  // F-BAND-WAITING
  const elapsed = waitElapsedMs(state)
  return {
    primary: [plain('waiting · '), plain(clockText(elapsed))],
    secondary: [plain(`depth ${depthMetres(elapsed)} m`)],
    hint: NONE,
  }
}

/**
 * The 40-69 and <40 tiers. One line, no secondary, no hint: the spec's own
 * narrow wireframes compress `! RARE bite · 0:14` to `! RARE · 0:14`, so the
 * same compression applies to every other state — drop the middle words, keep
 * the state word, the rarity label and the clock.
 */
function narrowStatus(input: BandInput, ctx: PlanContext): StatusLines {
  const state = input.state
  const view = ctx.view
  const only = (primary: TextSegment[]): StatusLines => ({ primary, secondary: NONE, hint: NONE })

  if (view != null) return only(resultLines(view, true).primary)

  const fish = hookedFish(state)
  const rare = fish != null && isRareTier(fish.tier)

  if (ctx.frozen) {
    if (rare) return only([attention(fish!.label), plain(` · ${PAUSED_WORD}`)])
    return only([plain(FROZEN_LINE)])
  }

  if (rare && (state.phase === 'hooked' || state.phase === 'carried')) {
    const stopped =
      ctx.isDraft ||
      ctx.layoutBlocked ||
      (state.phase === 'carried' && state.carry?.grace !== 'running')
    const remaining =
      state.phase === 'carried' ? (state.carry?.remainingMs ?? 0) : (state.windowRemainingMs ?? 0)
    // F-BAND-60COL-RARE / F-BAND-36COL-RARE / F-BAND-TOO-NARROW
    return only([
      attention('! '),
      attention(fish!.label),
      plain(' · '),
      plain(stopped ? PAUSED_WORD : clockText(remaining)),
    ])
  }

  if (fish != null) {
    const primary: TextSegment[] = [attention('! '), plain('bite')]
    if (fish.label.length > 0) primary.push(plain(' · '), attention(fish.label))
    return only(primary)
  }

  // F-BAND-60COL-WAITING / F-BAND-36COL-WAITING
  return only([plain('waiting · '), plain(clockText(waitElapsedMs(state)))])
}

/** F-BAND-CAUGHT-COMMON / F-BAND-CAUGHT-RARE / F-BAND-SIGHTED. */
function resultLines(view: ResultView, narrow: boolean): StatusLines {
  const result = view.result
  const label = rarityLabel(result.tier)
  const name = displayName(result.speciesId)
  const rare = isRareTier(result.tier)

  if (result.kind === 'sighted') {
    const secondary: TextSegment[] = [plain('slipped away · ')]
    if (label.length > 0) secondary.push(attention(label), plain(' · '))
    secondary.push(plain('noted'))
    return {
      primary: [plain('sighted · '), plain(name)],
      secondary: narrow ? NONE : secondary,
      hint: NONE,
    }
  }

  const primary: TextSegment[] = rare
    ? [attention('★'), plain(' caught · '), plain(name)]
    : [plain('caught · '), plain(name)]
  const secondary: TextSegment[] = [plain(sizeText(result.sizeCm))]
  if (label.length > 0) secondary.push(plain(' · '), attention(label))

  return { primary, secondary: narrow ? NONE : secondary, hint: NONE }
}

function waitElapsedMs(state: PondState): number {
  return Math.max(0, state.clock.simMs - (state.castAtSim ?? 0))
}

export function depthMetres(elapsedMs: number): number {
  return Math.max(0, Math.floor(elapsedMs / DEPTH_MS_PER_METRE))
}

// ------------------------------------------------------------------ the pond

type Silhouette = { column: number; shape: string }

/**
 * V-AMBIENT: up to 2 silhouettes, seeded from the session so they are
 * reproducible, each drifting one cell every 2-4 s.
 *
 * The time base is the pond's *simulated* clock, which core stops advancing
 * while `activeFreezes` is non-empty (D11). That is what makes "冻结时停止移动"
 * fall out for free, and it keeps the renderer a pure function of its input.
 */
export function ambientSilhouettes(
  sessionSeed: number,
  pondColumns: number,
  simMs: number,
): Silhouette[] {
  const out: Silhouette[] = []
  for (let i = 0; i < AMBIENT_MAX; i++) {
    const rng = deriveRng(sessionSeed, `ambient:${i}`)
    const facingRight = rng.next() < 0.5
    const shape = facingRight ? AMBIENT_SHAPE_RIGHT : AMBIENT_SHAPE_LEFT
    const span = Math.max(1, pondColumns - shape.length + 1)
    const base = rng.nextInt(span)
    const intervalMs =
      AMBIENT_MOVE_MIN_MS + rng.nextInt(AMBIENT_MOVE_INTERVAL_CHOICES) * 1000
    const steps = Math.floor(Math.max(0, simMs) / intervalMs)
    const drift = facingRight ? steps : -steps
    out.push({ column: (((base + drift) % span) + span) % span, shape })
  }
  return out
}

function buildRaster(
  input: BandInput,
  ctx: PlanContext,
  columns: number,
  rows: number,
): RasterGrid {
  const state = input.state
  const surface: string[] = new Array(columns).fill('~')
  const centre = Math.floor((columns - 1) / 2)
  const fish = hookedFish(state)
  const showResult = ctx.view != null

  if (!showResult) surface[centre] = fish != null ? '!' : 'o'

  const below: string[] = new Array(columns).fill(' ')
  const accents: Array<PaletteToken | null> = new Array(columns).fill(null)

  if (rows > 1) {
    if (showResult) {
      // F-BAND-CAUGHT-* / F-BAND-SIGHTED: still water, nothing swimming.
    } else if (fish != null) {
      // V-AMBIENT: the decoration goes away the moment something bites.
      const shape = isRareTier(fish.tier) ? HOOKED_SHAPE_RARE : HOOKED_SHAPE_COMMON
      const token: PaletteToken = isRareTier(fish.tier) ? 'fish.rare' : 'fish.common'
      draw(below, accents, centre, shape, token)
    } else {
      for (const silhouette of ambientSilhouettes(input.sessionSeed, columns, state.clock.simMs)) {
        draw(below, accents, silhouette.column, silhouette.shape, 'fish.common')
      }
    }
  }

  const cells: RasterCell[] = []
  for (let row = 0; row < rows; row++) {
    const bg = waterForRow(row)
    for (let column = 0; column < columns; column++) {
      if (row === 0) cells.push({ ch: surface[column] as string, fg: null, bg })
      else cells.push({ ch: below[column] as string, fg: accents[column] ?? null, bg })
    }
  }
  return { columns, rows, cells }
}

function draw(
  line: string[],
  accents: Array<PaletteToken | null>,
  at: number,
  shape: string,
  token: PaletteToken,
): void {
  for (let i = 0; i < shape.length; i++) {
    const column = at + i
    if (column < 0 || column >= line.length) continue
    line[column] = shape.charAt(i)
    accents[column] = token
  }
}

// -------------------------------------------------------------- materialize

function materialize(plan: BandPlan, noColor: boolean): RenderModel {
  const rows: ModelRow[] = [textRow(plan.primary)]

  if (plan.tier === 'wide') {
    if (plan.button != null) {
      rows.push({ segments: [], button: true, buttonColumn: plan.textColumn })
    } else {
      rows.push(plan.secondary.length > 0 ? textRow(plan.secondary) : blankRow())
    }
    if (plan.hint.length > 0) rows.push(textRow(plan.hint))
  } else if (plan.button != null) {
    rows[0] = {
      segments: plan.primary,
      button: true,
      buttonColumn: plan.textColumn + segmentsText(plan.primary).length + GAP_COLUMNS,
    }
  }

  while (rows.length < plan.pondRows) rows.push(blankRow())

  const model: RenderModel = {
    kind: 'band',
    columns: plan.columns,
    tier: plan.tier,
    raster: plan.raster,
    textColumn: plan.textColumn,
    rows,
    reelButton: plan.button,
    meta: {
      reelBlockedByLayout: plan.layoutBlocked,
      reelButtonVisible: plan.button != null,
      resultHeld: plan.resultHeld,
      resultDimmed: plan.resultDimmed,
      noColor,
    },
  }

  return noColor ? withoutColor(model) : model
}

function withoutColor(model: RenderModel): RenderModel {
  return {
    ...model,
    raster:
      model.raster == null
        ? null
        : {
            columns: model.raster.columns,
            rows: model.raster.rows,
            cells: model.raster.cells.map((cell) => ({ ch: cell.ch, fg: null, bg: null })),
          },
    rows: model.rows.map((row) => ({
      ...row,
      segments: row.segments.map((s) => ({ ...s, color: null })),
    })),
  }
}
