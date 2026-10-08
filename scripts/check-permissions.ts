// G2 permission gate: fails if the hooks module calls anything outside the
// approved Stage 1 surface (docs/designs/claude-fish-v0.1.md, 权限清单 + D7 + V-COLOR),
// or if src/** touches $ at all (D4: hooks/register.ts is the only capability boundary).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ALLOWED_NAMESPACES = new Set(['ui', 'state', 'store', 'clock', 'session', 'command'])
const ALLOWED_ENV = new Set(['NO_COLOR'])

const failures: string[] = []

const proc = Bun.spawnSync(['claude', 'plugin', 'validate', '.', '--json'])
const report = JSON.parse(proc.stdout.toString())
if (!report.success) failures.push('claude plugin validate failed')

for (const item of report.contents ?? []) {
  for (const err of item.errors ?? []) failures.push(`validate error in ${item.file}: ${JSON.stringify(err)}`)
  for (const note of item.notes ?? []) {
    const calls = /calls: (.*)$/.exec(note)
    if (calls && calls[1] !== 'nothing on $') {
      for (const raw of calls[1].split(',')) {
        const call = raw.trim().replace(/ \(via .*\)$/, '')
        const m = /^\$\.(\w+)\.(\w+)$/.exec(call)
        if (!m) { failures.push(`unparsed call: ${call}`); continue }
        const [, ns, method] = m
        if (ns === 'env') {
          if (method !== 'get') failures.push(`env.${method} is not approved`)
          continue
        }
        if (!ALLOWED_NAMESPACES.has(ns)) failures.push(`$.${ns}.${method} is outside the approved permission surface`)
      }
    }
    const envReads = /env reads: (.*)$/.exec(note)
    if (envReads) {
      for (const name of envReads[1].split(',').map(s => s.trim()).filter(s => s !== 'nothing')) {
        if (!ALLOWED_ENV.has(name)) failures.push(`env read of ${name} is not approved (only NO_COLOR)`)
      }
    }
    if (/env writes: (?!nothing)/.test(note)) failures.push(`env writes are not approved: ${note}`)
  }
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
for (const file of walk('src').filter(f => /\.(ts|tsx)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  if (/\$\./.test(text)) failures.push(`${file} references $ (only hooks/register.ts may)`)
  if (/\b(setTimeout|setInterval|Date\.now|Math\.random)\b|new Date\(/.test(text)) failures.push(`${file} uses a nondeterministic or timer global`)
}

if (failures.length) {
  console.error('Permission gate FAILED:\n' + failures.map(f => '  - ' + f).join('\n'))
  process.exit(1)
}
console.log('Permission gate passed')
