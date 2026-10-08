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

test('public card date follows the local day', () => {
  expect(toPublicCard(record).date).toBe('2026-10-08')
  expect(toPublicCard({ ...record, timestamp: Date.UTC(2026, 9, 8, 20, 0) }, 480).date).toBe('2026-10-09')
  expect(catchCardLines({ ...record, timestamp: Date.UTC(2026, 9, 8, 20, 0) }, null, 480)[2]).toContain('2026-10-09')
})

test('memory line shows local time and drops repo before the host wraps it', () => {
  expect(memoryLine(record, 0, 480).startsWith('10-08 21:13')).toBe(true)
  const narrow = memoryLine(record, 65, 480)
  expect(narrow.length).toBeLessThanOrEqual(65)
  expect(narrow).toContain('RARE')
  expect(narrow).toContain('caught')
})
