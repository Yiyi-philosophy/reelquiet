# ReelQuiet dogfood, week 1

**Window:** 2026-10-09 to 2026-10-15 (7 days). **Then:** `/plan-ceo-review`,
using this data. Stage 1 scope is frozen for the week: no new features. Only
fix a defect if it blocks normal use, and record it below if you do.

## Setup

Use the real build with default parameters, always from the same path, so that
every session writes to the same store file:

```bash
claude --plugin-dir /path/to/reelquiet
```

- Do **not** use the demo or smoke copies (`/tmp/reelquiet-demo`, `/tmp/rq-smoke`).
  They use accelerated encounter settings.
- Do **not** run `docs/demo/record-demo.sh` while a dogfood session is open. It
  moves the ReelQuiet store aside while it records. A session writing during that
  time would lose its catches.
- Optional, for TODOS DF-1 (piped test commands): add
  `--debug-file ~/reelquiet-dogfood-debug.log`. ReelQuiet's debug lines record
  whether a test run came back red or green. They never include the command text.

## The five questions

| # | Question | Source | What to look at |
|---|---|---|---|
| 1 | How often do rare fish turn up? | `bun scripts/dogfood-report.ts --since 2026-10-09` | rare encounters per day vs. the D9 target of about 0–2/day; days with none |
| 2 | Does it get in the way of coding? | Daily log | moments the band pulled your attention at a bad time; whether a bite while you were mid-thought felt like a nudge or a nag |
| 3 | How does active reeling feel? | Report + daily log | % reeled in vs. missed (sighted); in the log, whether you noticed the bite in time and whether `1` and "send your draft first" felt natural |
| 4 | Do you open Recent memories? | Daily log only | each time you ran `/reelquiet log`, and why. The plugin does not count this: adding a counter would be a Stage 1 change. |
| 5 | Does work memory have lasting value? | Report + daily log | which events catches remember (tests-green / edit / tool-call / task-finished); in the log, whether a card or memory brought back what you were working on, and whether you would miss it |

The report reads only the plugin's own store (the D12 allowlist records and
the D9 encounter counters). It prints counts, not repo or file names, and it
writes nothing. Data from before 2026-10-09 is smoke-test data; `--since`
leaves it out.

## Daily log

One entry per day of real use. A minute or two at the end of the day is
enough. A blank answer is fine; "didn't notice it" is data.

```markdown
### 2026-10-0X
- Hours with Claude Code: ~
- Rare bites noticed / reeled / missed: / /
- (2) Got in the way? When, and what was I doing:
- (3) Reeling: in time? `1` ok? draft pause ok?
- (4) Opened /reelquiet log? Why:
- (5) A memory that meant something (or felt empty):
- Anything that felt wrong, broke, or that I wanted and it didn't do:
```

## Log

<!-- Entries go below, newest last. -->

## End-of-week summary (fill in on 2026-10-15)

- Report output (paste):
- Q1 frequency:
- Q2 interruption:
- Q3 active reel:
- Q4 Recent memories:
- Q5 work memory value:
- Defects found (and whether fixed during the week):
- Inputs for OQ10 (probabilities, windows, daily budget, `postSubmitGraceMs`):
- Questions for the CEO review:
