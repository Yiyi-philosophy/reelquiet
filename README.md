# ReelQuiet

**Claude codes. You fish.**

A quiet fishing pond that lives above your Claude Code prompt while Claude works.

Submit a task and a line goes in. While Claude reads, thinks and runs tools, the pond runs. Common fish reel themselves in. Once in a while a rare one bites, and you can press `1` to bring it in. If Claude needs you, for a permission prompt or a question, the pond pauses. Every fish is a real species, and every catch remembers what you were working on.

Not an official Anthropic product.

> Status: Stage 1 preview. Terminal only. Tested with Claude Code 2.1.292.

> Demo: a recording is in review under [`docs/demo/`](docs/demo/). It uses accelerated encounter settings (a rare bite within seconds, every time). Normal play is slower, and rare fish are deliberately scarce.

## Try it

```bash
claude --plugin-dir /path/to/reelquiet
```

Requires Claude Code 2.1.287 or later.

- `1` reels in a rare bite, typed alone in an empty prompt. If you are mid-draft, send it first: the bite waits for you.
- `/reelquiet log` shows your recent memories. Only you see it; Claude does not.

## What it can access

ReelQuiet keeps a small permission surface. `claude plugin validate` lists every call, and CI fails on anything outside this table.

| Access | Why |
|---|---|
| Its own plugin store | Your catches and sightings |
| Session id, repo name, surfaces | Labels catches, and turns itself off outside the terminal |
| The `NO_COLOR` environment variable, and only that one | Drops colors from the pond when you ask for no color |
| Draws above the prompt, writes dim transcript lines | The pond, rare catch cards and Recent memories. Claude does not read them. |

It never reads or writes your files, makes network requests, starts processes or calls a model. It adds no tokens to your usage.

## Where it runs

| Host | Behavior |
|---|---|
| Terminal `claude` | Full |
| Desktop app, VS Code chat panel, `claude -p`, cloud sessions | Turns itself off and stays silent |

## Limitations

- **A bite in progress does not survive a restart.** If you quit Claude Code, or resume with `--continue`, while a rare fish is on the line, that encounter is lost. Settled catches and sightings are always kept.
- Rare encounters are deliberately scarce: roughly 0 to 2 a day of normal work.
- The species list is small in this preview.
- With `NO_COLOR` set, the pond still shows all the same information, without colors.
