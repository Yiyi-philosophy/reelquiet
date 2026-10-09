# ReelQuiet demo recording

A repeatable recording of one real ReelQuiet session, for the README GIF.
**Status: draft v2, in review.** The main README does not embed it yet.

```
docs/demo/
  record-demo.sh        records the session (tmux + asciinema) and renders the GIF (agg)
  postprocess.py        masks the banner model line, cuts the detach screen
  check-transcript.py   replays the cast; tells TUI repaints from repeated writes
  draft/
    reelquiet-demo.cast   published asciinema cast (88x28)
    reelquiet-demo.gif    rendered GIF (~11 s)
```

## What the clip shows

Real Claude Code, the real plugin and real UI, in a throwaway repo with a real bug:

| ~Time | What happens |
|---|---|
| 0–1 s | The prompt "Run make test, fix the failing test, then run make test again." is typed and sent. |
| 1 s | The pond casts on its own: `waiting · 0:00`. |
| 1–4 s | Claude runs `make test`. It fails for real (`feet_to_meters` divides where it should multiply). |
| 4 s | A rare fish bites: `! RARE bite · 0:11 · 1: reel in`. |
| 4–7.5 s | Claude reads the code, edits `depth.py`, and runs `make test` again. It passes. |
| 7.5 s | `1` is pressed. |
| 8 s | The catch card lands in the transcript as three dim rows. Its third row reads `caught as tests turned green`. |
| 8.5 s | Claude reports the fix and the turn finishes. The last frame holds for 2.5 s. |

The card's "tests turned green" is real work memory. ReelQuiet saw the same
`make test` come back red and then green, and the catch happened before anything
else did. Nothing on screen is written or edited by the recorder.

## The demo is accelerated

Normal play is slower and rarer on purpose. `record-demo.sh` copies the plugin
to `$DEMO/plugin` and changes **only that copy's** `src/core/params.ts`:

| Parameter | Default | Demo copy |
|---|---|---|
| bite delay | 6–40 s | 3 s |
| rare encounter chance | 0.15 | 1 |
| daily rare budget | 2 | 99 |
| tier weights (common / uncommon / legendary) | 1 / 0.45 / 0.03 | 0 / 0 / 0 |
| depth at cast | epipelagic | bathypelagic |
| night hours | 19:00–06:00 | all day |

The game rules, the rare window (12 s), the render code and the hooks are not
changed. The script stops if `params.ts` no longer contains the defaults it
expects, so the demo cannot silently drift from the real values. Any README that
embeds the GIF must say that it is accelerated.

## How the recorder drives it

Everything Claude does is its own: one model call chain with `Bash(make test)`,
`Read` and `Edit` allowed. The recorder only types the prompt and presses `1`,
the way a person watching the tests would:

- It waits until the rare bite is on screen, and at least 2.2 s after that.
- It waits until the working tree changed (the fix) and the test run after it
  finished. It sees this from outside, through `git diff` and `ps`. The demo repo
  knows nothing about the recorder.
- If the rare window is nearly over first, it reels anyway.

The demo repo has a `CLAUDE.md` saying to run exactly `make test`. Agents often
pipe test output through `tail`. That hides the exit code, so the red run would
not look red. This is logged as TODOS DF-1 for dogfood.

Each run differs in the model's wording, the spinner verb and the fish size. A
take can also come out differently: the card says `caught as the task finished`
if the turn ends before the reel lands. Check the third card row before
accepting a take.

## Privacy

- **Demo repo.** `$DEMO/pond-demo` is a fresh git repo with `depth.py`,
  `test_depth.py`, a `Makefile`, `CLAUDE.md` and `README.md`. No user code, no
  remotes.
- **Plugin store.** The developer's ReelQuiet store file
  (`~/.claude/plugins/store/reelquiet_inline-*.json`) is moved aside before
  recording and put back on exit, including on failure (`trap`). The demo
  starts with an empty pond and never touches real catches.
- **Banner.** Claude Code's startup banner prints the model ID and billing
  mode, and no setting hides them. (`ANTHROPIC_DEFAULT_*_MODEL_NAME` does not
  change the banner.) `postprocess.py` replaces that one line with
  `(model hidden) with high effort`, padded to the same width. The script fails
  if any 5-character piece of the model ID, or the billing text, survives.
- **Nothing else is edited.** The only other change is cutting tmux's
  `[detached]` screen. The GIF is rendered from a copy that draws U+00A0 as a
  space, because agg's font fallback draws it as a stray glyph. The published
  `.cast` keeps the original bytes.
- **The raw cast never enters git.** It stays in `$DEMO` (default
  `/tmp/reelquiet-demo`).
- **Manual check after each run**, which should print nothing:

  ```sh
  grep -iE '<your model id>|billing|/home/' docs/demo/draft/reelquiet-demo.cast
  ```

## Transcript repaints vs. repeated writes

Claude Code redraws its transcript by diff. When the transcript scrolls, a
single intermediate frame can briefly show one row twice. To tell that apart
from the plugin writing a row twice, run:

```sh
python3 docs/demo/check-transcript.py docs/demo/draft/reelquiet-demo.cast \
  ~/.claude/projects/-tmp-reelquiet-demo-pond-demo/<session>.jsonl
```

The script needs `pip install pyte`. It replays the cast frame by frame and
reports any frame where a card row appears twice. It also counts the
`reelquiet:` rows the plugin actually wrote, from the session's own transcript.

- **v1** (88x24): one 38 ms frame at ~10 s showed the third card row twice. The
  plugin wrote exactly 3 rows, so this was a TUI scroll repaint, not a plugin
  bug.
- **v2** (88x28): no frame shows a card row twice; the plugin wrote 3 rows.

## Run it

Requirements:

- `claude` 2.1.287 or newer, `tmux`, `python3`, `bc`, `pgrep`, `ffmpeg`
  (optional, for frames)
- `asciinema` 2.x, e.g. `uv tool install asciinema`
- `agg` 1.9+ at `~/.local/bin/agg`. On older glibc, use the musl release build.

```sh
docs/demo/record-demo.sh
```

Each run takes about 40 s and makes one real model run (`--model haiku`). It
writes `docs/demo/draft/reelquiet-demo.cast` and `.gif`.

- `DEMO_DEBUG=1` also writes Claude Code's debug log to `$DEMO/debug.log`. The
  log never appears on screen.
- ReelQuiet's debug lines record red and green test runs as outcomes only,
  never command text.

To re-render without recording again:

```sh
python3 docs/demo/postprocess.py /tmp/reelquiet-demo/reelquiet-demo.raw.cast \
  docs/demo/draft/reelquiet-demo.cast /tmp/reelquiet-demo/render.cast
~/.local/bin/agg --font-family "DejaVu Sans Mono" --font-size 16 --theme asciinema \
  --idle-time-limit 1.2 --last-frame-duration 2.5 \
  /tmp/reelquiet-demo/render.cast docs/demo/draft/reelquiet-demo.gif
```

### Terminal setup

- Size: 88x28.
- tmux runs with the status bar off and a fixed window size.
- Claude Code runs with spinner tips and prompt suggestions turned off.
- Nothing debug-level is shown on screen.
