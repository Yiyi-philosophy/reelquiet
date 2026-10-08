// ReelQuiet — the V-COLOR palette.
//
// The whole table comes from "## Stage 1 Visual Spec" → "色板（V-COLOR）":
//
//   water.surface / water.mid / water.deep   Raster background
//   fish.common                              decorative silhouettes, common fish
//   fish.rare                                rare+ fish shapes (amber, emphasis only)
//   status.text                              status text — the theme's own colour
//   status.attention                         `!` and rarity labels — theme colour + bold
//
// V-MONO comes first: colour only ever raises emphasis, it never carries
// information of its own. Two of the tokens therefore resolve to "no colour at
// all" by design — `status.text` and `status.attention` keep the terminal's
// foreground so that light themes stay readable, and lean on `bold` / `dimColor`
// instead.
//
// NO_COLOR (probe, 2026-10-08): the host strips colour from `Text` but *not*
// from `Raster` cells, so the renderer has to do it. `resolveRasterColor`
// returns the host's "terminal default" sentinel in that case.
//
// Nothing here touches the host API: `register.ts` reads the `NO_COLOR`
// environment variable and passes the answer in as a plain boolean.

export type PaletteToken =
  | 'water.surface'
  | 'water.mid'
  | 'water.deep'
  | 'fish.common'
  | 'fish.rare'
  | 'status.text'
  | 'status.attention'

export const PALETTE_TOKENS: readonly PaletteToken[] = [
  'water.surface',
  'water.mid',
  'water.deep',
  'fish.common',
  'fish.rare',
  'status.text',
  'status.attention',
]

/** 24-bit RGB per token; `null` means "keep the terminal's own colour". */
const PALETTE_RGB: Readonly<Record<PaletteToken, number | null>> = {
  'water.surface': 0x0f3b47,
  'water.mid': 0x0b2a3a,
  'water.deep': 0x08182a,
  'fish.common': 0x5f8f99,
  'fish.rare': 0xffb300,
  // Theme default plus bold — deliberately uncoloured (V-COLOR).
  'status.text': null,
  'status.attention': null,
}

/** The host's "use the terminal default" Raster colour, from the spec. */
export const TERMINAL_DEFAULT_COLOR = 0x01000000

/** Tokens that are bold rather than coloured. */
export const BOLD_TOKENS: readonly PaletteToken[] = ['status.attention']

/**
 * Resolve a token to a 24-bit value, or `null` for the terminal default.
 *
 * `noColor` collapses every token to `null`, which is what makes the F-COLOR
 * fixtures hold: the monochrome output and the coloured output differ only in
 * the colour channel, never in a single character.
 */
export function resolveColor(token: PaletteToken | null | undefined, noColor = false): number | null {
  if (token == null || noColor) return null
  return PALETTE_RGB[token] ?? null
}

/** Raster cells need a concrete number, so `null` becomes the host sentinel. */
export function resolveRasterColor(
  token: PaletteToken | null | undefined,
  noColor = false,
): number {
  const value = resolveColor(token, noColor)
  return value == null ? TERMINAL_DEFAULT_COLOR : value
}

/** Depth ramp for Raster rows: surface, then mid, then deep for anything below. */
export const WATER_RAMP: readonly PaletteToken[] = ['water.surface', 'water.mid', 'water.deep']

export function waterForRow(row: number): PaletteToken {
  const index = Math.min(Math.max(Math.floor(row), 0), WATER_RAMP.length - 1)
  return WATER_RAMP[index] as PaletteToken
}
