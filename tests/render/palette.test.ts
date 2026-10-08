// D-T4: the V-COLOR palette table, and the NO_COLOR behaviour the probe found.

import { describe, expect, test } from 'claude-code/testing'

import {
  PALETTE_TOKENS,
  TERMINAL_DEFAULT_COLOR,
  resolveColor,
  resolveRasterColor,
  waterForRow,
} from '../../src/render/palette.ts'

describe('V-COLOR palette', () => {
  test('the spec table, as 24-bit values', () => {
    expect(resolveColor('water.surface')).toBe(0x0f3b47)
    expect(resolveColor('water.mid')).toBe(0x0b2a3a)
    expect(resolveColor('water.deep')).toBe(0x08182a)
    expect(resolveColor('fish.common')).toBe(0x5f8f99)
    expect(resolveColor('fish.rare')).toBe(0xffb300)
  })

  test('status tokens keep the theme colour and lean on bold / dim instead', () => {
    expect(resolveColor('status.text')).toBe(null)
    expect(resolveColor('status.attention')).toBe(null)
  })

  test('noColor collapses every token to the terminal default', () => {
    for (const token of PALETTE_TOKENS) {
      expect(resolveColor(token, true)).toBe(null)
      expect(resolveRasterColor(token, true)).toBe(TERMINAL_DEFAULT_COLOR)
    }
    expect(TERMINAL_DEFAULT_COLOR).toBe(0x01000000)
  })

  test('a Raster cell always gets a number, default included', () => {
    expect(resolveRasterColor('fish.rare')).toBe(0xffb300)
    expect(resolveRasterColor(null)).toBe(TERMINAL_DEFAULT_COLOR)
    expect(resolveRasterColor('status.text')).toBe(TERMINAL_DEFAULT_COLOR)
  })

  test('the water ramp runs surface, mid, then deep', () => {
    expect(waterForRow(0)).toBe('water.surface')
    expect(waterForRow(1)).toBe('water.mid')
    expect(waterForRow(2)).toBe('water.deep')
    expect(waterForRow(9)).toBe('water.deep')
    expect(waterForRow(-1)).toBe('water.surface')
  })
})
