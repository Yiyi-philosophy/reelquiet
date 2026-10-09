// ReelQuiet dogfood report: a developer script, not part of the plugin.
//
//   bun scripts/dogfood-report.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--store FILE]
//
// Reads the plugin's own store file(s) (~/.claude/plugins/store/reelquiet_*.json)
// and prints counts per local day. It reads only what the plugin already writes
// (the D12 allowlist records and the D9 encounter counters) and prints no repo or
// file names. Nothing is written anywhere.
//
// What it can and cannot tell (docs/dogfood/README.md):
//   - rare encounters, catches, sightings and the event each catch remembers: yes
//   - interruption, the feel of reeling, whether Recent memories was opened, and
//     long-term value: no; those go in the daily log by hand.

import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Rec = {
  species?: string
  rarity?: string
  outcome?: string
  timestamp?: number
  event_type?: string
  local_date?: string
}

const args = process.argv.slice(2)
const opt = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const since = opt('--since') ?? '0000-00-00'
const until = opt('--until') ?? '9999-99-99'

const storeDir = join(homedir(), '.claude', 'plugins', 'store')
const files = opt('--store')
  ? [opt('--store') as string]
  : readdirSync(storeDir)
      .filter((f) => /^reelquiet_.*\.json$/.test(f))
      .map((f) => join(storeDir, f))

const entries: Array<[string, Rec]> = []
for (const f of files) {
  const data = JSON.parse(readFileSync(f, 'utf8')) as Record<string, Rec>
  for (const [k, v] of Object.entries(data)) entries.push([k, v])
}

// Encounter keys carry a UTC date; records carry the local capture date.
const localDate = (r: Rec) =>
  r.local_date ?? (typeof r.timestamp === 'number' ? localDay(r.timestamp) : 'unknown')
function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type Day = {
  encounters: number
  caught: Record<string, number>
  rareCaught: number
  rareSighted: number
  events: Record<string, number>
  sessions: Set<string>
}
const days = new Map<string, Day>()
const day = (d: string) => {
  let x = days.get(d)
  if (!x) {
    x = { encounters: 0, caught: {}, rareCaught: 0, rareSighted: 0, events: {}, sessions: new Set() }
    days.set(d, x)
  }
  return x
}

for (const [key, r] of entries) {
  const kind = key.slice(0, 5)
  if (kind !== 'v1:c:' && kind !== 'v1:s:' && kind !== 'v1:e:') continue
  const d = kind === 'v1:e:' ? localDay(r.timestamp ?? 0) : localDate(r)
  if (d < since || d > until) continue
  const x = day(d)
  const session = kind === 'v1:e:' ? key.split(':')[3] : key.split(':')[2]
  x.sessions.add(session)
  if (kind === 'v1:e:') {
    x.encounters += 1
    continue
  }
  const rare = r.rarity === 'rare' || r.rarity === 'legendary'
  if (r.outcome === 'caught') x.caught[r.rarity ?? '?'] = (x.caught[r.rarity ?? '?'] ?? 0) + 1
  if (rare && r.outcome === 'caught') x.rareCaught += 1
  if (rare && r.outcome === 'sighted') x.rareSighted += 1
  if (rare) x.events[r.event_type ?? 'unknown'] = (x.events[r.event_type ?? 'unknown'] ?? 0) + 1
}

const sorted = [...days.keys()].sort()
console.log(`ReelQuiet dogfood report  ${since} .. ${until}  (${files.length} store file${files.length === 1 ? '' : 's'})`)
console.log('')
console.log('date        sessions  rare enc  rare caught  rare sighted  catches (common/uncommon)')
let tEnc = 0, tCaught = 0, tSighted = 0
const tEvents: Record<string, number> = {}
for (const d of sorted) {
  const x = days.get(d) as Day
  tEnc += x.encounters
  tCaught += x.rareCaught
  tSighted += x.rareSighted
  for (const [k, v] of Object.entries(x.events)) tEvents[k] = (tEvents[k] ?? 0) + v
  console.log(
    `${d}  ${String(x.sessions.size).padStart(8)}  ${String(x.encounters).padStart(8)}  ${String(x.rareCaught).padStart(11)}  ${String(x.rareSighted).padStart(12)}  ${x.caught.common ?? 0}/${x.caught.uncommon ?? 0}`,
  )
}
const n = sorted.length || 1
console.log('')
console.log(`rare encounters: ${tEnc} over ${sorted.length} day(s), ${(tEnc / n).toFixed(1)}/day (D9 target: about 0-2/day)`)
const settled = tCaught + tSighted
console.log(`active reel: ${tCaught} caught, ${tSighted} missed (sighted)${settled ? `, ${Math.round((100 * tCaught) / settled)}% reeled in` : ''}`)
if (tEnc > settled) console.log(`unsettled: ${tEnc - settled} rare encounter(s) never settled (a restart mid-bite, TODOS G3-R1, or still open)`)
console.log(`work memory on rare catches/sightings: ${Object.entries(tEvents).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}`)
