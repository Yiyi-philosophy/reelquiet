import { expect, mock, test } from 'claude-code/testing'

// G2 integration: the hooks module against the engine's test kit.
// The worker runs on $.clock.every, so every test drives a mock clock.

const T0 = Date.UTC(2026, 9, 8, 12, 0, 0)

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 75,
  scroll: { offset: 0, bodyRows: 9, totalRows: 3 },
} as never

type HostOptions = {
  // Make every $.store / $.state write take this long (ms of mock time), or fail.
  slowWritesMs?: number
  failStateSetOnce?: boolean
  sessionId?: string
  now?: number
  // Collects every transcript row the plugin writes with $.ui.log.
  logs?: string[]
}

function host(on: any, opts: HostOptions = {}) {
  const clock = mock.clock(on, { now: opts.now ?? T0 })
  if (opts.slowWritesMs) {
    const mem: Record<string, unknown> = {}
    on('store.keys', () => ({ value: Object.keys(mem) }))
    on('store.get', (_$: unknown, e: { key: string }) => ({ value: mem[e.key] }))
    on('store.set', async (_$: unknown, e: { key: string; value: unknown }) => {
      await clock.sleep(opts.slowWritesMs as number)
      mem[e.key] = e.value
      return { value: undefined }
    })
    // $.state writes (persist) are slow too: the old design awaited these before next(e).
    on('state.set', async (_$: unknown, e: unknown, next: (x: unknown) => unknown) => {
      await clock.sleep(opts.slowWritesMs as number)
      return next(e)
    })
  } else {
    mock.store(on)
  }
  if (opts.failStateSetOnce) {
    let failed = false
    on('state.set', (_$: unknown, e: unknown, next: (x: unknown) => unknown) => {
      if (!failed) {
        failed = true
        throw new Error('state write refused')
      }
      return next(e)
    })
  }
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.id', () => ({ value: opts.sessionId ?? 'test-session' }))
  on('session.repo', () => ({ value: { root: '/work/demo-repo', remote: null, internal: false } }))
  on('env.get', () => ({ value: undefined }))
  on('ui.log', (_$: unknown, e: unknown) => {
    opts.logs?.push(typeof e === 'string' ? e : JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_$: unknown, e: unknown) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
  return clock
}

function flatten(el: unknown): string {
  if (el === null || el === undefined) return ''
  if (typeof el === 'string') return el
  if (Array.isArray(el)) return el.map(flatten).join('')
  const node = el as { type?: string; props?: Record<string, unknown>; children?: unknown }
  const kids = node.children ?? node.props?.children
  if (node.type === 'Button') return `[${String(node.props?.label)}]`
  if (node.type === 'Box') {
    return (Array.isArray(kids) ? kids : [kids]).map(flatten).join(node.props?.flexDirection === 'column' ? '\n' : '')
  }
  return flatten(kids)
}

async function band($: any): Promise<string> {
  const mounted = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  return flatten(await mounted.drawn())
}

async function startSession($: any, clock: any) {
  await $.session.start({ cwd: '/work/demo-repo' } as never)
  await clock.advance(100)
}

test('fail-open: a tool result passes through unchanged', async ($, on) => {
  host(on)
  on('tool.call', () => ({ result: 'exact-tool-output' }))
  const r = await $.tool.call({ tool: 'Read', file_path: 'README.md' })
  expect(r.text ?? r.result).toBe('exact-tool-output')
})

test('fail-open: a Bash failure result passes through unchanged', async ($, on) => {
  host(on)
  on('tool.call', () => ({ result: 'FAIL 3 tests', isError: true }))
  const r = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(r.isError).toBe(true)
})

test('/reelquiet log answers {} so nothing reaches Claude', async ($, on) => {
  const clock = host(on)
  await startSession($, clock)
  const answer = await $.command.run({ command: 'reelquiet', args: 'log' })
  expect(answer.text).toBeUndefined()
})

test('turn.start casts and the worker shows waiting', async ($, on) => {
  const clock = host(on)
  await startSession($, clock)
  await $.turn.start({ text: 'do something', turnId: 't1' } as never)
  await clock.advance(100)
  expect(await band($)).toContain('waiting')
})

test('a subagent turn.start does not cast', async ($, on) => {
  const clock = host(on)
  await startSession($, clock)
  await $.turn.start({ text: 'sub', turnId: 't2', agentId: 'agent-1' } as never)
  await clock.advance(100)
  expect(await band($)).not.toContain('waiting')
})

test('a tool call never waits for slow game storage', async ($, on) => {
  const clock = host(on, { slowWritesMs: 60_000 })
  on('tool.call', () => ({ result: 'done' }))
  await startSession($, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  // The worker is now stuck behind a 60 s mock-time write; the tool call must not be.
  const r = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(r.text ?? r.result).toBe('done')
})

test('concurrent freezes: the pond stays frozen until every call settles (identity set)', async ($, on) => {
  const clock = host(on)
  const gates: Array<(v: unknown) => void> = []
  on('tool.call', async () => {
    await new Promise(r => gates.push(r))
    return { result: 'answered' }
  })
  await startSession($, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const a = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  const b = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(100)
  expect(await band($)).toContain('Claude needs you')

  gates[0](null)
  await a
  await clock.advance(100)
  expect(await band($)).toContain('Claude needs you')

  gates[1](null)
  await b
  await clock.advance(100)
  expect(await band($)).not.toContain('Claude needs you')
})

test('AskUserQuestion freezes for the whole call', async ($, on) => {
  const clock = host(on)
  let release: (v: unknown) => void = () => {}
  on('tool.call', async () => {
    await new Promise(r => (release = r))
    return { result: 'answered' }
  })
  await startSession($, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await clock.advance(100)
  expect(await band($)).toContain('Claude needs you')
  release(null)
  await pending
  await clock.advance(100)
  expect(await band($)).not.toContain('Claude needs you')
})

test('a stale turn.complete does not settle the current turn', async ($, on) => {
  const clock = host(on)
  await startSession($, clock)
  await $.turn.start({ text: 'first', turnId: 't1' } as never)
  await $.turn.start({ text: 'second', turnId: 't2' } as never)
  await $.turn.complete({ turnId: 't1', isAborted: false, answer: '', durationMs: 1 } as never)
  await clock.advance(100)
  expect(await band($)).toContain('waiting')
})

test('the queue recovers after a failed state write', async ($, on) => {
  const clock = host(on, { failStateSetOnce: true })
  await startSession($, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await clock.advance(200)
  expect(await band($)).toContain('waiting')
})

// V2 regression (draft-gate.ts). With default params and real species the
// fangtooth needs a night cast that has sunk past 120 s; this seed's first bite
// is that rare fish (found by replaying the core with the same session hash).
const NIGHT = Date.UTC(2026, 9, 8, 23, 0, 0)
const RARE_SEED = 'night-390'

async function hookedRare($: any, on: any) {
  const clock = host(on, { sessionId: RARE_SEED, now: NIGHT })
  on('tool.call', () => ({ result: 'ok' }))
  await startSession($, clock)
  await $.turn.start({ text: 'go', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  for (let i = 0; i < 300 && !(await band($)).includes('RARE bite'); i++) await clock.advance(1000)
  expect(await band($)).toContain('RARE bite')
  return clock
}

async function draft($: any, isDraft: boolean) {
  const hint = await $.ui.mount({
    plugin: 'reelquiet',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft, isWorking: true, hint: '' },
  })
  await hint.drawn()
}

test('V2: the reel hotkey digit never shows the draft hint', async ($, on) => {
  const clock = await hookedRare($, on)
  // The bare `1` sits in the prompt as a draft until the hotkey fires (~410 ms).
  await draft($, true)
  for (let t = 0; t < 400; t += 100) {
    await clock.advance(100)
    const text = await band($)
    expect(text).not.toContain('paused')
    expect(text).not.toContain('Send your draft')
  }
  const ui = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'reel' })
  await draft($, false)
  await clock.advance(200)
  expect(await band($)).toContain('caught')
})

test('V2: real typing during a rare bite still pauses it, after the settle', async ($, on) => {
  const clock = await hookedRare($, on)
  await draft($, true)
  await clock.advance(1000)
  const text = await band($)
  expect(text).toContain('paused')
  expect(text).toContain('Send your draft, then reel it in.')
})

test('V2: the settle hold does not spend the rare window', async ($, on) => {
  const clock = await hookedRare($, on)
  const before = (await band($)).match(/bite · 0:(\d\d)/)?.[1]
  await draft($, true)
  await clock.advance(400)
  await draft($, false)
  await clock.advance(100)
  const after = (await band($)).match(/bite · 0:(\d\d)/)?.[1]
  expect(after).toBe(before)
})

test('a rare caught right after red -> green carries the tests-green memory', async ($, on) => {
  const lines: string[] = []
  const clock = host(on, { sessionId: RARE_SEED, now: NIGHT, logs: lines })
  let green = false
  on('tool.call', (_$: unknown, e: { command?: string }) =>
    e.command === 'make test' && !green ? { result: 'Exit code 2', isError: true } : { result: 'ok' },
  )
  await startSession($, clock)
  await $.turn.start({ text: 'fix it', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'make test' })
  for (let i = 0; i < 300 && !(await band($)).includes('RARE bite'); i++) await clock.advance(1000)
  green = true
  await $.tool.call({ tool: 'Bash', command: 'make test' })
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await ui.press({ key: 'reel' })
  await clock.advance(200)
  expect(lines.join('\n')).toContain('caught as tests turned green')
})
