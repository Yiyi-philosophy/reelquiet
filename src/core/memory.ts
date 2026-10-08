// ReelQuiet — zero-token work-memory text.
//
// D7: "工作记忆的文案只使用事件里已有的信息：修改过的文件名、测试由红转绿、
// 时间、仓库名." Nothing here calls a model, and nothing here accepts free text:
// every phrase is picked from a controlled enum (D12).

import type { CatchRecord } from './records.ts'
import type { ControlledEventType } from './types.ts'

/** Local phrasing — may name the repo and file basenames the record already holds. */
const LOCAL_EVENT_PHRASE: Record<ControlledEventType, string> = {
  'tests-green': 'while the tests turned green',
  edit: 'while editing code',
  'tool-call': 'while running a tool',
  'turn-complete': 'as the task wrapped up',
  'turn-start': 'as a new task began',
  'session-reset': 'as the session reset',
  unknown: 'while Claude was working',
}

/**
 * Public phrasing for `toPublicCard` — generalized on purpose.
 *
 * D12: the shareable card carries a "通用事件描述" and never repo, file, path,
 * command or prompt content.
 */
const PUBLIC_EVENT_PHRASE: Record<ControlledEventType, string> = {
  // Exact copy from the Stage 1 Visual Spec's F-CARD-RARE fixture
  // ("caught as tests turned green · 2026-10-08").
  'tests-green': 'caught as tests turned green',
  edit: 'caught mid-edit',
  'tool-call': 'caught during a tool run',
  'turn-complete': 'caught as the task finished',
  'turn-start': 'caught as a task began',
  'session-reset': 'caught as the session restarted',
  unknown: 'caught while the agent worked',
}

/**
 * D14 empty-state line for "Recent memories".
 *
 * Exact copy from the Stage 1 Visual Spec's F-MEM-EMPTY fixture. The earlier
 * draft ("No memories yet — cast off by giving Claude something to do.")
 * promised a catch and used an em dash; V-MEM asks for 温和、准确 instead, and
 * the Visual Spec is the later, approved section.
 */
export const EMPTY_MEMORIES_LINE =
  'Nothing here yet. Catches and rare sightings will appear here gradually as Claude works.'

export function localEventPhrase(eventType: ControlledEventType): string {
  return LOCAL_EVENT_PHRASE[eventType] ?? LOCAL_EVENT_PHRASE.unknown
}

export function publicEventPhrase(eventType: ControlledEventType): string {
  return PUBLIC_EVENT_PHRASE[eventType] ?? PUBLIC_EVENT_PHRASE.unknown
}

/**
 * One line of local work memory, built only from the D12 allowlist.
 *
 * Example: `rare · 17.4 cm · sighted · while the tests turned green · reelquiet · pond.ts`
 */
export function localMemoryLine(record: CatchRecord): string {
  const parts: string[] = [
    record.species,
    `${record.size_cm} cm`,
    record.rarity,
    record.outcome,
    localEventPhrase(record.event_type),
  ]
  if (record.repo) parts.push(record.repo)
  if (record.files.length > 0) parts.push(record.files.join(', '))
  return parts.join(' · ')
}
