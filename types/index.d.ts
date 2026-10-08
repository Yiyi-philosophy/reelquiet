// Self-contained $.state contract (the validator forbids imports here).
// `pond` holds src/core/pond.ts PondState as plain JSON; register.tsx narrows it.
declare module 'claude-code' {
  interface PluginState {
    reelquiet: {
      pond: object | null
      signals: { red: Record<string, true> }
      seenCards: string[]
      resultShownAt: number | null
      clearResultAfterHold: boolean
    }
  }
}
