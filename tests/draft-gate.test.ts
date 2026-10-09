import { describe, expect, test } from 'claude-code/testing'

import { createDraftGate, DRAFT_SETTLE_MS, gateDraft, type DraftGate } from '../src/core/draft-gate.ts'
import { T0 } from './helpers.ts'

// V2 regression: the reel hotkey's own `1` shows as a draft for ~400 ms. It must
// never read as "Send your draft", and real typing must still pause the reel.

type Obs = { at: number; observed: boolean; applied: boolean; reelReady: boolean }

function run(observations: Obs[]) {
  let gate: DraftGate = createDraftGate()
  return observations.map((o) => {
    const r = gateDraft(gate, o.observed, o.applied, o.reelReady, T0 + o.at)
    gate = r.gate
    return r.decision.kind === 'apply' ? `apply:${r.decision.isDraft}` : r.decision.kind
  })
}

describe('V2 hotkey settle gate', () => {
  test('the hotkey digit (draft for ~410 ms, then eaten) never reaches the pond', () => {
    const out = run([
      { at: 0, observed: true, applied: false, reelReady: true },
      { at: 100, observed: true, applied: false, reelReady: true },
      { at: 400, observed: true, applied: false, reelReady: true },
      // The hotkey fired: the reel landed (no longer actionable) and the digit is gone.
      { at: 500, observed: false, applied: false, reelReady: false },
    ])
    expect(out).toEqual(['hold', 'hold', 'hold', 'release'])
  })

  test('the hold outlasts the reel landing first, while the digit is still on screen', () => {
    const out = run([
      { at: 0, observed: true, applied: false, reelReady: true },
      { at: 450, observed: true, applied: false, reelReady: false },
      { at: 550, observed: false, applied: false, reelReady: false },
    ])
    expect(out).toEqual(['hold', 'hold', 'release'])
  })

  test('real typing during a bite still becomes a draft once it settles', () => {
    const out = run([
      { at: 0, observed: true, applied: false, reelReady: true },
      { at: DRAFT_SETTLE_MS - 100, observed: true, applied: false, reelReady: true },
      { at: DRAFT_SETTLE_MS, observed: true, applied: false, reelReady: true },
      { at: DRAFT_SETTLE_MS + 100, observed: true, applied: true, reelReady: false },
    ])
    expect(out).toEqual(['hold', 'hold', 'apply:true', 'none'])
  })

  test('a digit typed with no reel on offer is an ordinary draft at once', () => {
    expect(run([{ at: 0, observed: true, applied: false, reelReady: false }])).toEqual(['apply:true'])
  })

  test('clearing a draft is never held', () => {
    expect(run([{ at: 0, observed: false, applied: true, reelReady: false }])).toEqual(['apply:false'])
  })

  test('the settle is longer than the measured hotkey delay (V2: 400–415 ms)', () => {
    expect(DRAFT_SETTLE_MS).toBeGreaterThanOrEqual(2 * 400)
  })
})
