// ReelQuiet — progress signals from events that are already happening.
//
// Zero tokens, zero file access: the only input is a command string the host
// already handed us plus its `isError` flag (F5 — Bash results carry no exit
// code, so `isError` is the red/green test).
//
// D12: the command fingerprint is session memory only. It lives in the state
// this module returns (destined for the session's plugin state) and is never
// written to the cross-session plugin store, nor put on a record.

export type Signal = {
  type: 'tests-green'
  sessionId: string
  /** Subagent tool calls do produce signals — they just never cast. */
  fromSubagent: boolean
}

/** Red-light memory, keyed by session id + normalized command fingerprint. */
export type SignalsState = {
  red: Readonly<Record<string, true>>
}

export type CommandObservation = {
  sessionId: string
  command: string
  /** True when the command failed (F5: `isError` is all Bash gives us). */
  isError: boolean
  /** Empty/absent means the main agent; anything else is a subagent. */
  agentId?: string | null
}

/**
 * The built-in list from the design's "测试命令识别" section. Users append
 * their own through `userConfig.testCommands`; this list is not user-editable.
 */
export const BUILTIN_TEST_COMMAND_PATTERNS: readonly string[] = [
  '\\b(npm|pnpm|yarn|bun)\\s+(run\\s+)?test\\b',
  '\\bnpx\\s+(jest|vitest)\\b',
  '\\bpytest\\b',
  '\\bcargo\\s+test\\b',
  '\\bgo\\s+test\\b',
  '\\bmvn\\s+test\\b',
  '\\b(gradle|gradlew|\\./gradlew)\\s+test\\b',
  '\\bmake\\s+test\\b',
  '\\brspec\\b',
  '\\bphpunit\\b',
  '\\bdotnet\\s+test\\b',
]

export function createSignalsState(): SignalsState {
  return { red: {} }
}

/** Main agent only: `e.agentId` empty. Subagents never cast (design, "子代理"). */
export function isMainAgent(agentId?: string | null): boolean {
  return agentId == null || agentId === ''
}

/** Whether a `turn.start` from this agent should cast. */
export function castAllowed(event: { agentId?: string | null }): boolean {
  return isMainAgent(event.agentId)
}

export type CompiledPatterns = {
  patterns: RegExp[]
  /** User regexes that would not compile — reported, never thrown. */
  invalid: string[]
}

/** Built-ins plus the user's extra regexes. A bad user regex is skipped, not fatal. */
export function compilePatterns(extra: readonly string[] = []): CompiledPatterns {
  const patterns: RegExp[] = []
  const invalid: string[] = []
  for (const source of BUILTIN_TEST_COMMAND_PATTERNS) patterns.push(new RegExp(source, 'i'))
  for (const source of extra) {
    if (typeof source !== 'string' || source.length === 0) {
      invalid.push(String(source))
      continue
    }
    try {
      patterns.push(new RegExp(source, 'i'))
    } catch {
      invalid.push(source)
    }
  }
  return { patterns, invalid }
}

export function isTestCommand(command: string, extra: readonly string[] = []): boolean {
  if (typeof command !== 'string' || command.trim().length === 0) return false
  const { patterns } = compilePatterns(extra)
  return patterns.some((re) => re.test(command))
}

/**
 * Normalized command fingerprint: lowercased, whitespace collapsed, wrapping
 * quotes and trailing separators removed. Enough that `npm test` and
 * `  NPM   test ;` are the same red light, without pretending to parse a shell.
 */
export function fingerprintOf(command: string): string {
  if (typeof command !== 'string') return ''
  let text = command.trim().replace(/\s+/g, ' ').toLowerCase()
  text = text.replace(/^['"`]+/, '').replace(/['"`]+$/, '')
  text = text.replace(/[;&|\s]+$/, '')
  return text
}

function redKey(sessionId: string, fingerprint: string): string {
  return `${sessionId}\u0000${fingerprint}`
}

/**
 * Observe one command result.
 *
 * Red (isError) remembers the fingerprint. The first green for a remembered
 * fingerprint fires exactly one `tests-green` signal and forgets the red light,
 * so a suite that stays green never fires again.
 */
export function observeCommand(
  state: SignalsState,
  obs: CommandObservation,
  extraPatterns: readonly string[] = [],
): { state: SignalsState; signals: Signal[] } {
  if (!isTestCommand(obs.command, extraPatterns)) return { state, signals: [] }

  const key = redKey(obs.sessionId, fingerprintOf(obs.command))

  if (obs.isError) {
    if (state.red[key]) return { state, signals: [] }
    return { state: { red: { ...state.red, [key]: true } }, signals: [] }
  }

  if (!state.red[key]) return { state, signals: [] }

  const red = { ...state.red }
  delete red[key]
  return {
    state: { red },
    signals: [{ type: 'tests-green', sessionId: obs.sessionId, fromSubagent: !isMainAgent(obs.agentId) }],
  }
}

/** Session over: drop every red light it owns (design, "会话结束时全部清空"). */
export function clearSession(state: SignalsState, sessionId: string): SignalsState {
  const prefix = `${sessionId}\u0000`
  const red: Record<string, true> = {}
  for (const key of Object.keys(state.red)) {
    if (!key.startsWith(prefix)) red[key] = true
  }
  return { red }
}
