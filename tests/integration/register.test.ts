import { expect, test } from 'claude-code/testing'

test('fail-open: a tool result passes through unchanged', async ($, on) => {
  on('tool.call', () => ({ result: 'exact-tool-output' }))
  const r = await $.tool.call({ tool: 'Read', file_path: 'README.md' })
  expect(r.text ?? r.result).toBe('exact-tool-output')
})

test('fail-open: a Bash test failure result passes through unchanged', async ($, on) => {
  on('tool.call', () => ({ result: 'FAIL 3 tests', isError: true }))
  const r = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(r.isError).toBe(true)
})

test('/reelquiet log answers {} so nothing reaches Claude', async ($) => {
  const answer = await $.command.run({ command: 'reelquiet', args: 'log' })
  expect(answer.text).toBeUndefined()
})


function terminalHost(on: any) {
  let fakeNow = Date.UTC(2026, 9, 8, 12, 0, 0)
  on('clock.now', () => ({ value: (fakeNow += 50) }))
  on('clock.every', () => ({ value: { cancel() {} } }))
  on('clock.after', () => ({ value: { cancel() {} } }))
  on('store.keys', () => ({ value: [] }))
  on('store.set', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.repo', () => ({ value: { root: '/work/demo-repo', remote: null, internal: false } }))
  on('env.get', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('session.start', (_$: unknown, e: unknown) => e)
  on('command.register', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 10,
  bodyColumns: 75,
  scroll: { offset: 0, bodyRows: 9, totalRows: 3 },
} as never

function flatten(el: unknown): string {
  if (el === null || el === undefined) return ''
  if (typeof el === 'string') return el
  if (Array.isArray(el)) return el.map(flatten).join('')
  const node = el as { type?: string; props?: Record<string, unknown>; children?: unknown }
  const kids = node.children ?? node.props?.children
  if (node.type === 'Button') return `[${String(node.props?.label)}]`
  if (node.type === 'Box') return (Array.isArray(kids) ? kids : [kids]).map(flatten).join(node.props?.flexDirection === 'column' ? '\n' : '')
  return flatten(kids)
}

test('turn.start casts and the band shows waiting', async ($, on) => {
  terminalHost(on)
  await $.session.start({ cwd: '/work/demo-repo' } as never)
  await $.turn.start({ text: 'do something', turnId: 't1' } as never)
  const band = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  const drawn = await band.drawn()
  expect(flatten(drawn)).toContain('waiting')
})

test('AskUserQuestion freezes the band until the call settles (permission ask is covered live in G3)', async ($, on) => {
  terminalHost(on)
  let release: (v: unknown) => void = () => {}
  const gate = new Promise(r => { release = r })
  on('tool.call', async () => { await gate; return { result: 'done' } })
  await $.session.start({ cwd: '/work/demo-repo' } as never)
  await $.turn.start({ text: 'do something', turnId: 't1' } as never)
  const pending = $.tool.call({ tool: 'AskUserQuestion', questions: [] } as never)
  await new Promise(r => setTimeout(r, 20))
  const frozen = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(flatten(await frozen.drawn())).toContain('Claude needs you')
  release(null)
  await pending
  const after = await $.ui.mount({ plugin: 'reelquiet', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(flatten(await after.drawn())).not.toContain('Claude needs you')
})
