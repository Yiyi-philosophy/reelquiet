import { expect, test } from 'claude-code/testing'

import { toPublicCard, type CatchRecord } from '../../src/core/records.ts'
import { catchCardLines } from '../../src/render/card.ts'
import { memoryLine } from '../../src/render/memories.ts'
import { hourMinuteText, monthDayText } from '../../src/render/model.ts'

// G3 regression: Recent memories and the card date showed UTC instead of the viewer's local time.
const AT = Date.UTC(2026, 9, 8, 13, 13) // 13:13 UTC = 21:13 at UTC+8
const record: CatchRecord = {
  schema_version: 1,
  species: 'common-fangtooth',
  size_cm: 13.7,
  rarity: 'rare',
  outcome: 'caught',
  timestamp: AT,
  event_type: 'turn-complete',
  repo: 'claude-fish',
  files: [],
}

test('time text uses the injected offset', () => {
  expect(hourMinuteText(AT)).toBe('13:13')
  expect(hourMinuteText(AT, 480)).toBe('21:13')
  expect(monthDayText(Date.UTC(2026, 9, 8, 20, 0), 480)).toBe('10-09')
})

test('public card date is the capture-time local_date; legacy records fall back to UTC', () => {
  expect(toPublicCard(record).date).toBe('2026-10-08')
  expect(toPublicCard({ ...record, local_date: '2026-10-09' }).date).toBe('2026-10-09')
  expect(catchCardLines({ ...record, local_date: '2026-10-09' }, null)[2]).toContain('2026-10-09')
})

test('memory line shows local time and drops repo before the host wraps it', () => {
  expect(memoryLine({ ...record, local_date: '2026-10-08' }, 0, 480).startsWith('10-08 21:13')).toBe(true)
  const narrow = memoryLine(record, 65, 480)
  expect(narrow.length).toBeLessThanOrEqual(65)
  expect(narrow).toContain('RARE')
  expect(narrow).toContain('caught')
})

// UTC day boundary: local_date is fixed when the fish settles, from the offset at that moment.
import { step, createPondState } from '../../src/core/pond.ts'
import { withParams } from '../../src/core/params.ts'

function settleAt(now: number, offsetMinutes: number) {
  const species = [{
    id: 'test-common', common_name: 'Test common', scientific_name: 'Testus commonus',
    size_cm: { min: 10, typical: 20, max: 30 }, depth_zone: 'epipelagic', activity: 'diurnal',
    rarity: 'common', source_refs: ['Written summary: synthetic fixture.'],
  }] as never
  const params = withParams({ biteDelayMinMs: 100, biteDelayMaxMs: 100, rareEncounterChance: 0 })
  let s = createPondState(3)
  const ctx = (t: number) => ({ now: t, species, params, hourOfDay: 12, sessionId: 's', offsetMinutes })
  s = step(s, { type: 'cast' }, ctx(now - 1000)).state
  s = step(s, { type: 'activity', kind: 'tool-call' }, ctx(now - 900)).state
  for (let t = now - 800; t <= now; t += 100) {
    const r = step(s, { type: 'tick' }, ctx(t))
    s = r.state
    const rec = r.effects.find(e => e.type === 'record') as { record: CatchRecord } | undefined
    if (rec) return rec.record
  }
  return null
}

test('UTC boundary, east of UTC: 20:00 UTC at +08:00 is the next local day', () => {
  const rec = settleAt(Date.UTC(2026, 9, 8, 20, 0), 480)
  expect(rec?.local_date).toBe('2026-10-09')
  expect(toPublicCard(rec as CatchRecord).date).toBe('2026-10-09')
  expect(memoryLine(rec as CatchRecord, 0, 480).startsWith('10-09')).toBe(true)
})

test('UTC boundary, west of UTC: 02:00 UTC at -05:00 is the previous local day', () => {
  const rec = settleAt(Date.UTC(2026, 9, 9, 2, 0), -300)
  expect(rec?.local_date).toBe('2026-10-08')
  expect(toPublicCard(rec as CatchRecord).date).toBe('2026-10-08')
  expect(memoryLine(rec as CatchRecord, 0, -300).startsWith('10-08')).toBe(true)
})

test('a later timezone change does not move a stored local_date', () => {
  const rec = settleAt(Date.UTC(2026, 9, 8, 20, 0), 480) as CatchRecord
  expect(toPublicCard(rec).date).toBe('2026-10-09')
  expect(memoryLine(rec, 0, -300).startsWith('10-09')).toBe(true)
})
