// ReelQuiet — the host-agnostic RenderModel.
//
// D4: `src/render/**` may not touch `$`. Everything here is plain data, so the
// renderer can be snapshot-tested as text and `hooks/register.ts` is the only
// place that knows what a Box, a Text, a Raster or a Button actually is.
//
// How register.ts materialises a model:
//
//   Box(direction: 'row')
//     ├── Raster(model.raster)                    // blitted, 10 fps
//     └── Box(direction: 'column')                // starts at model.textColumn
//           └── for each model.rows[i]:
//                 Box(direction: 'row')
//                   ├── Text(row.segments)        // one Text per segment
//                   └── Button(model.reelButton)  // only when row.button
//
// `toPlainText` is the single source of truth for what that is supposed to look
// like, and every `F-*` fixture is asserted against it.

import type { PaletteToken } from './palette.ts'
import { BOLD_TOKENS } from './palette.ts'
// One civil-calendar implementation in the repo: the core helper.
import { utcDateOf, type Tier } from '../core/types.ts'

export type TextSegment = {
  text: string
  /** Palette token, or null for the terminal's own colour (NO_COLOR, V-COLOR). */
  color: PaletteToken | null
  bold: boolean
  dim: boolean
}

export type RasterCell = {
  /** Exactly one character. */
  ch: string
  fg: PaletteToken | null
  bg: PaletteToken | null
}

/** Row-major grid; `cells.length === columns * rows`. */
export type RasterGrid = {
  columns: number
  rows: number
  cells: RasterCell[]
}

/** The platform `Button` (`plain`, `hotkey`), which renders itself as `1: label`. */
export type ReelButton = {
  label: string
  hotkey: '1'
}

/** V-NARROW's three width tiers: >=70 / 40-69 / <40 columns. */
export type WidthTier = 'wide' | 'mid' | 'text'

export type ModelRow = {
  segments: TextSegment[]
  /** The reel Button belongs on this row, starting at `buttonColumn`. */
  button: boolean
  /** Absolute band column where the Button starts, or null when there is none. */
  buttonColumn: number | null
}

export type BandMeta = {
  /**
   * V-NARROW: the encounter is still here, but the reel Button could not be
   * laid out. `register.ts` feeds this straight back into the pond as
   * `reelBlockedByLayout`, which pauses the countdown (D-T2) — the fish never
   * escapes because of a narrow terminal.
   */
  reelBlockedByLayout: boolean
  reelButtonVisible: boolean
  /** V-RESULT: the result is inside its minimum hold and outranks a new cast. */
  resultHeld: boolean
  /** V-RESULT: the result is at least 60 s old, so the whole band is dim. */
  resultDimmed: boolean
  noColor: boolean
}

export type RenderModel = {
  kind: 'band'
  /** Body columns the model was laid out for. */
  columns: number
  tier: WidthTier
  /** The pond. Occupies the first `raster.rows` lines, columns 0..columns-1. */
  raster: RasterGrid | null
  /** Column where every text row starts (raster width + gap). */
  textColumn: number
  rows: ModelRow[]
  reelButton: ReelButton | null
  meta: BandMeta
}

// ------------------------------------------------------------------ builders

export function segment(
  text: string,
  color: PaletteToken | null = 'status.text',
  over: { bold?: boolean; dim?: boolean } = {},
): TextSegment {
  return {
    text,
    color,
    bold: over.bold ?? (color != null && BOLD_TOKENS.includes(color)),
    dim: over.dim ?? false,
  }
}

export function blankRow(): ModelRow {
  return { segments: [], button: false, buttonColumn: null }
}

export function textRow(segments: TextSegment[]): ModelRow {
  return { segments, button: false, buttonColumn: null }
}

/** What the platform Button prints: `1: reel in`. */
export function buttonText(button: ReelButton): string {
  return `${button.hotkey}: ${button.label}`
}

export function segmentsText(segments: readonly TextSegment[]): string {
  return segments.map((s) => s.text).join('')
}

