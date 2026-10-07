import type { Register } from 'claude-code'

const LOG = '/tmp/rq-probe/log.jsonl'
let lines: string[] = []
let bandRequestId = ''
let frame = 0

function cells(n: number): string {
  const nums: number[] = []
  for (let i = 0; i < 8; i++) nums.push((i === n % 8 ? '>' : '~').codePointAt(0)!, 0x4fc3f7, 0x01000000)
  const bytes = new Uint8Array(Uint32Array.from(nums).buffer)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

async function log($: any, ev: string, data: Record<string, unknown> = {}) {
  lines.push(JSON.stringify({ t: await $.clock.now(), ev, ...data }))
  await $.fs.write(LOG, lines.join('\n') + '\n')
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    await log($, 'session.start', { surfaces: await $.session.surfaces() })
    await $.command.register({ name: 'probe-keys', description: 'measure store.keys latency', immediate: true })
    $.clock.every(100, async () => {
      if (!bandRequestId) return
      frame++
      const r = await $.ui.blit({ requestId: bandRequestId, key: 'wave', cells: cells(frame) })
      if (frame % 20 === 1) await log($, 'blit', { frame, deny: r.deny ?? null })
    })
    return next(e)
  })

  on('command.run', { command: 'probe-keys' }, async ($) => {
    const N = 5000
    const pad = 'x'.repeat(250)
    let t0 = await $.clock.now()
    for (let i = 0; i < N; i++) await $.store.set('v1:c:probe:' + i, { schema_version: 1, i, pad })
    const tWrite = (await $.clock.now()) - t0
    t0 = await $.clock.now()
    const ks = await $.store.keys()
    const tKeys = (await $.clock.now()) - t0
    t0 = await $.clock.now()
    const today = ks.filter((k: string) => k.startsWith('v1:c:probe:1'))
    const tFilter = (await $.clock.now()) - t0
    await log($, 'keys', { N, count: ks.length, tWrite, tKeys, tFilter, prefixHits: today.length })
    for (const k of ks) if (k.startsWith('v1:c:probe:')) await $.store.delete(k)
    await log($, 'keys.cleaned', {})
    return {}
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await log($, 'PromptHint', { isDraft: e.props.isDraft, isWorking: e.props.isWorking })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    bandRequestId = e.requestId
    const { Box, Button, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={2}>
        <Raster key="wave" columns={8} rows={1} cells={cells(frame)} />
        <Button key="reel" hotkey="1" plain onPress={() => log($, 'press.digit')}>reel</Button>
        <Button key="chord" label="chord" action="app:toggleDiffNoiseFilter" onPress={() => log($, 'press.chord')} />
      </Box>
    )
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    await log($, 'tool.check', { tool: e.tool, id: e.tool_use_id, agentId: e.agentId ?? null, decision: r.decision })
    return r
  })

  on('tool.call', async ($, e, next) => {
    await log($, 'tool.call.enter', { tool: e.tool, id: e.tool_use_id })
    try {
      return await next(e)
    } finally {
      await log($, 'tool.call.settle', { tool: e.tool, id: e.tool_use_id })
    }
  })

  on('classic.Notification', async ($, e, next) => {
    await log($, 'notification', { type: (e as any).notification_type ?? null })
    return next(e)
  })

  on('turn.start', async ($, e, next) => { await log($, 'turn.start'); return next(e) })
  on('turn.complete', async ($, e, next) => { await log($, 'turn.complete', { aborted: e.isAborted }); return next(e) })
}
