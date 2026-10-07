import { describe, expect, test } from 'claude-code/testing'

import { makeRecord } from '../src/core/records.ts'
import {
  BUILTIN_TEST_COMMAND_PATTERNS,
  castAllowed,
  clearSession,
  compilePatterns,
  createSignalsState,
  fingerprintOf,
  isMainAgent,
  isTestCommand,
  observeCommand,
} from '../src/core/signals.ts'

describe('test-command matching', () => {
  const matching = [
    'npm test',
    'npm run test -- --watch=false',
    'pnpm test',
    'yarn test',
    'bun test',
    'npx jest src/',
    'npx vitest run',
    'pytest -q tests/',
    'cargo test --all',
    'go test ./...',
    'mvn test',
    'gradle test',
    './gradlew test',
    'make test',
    'rspec spec/models',
    'phpunit --testsuite unit',
    'dotnet test',
  ]

  for (const command of matching) {
    test(`matches ${command}`, () => {
      expect(isTestCommand(command)).toBe(true)
    })
  }

  test('leaves unrelated commands alone', () => {
    for (const command of ['git status', 'npm install', 'ls -la', 'echo test', '', '   ']) {
      expect(isTestCommand(command)).toBe(false)
    }
  })

  test('the built-in list is fixed and users append their own regexes', () => {
    expect(BUILTIN_TEST_COMMAND_PATTERNS.length).toBe(11)
    expect(isTestCommand('claude plugin test .')).toBe(false)
    expect(isTestCommand('claude plugin test .', ['claude plugin test'])).toBe(true)
  })

  test('a user regex that will not compile is skipped, never thrown', () => {
    const compiled = compilePatterns(['([unclosed', 'ok-pattern'])
    expect(compiled.invalid).toEqual(['([unclosed'])
    expect(compiled.patterns.length).toBe(BUILTIN_TEST_COMMAND_PATTERNS.length + 1)
    expect(isTestCommand('npm test', ['([unclosed'])).toBe(true)
  })

  test('fingerprints normalize spacing, case and trailing noise', () => {
    expect(fingerprintOf('  NPM   test ;')).toBe('npm test')
    expect(fingerprintOf('npm test')).toBe(fingerprintOf('NPM  TEST'))
    expect(fingerprintOf('npm test')).not.toBe(fingerprintOf('npm test -- --watch'))
  })
})

describe('red -> green fires once', () => {
  const obs = (command: string, isError: boolean, extra: Record<string, unknown> = {}) => ({
    sessionId: 'sess-1',
    command,
    isError,
    ...extra,
  })

  test('a red light then a green light fires exactly one signal', () => {
    let state = createSignalsState()

    const red = observeCommand(state, obs('npm test', true))
    state = red.state
    expect(red.signals).toHaveLength(0)
    expect(Object.keys(state.red)).toHaveLength(1)

    const green = observeCommand(state, obs('npm test', false))
    state = green.state
    expect(green.signals).toHaveLength(1)
    expect(green.signals[0].type).toBe('tests-green')
    expect(Object.keys(state.red)).toHaveLength(0)

    // Staying green never fires again.
    const again = observeCommand(state, obs('npm test', false))
    expect(again.signals).toHaveLength(0)
  })

  test('green with no red light before it fires nothing', () => {
    const result = observeCommand(createSignalsState(), obs('pytest', false))
    expect(result.signals).toHaveLength(0)
    expect(Object.keys(result.state.red)).toHaveLength(0)
  })

  test('the red light is keyed by session plus fingerprint', () => {
    let state = createSignalsState()
    state = observeCommand(state, obs('npm test', true)).state

    // Same fingerprint, different session: not our red light.
    expect(observeCommand(state, { sessionId: 'sess-2', command: 'npm test', isError: false }).signals).toHaveLength(0)
    // Different fingerprint, same session: also not our red light.
    expect(observeCommand(state, obs('pytest', false)).signals).toHaveLength(0)
    // Same session, same fingerprint, reformatted: still our red light.
    expect(observeCommand(state, obs('  NPM   test ;', false)).signals).toHaveLength(1)
  })

  test('a repeated red light does not pile up', () => {
    let state = createSignalsState()
    state = observeCommand(state, obs('npm test', true)).state
    const second = observeCommand(state, obs('npm test', true))
    expect(Object.keys(second.state.red)).toHaveLength(1)
  })

  test('clearSession drops only that session and never mutates the old state', () => {
    let state = createSignalsState()
    state = observeCommand(state, obs('npm test', true)).state
    state = observeCommand(state, { sessionId: 'sess-2', command: 'pytest', isError: true }).state
    expect(Object.keys(state.red)).toHaveLength(2)

    const cleared = clearSession(state, 'sess-1')
    expect(Object.keys(cleared.red)).toHaveLength(1)
    expect(Object.keys(state.red)).toHaveLength(2)
  })

  test('D12: a fingerprint never leaves this module and never reaches a record', () => {
    let state = createSignalsState()
    state = observeCommand(state, obs('npm test', true)).state
    const green = observeCommand(state, obs('npm test', false))

    // The signal itself carries no command text.
    expect(Object.keys(green.signals[0]).sort()).toEqual(['fromSubagent', 'sessionId', 'type'])
    expect(JSON.stringify(green.signals[0])).not.toContain('npm test')

    // And the record builder drops it even if a caller tried to pass it in.
    const record = makeRecord({
      species: 'test-common',
      size_cm: 10,
      rarity: 'common',
      outcome: 'caught',
      timestamp: 1,
      event_type: 'tests-green',
      fingerprint: 'npm test',
      command: 'npm test',
    })
    expect(JSON.stringify(record)).not.toContain('npm test')
    expect('fingerprint' in record).toBe(false)
  })
})

describe('subagents signal but never cast', () => {
  test('a subagent tool.call still produces the signal', () => {
    let state = createSignalsState()
    state = observeCommand(state, { sessionId: 'sess-1', command: 'npm test', isError: true, agentId: 'agent-7' }).state
    const green = observeCommand(state, {
      sessionId: 'sess-1',
      command: 'npm test',
      isError: false,
      agentId: 'agent-7',
    })

    expect(green.signals).toHaveLength(1)
    expect(green.signals[0].fromSubagent).toBe(true)
  })

  test('dedupe is per session, so a subagent can clear the main agent red light', () => {
    let state = createSignalsState()
    state = observeCommand(state, { sessionId: 'sess-1', command: 'npm test', isError: true }).state
    const green = observeCommand(state, {
      sessionId: 'sess-1',
      command: 'npm test',
      isError: false,
      agentId: 'agent-7',
    })
    expect(green.signals).toHaveLength(1)
  })

  test('only the main agent may cast', () => {
    expect(castAllowed({})).toBe(true)
    expect(castAllowed({ agentId: null })).toBe(true)
    expect(castAllowed({ agentId: '' })).toBe(true)
    expect(castAllowed({ agentId: 'agent-7' })).toBe(false)
    expect(isMainAgent('agent-7')).toBe(false)
  })
})