// ------------------------------------------------------------------ rendering

function padTo(line: string, column: number): string {
  return line.length >= column ? line : line + ' '.repeat(column - line.length)
}

function trimEnd(line: string): string {
  let end = line.length
  while (end > 0 && line[end - 1] === ' ') end--
  return line.slice(0, end)
}

export function rasterRowText(raster: RasterGrid, row: number): string {
  if (row < 0 || row >= raster.rows) return ''
  let out = ''
  for (let column = 0; column < raster.columns; column++) {
    out += raster.cells[row * raster.columns + column]?.ch ?? ' '
  }
  return out
}

/**
 * The band as plain text, one line per model row, trailing spaces trimmed.
 *
 * This is what the `F-*` snapshots compare against, and it is pure: no colour,
 * no ANSI, no host.
 */
export function toPlainText(model: RenderModel): string {
  const lineCount = Math.max(model.rows.length, model.raster?.rows ?? 0)
  const lines: string[] = []

  for (let i = 0; i < lineCount; i++) {
    let line = model.raster != null && i < model.raster.rows ? rasterRowText(model.raster, i) : ''
    const row = model.rows[i]
    if (row != null) {
      if (row.segments.length > 0) line = padTo(line, model.textColumn) + segmentsText(row.segments)
      if (row.button && model.reelButton != null) {
        line = padTo(line, row.buttonColumn ?? model.textColumn) + buttonText(model.reelButton)
      }
    }
    lines.push(trimEnd(line))
  }

  return lines.join('\n')
}

/**
 * Drop every colour token, keeping `bold` / `dim` and every character.
 *
 * F-COLOR-*: `stripColor(coloured)` must equal the monochrome model exactly, so
 * this also flips `meta.noColor` — the monochrome model is simply the model a
 * NO_COLOR terminal gets.
 */
export function stripColor(model: RenderModel): RenderModel {
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
    meta: { ...model.meta, noColor: true },
  }
}

// -------------------------------------------------------- shared render words

/**
 * V-LABEL: common has no label, uncommon is lowercase, rare and legendary shout.
 * The band, the catch card and Recent memories all use this one function.
 */
export function rarityLabel(tier: Tier): string {
  switch (tier) {
    case 'uncommon':
      return 'uncommon'
    case 'rare':
      return 'RARE'
    case 'legendary':
      return 'LEGENDARY'
    default:
      return ''
  }
}

/**
 * Display name for a species id or common name: `common-fangtooth` and
 * `common fangtooth` both become `Common fangtooth`, which is how every fixture
 * in the Visual Spec prints them.
 *
 * Only the first character is touched, so a name that is already capitalised
 * ("Atlantic mackerel") survives untouched.
 */
export function displayName(value: string): string {
  const words = String(value ?? '')
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .join(' ')
  if (words.length === 0) return ''
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function sizeText(sizeCm: number): string {
  return `${sizeCm} cm`
}

/** `M:SS`, floored. Negative and non-finite durations read `0:00`. */
export function clockText(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

/** `MM-DD` at the injected UTC offset (minutes, east positive), by integer arithmetic (no Date). */
export function monthDayText(timestamp: number, offsetMinutes = 0): string {
  return utcDateString(timestamp + offsetMinutes * 60000).slice(5)
}

/** `HH:MM` at the injected UTC offset (minutes, east positive), by integer arithmetic (no Date). */
export function hourMinuteText(timestamp: number, offsetMinutes = 0): string {
  const local = timestamp + offsetMinutes * 60000
  const ms = Number.isFinite(local) ? Math.max(0, Math.floor(local)) : 0
  const msOfDay = ms - Math.floor(ms / 86400000) * 86400000
  const hours = Math.floor(msOfDay / 3600000)
  const minutes = Math.floor((msOfDay % 3600000) / 60000)
  return `${pad2(hours)}:${pad2(minutes)}`
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function utcDateString(timestamp: number): string {
  return utcDateOf(Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : 0)
}
