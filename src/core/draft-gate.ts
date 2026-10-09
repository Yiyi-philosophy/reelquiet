// ReelQuiet — the reel-hotkey settle gate.
//
// V2: the reel hotkey is a bare `1` typed into an empty prompt. The host shows
// that digit as a draft (`PromptHint.isDraft`) for ~400–415 ms, then eats it and
// presses the band Button. Taken at face value, the keystroke that reels would
// first read as "a draft is up" and flash "paused / Send your draft, then reel it
// in." at the very moment the person is reeling.
//
// So while a reel is actionable, a *new* draft is held for `DRAFT_SETTLE_MS`
// before the pond hears about it:
//   - it clears in time (the hotkey fired, or the digit was deleted): the pond
//     never saw a draft;
//   - it is still there after the settle: it is a real draft and applies as
//     before (D13 pause, draft hint).
// While a draft is held the pond does not tick, so the hold never costs any of
// the rare window or the carried grace (the same fairness as the D13 pause).
//
// Outside an actionable reel, and for clearing a draft, nothing is held: those
// apply at once, exactly as before. No prompt text is read; only `isDraft`.

/** About twice V2's measured 400–415 ms, so a hotkey press always settles first. */
export const DRAFT_SETTLE_MS = 800

export type DraftGate = {
  /** When the currently held draft was first seen; null when nothing is held. */
  heldSince: number | null
}

export type DraftDecision =
  /** Nothing to do. */
  | { kind: 'none' }
  /** Tell the pond (`draftChanged`). */
  | { kind: 'apply'; isDraft: boolean }
  /** A new draft is settling: show nothing new, do not tick. */
  | { kind: 'hold' }
  /** A held draft went away unapplied: resync the pond clock past the hold. */
  | { kind: 'release' }

export function createDraftGate(): DraftGate {
  return { heldSince: null }
}

/**
 * @param observed  the host's latest `isDraft`
 * @param applied   what the pond currently believes (`state.isDraft`)
 * @param reelReady `reelActionable(state)`: a lone digit would reel right now
 */
export function gateDraft(
  gate: DraftGate,
  observed: boolean,
  applied: boolean,
  reelReady: boolean,
  now: number,
): { gate: DraftGate; decision: DraftDecision } {
  const idle: DraftGate = { heldSince: null }

  if (observed === applied) {
    return { gate: idle, decision: gate.heldSince === null ? { kind: 'none' } : { kind: 'release' } }
  }
  if (!observed) return { gate: idle, decision: { kind: 'apply', isDraft: false } }

  // A new draft. Once a hold has started it runs to the end even if the reel
  // stops being actionable meanwhile (the hotkey's own reel lands first).
  if (gate.heldSince === null) {
    if (!reelReady) return { gate: idle, decision: { kind: 'apply', isDraft: true } }
    return { gate: { heldSince: now }, decision: { kind: 'hold' } }
  }
  if (now - gate.heldSince >= DRAFT_SETTLE_MS) {
    return { gate: idle, decision: { kind: 'apply', isDraft: true } }
  }
  return { gate, decision: { kind: 'hold' } }
}
