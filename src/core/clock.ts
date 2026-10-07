// ReelQuiet — the simulated clock.
//
// Design, "时间推进": the pond only ever advances from an injected `now`. It
// never reads the system clock, and it never advances while frozen (D11).
//
// Kept separate from pond.ts so that "advance by injected now; frozen does not
// advance" is testable on its own (see the Eng Review test diagram).

export type SimClock = {
  /** Simulated milliseconds elapsed since the clock was created. */
  simMs: number
  /** Last real `now` observed, or null before the first observation. */
  lastRealNow: number | null
}

export function createClock(now: number | null = null): SimClock {
  return { simMs: 0, lastRealNow: now }
}

/**
 * Observe real time without advancing the simulation — used when entering or
 * leaving a freeze so the paused stretch is never credited to the sim.
 */
export function resync(clock: SimClock, now: number): SimClock {
  return { simMs: clock.simMs, lastRealNow: now }
}

/**
 * Advance the simulation to `now`.
 *
 * `frozen` swallows the elapsed time (D11: sim time does not advance while
 * `activeFreezes` is non-empty). Backwards jumps contribute 0 so a clock change
 * can never rewind the pond.
 */
export function advance(clock: SimClock, now: number, frozen: boolean): { clock: SimClock; dt: number } {
  const previous = clock.lastRealNow
  const raw = previous == null ? 0 : now - previous
  const dt = frozen || !(raw > 0) ? 0 : raw
  return { clock: { simMs: clock.simMs + dt, lastRealNow: now }, dt }
}
