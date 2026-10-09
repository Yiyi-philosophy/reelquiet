#!/usr/bin/env bash
# ReelQuiet demo recorder (draft GIF for the README).
#
# Records a real ReelQuiet session with tmux + asciinema, then renders a GIF with agg.
# Nothing in the repository is modified. The demo runs against an isolated copy:
#   - demo repo:    $DEMO/pond-demo        (throwaway git repo with a fake test.sh)
#   - plugin copy:  $DEMO/plugin           (this repo, with DEMO-ONLY pacing in params.ts)
#   - plugin store: the dev inline store is moved aside and restored afterwards
#
# Demo-only pacing (applied to the copy, never to the repo): the first bite comes
# after 3 s, every encounter is a rare common fangtooth, and the daily budget is
# lifted. This makes the rare moment reproducible in a 15-20 s clip. The README
# must say the demo is accelerated.
#
# Privacy: Claude Code's startup banner prints the model ID and billing mode,
# and no setting hides it. postprocess.py masks exactly that line with a
# same-width label, cuts tmux's detach screen, and fails if any piece of the
# model ID survives. ReelQuiet output is never edited.
#
# Requires: claude (>= 2.1.287), tmux, asciinema 2.x, agg 1.9+, python3.
# Re-render only: python3 docs/demo/postprocess.py RAW OUT RENDER, then agg.
# Usage:    docs/demo/record-demo.sh            (writes docs/demo/draft/)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO/docs/demo/draft"
DEMO="${DEMO:-/tmp/reelquiet-demo}"
COLS=88
ROWS=28
STORE_DIR="$HOME/.claude/plugins/store"
# DEMO_DEBUG=1 writes Claude Code's debug log to $DEMO/debug.log (never on screen).
DEBUG_FLAG=""
[ -n "${DEMO_DEBUG:-}" ] && DEBUG_FLAG="--debug-file $DEMO/debug.log"
PROMPT='Run make test, fix the failing test, then run make test again.'

mkdir -p "$OUT"
rm -rf "$DEMO"
mkdir -p "$DEMO/pond-demo" "$DEMO/plugin" "$DEMO/store-backup"

# --- demo repo -------------------------------------------------------------
# A real bug and a real test suite: feet_to_meters divides where it should
# multiply. Claude has to see the red run, fix it, and see the green run; that
# red -> green on the same command is what ReelQuiet records as "tests turned
# green". Nothing here knows about the recorder.
cat > "$DEMO/pond-demo/depth.py" <<'EOF'
"""Depth conversions for the tide table."""

FOOT = 0.3048
FATHOM = 1.8288


def feet_to_meters(feet):
    return round(feet / FOOT, 3)


def fathoms_to_meters(fathoms):
    return round(fathoms * FATHOM, 3)


def meters_to_fathoms(meters):
    return round(meters / FATHOM, 3)
EOF
cat > "$DEMO/pond-demo/test_depth.py" <<'EOF'
import sys
import time

from depth import fathoms_to_meters, feet_to_meters, meters_to_fathoms

CASES = [
    ("feet_to_meters", lambda: feet_to_meters(10), 3.048),
    ("fathoms_to_meters", lambda: fathoms_to_meters(2), 3.658),
    ("meters_to_fathoms", lambda: meters_to_fathoms(3.658), 2.0),
]

failed = 0
for name, run, want in CASES:
    time.sleep(0.4)
    got = run()
    if got == want:
        print(f"{name:<20} ok")
    else:
        failed += 1
        print(f"{name:<20} FAIL  expected {want}, got {got}")
print(f"{len(CASES) - failed} passed, {failed} failed" if failed else f"{len(CASES)} passed")
sys.exit(1 if failed else 0)
EOF
printf 'test:\n\t@python3 test_depth.py\n' > "$DEMO/pond-demo/Makefile"
# The repo's own convention, as a real project would state it. Agents often pipe
# test output through `tail`, which hides the exit code; this keeps the red run red.
cat > "$DEMO/pond-demo/CLAUDE.md" <<'EOF'
# pond-demo

- Run the tests with exactly `make test`. Do not pipe or redirect it.
- The code is `depth.py`; its tests are `test_depth.py`.
EOF
echo "# pond-demo" > "$DEMO/pond-demo/README.md"
printf '__pycache__/\n' > "$DEMO/pond-demo/.gitignore"
git -C "$DEMO/pond-demo" init -q
git -C "$DEMO/pond-demo" add -A
git -C "$DEMO/pond-demo" -c user.name=demo -c user.email=demo@example.invalid commit -qm init

# --- plugin copy with demo-only pacing -------------------------------------
cp -r "$REPO"/{.claude-plugin,hooks,src,types} "$DEMO/plugin/"
python3 - "$DEMO/plugin/src/core/params.ts" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
demo = {
    "biteDelayMinMs: 6000": "biteDelayMinMs: 3000",
    "biteDelayMaxMs: 40000": "biteDelayMaxMs: 3000",
    "rareEncounterChance: 0.15": "rareEncounterChance: 1",
    "dailyRareBudget: 2": "dailyRareBudget: 99",
    "common: 1,": "common: 0,",
    "uncommon: 0.45": "uncommon: 0",
    "legendary: 0.03": "legendary: 0",
    "{ afterMs: 0, zone: 'epipelagic' }": "{ afterMs: 0, zone: 'bathypelagic' }",
    "nightStartHour: 19": "nightStartHour: 0",
    "nightEndHour: 6": "nightEndHour: 24",
}
for a, b in demo.items():
    assert a in s, f"params.ts changed; update the demo pacing: {a}"
    s = s.replace(a, b)
open(p, "w").write(s)
EOF

cat > "$DEMO/demo-settings.json" <<'EOF'
{
  "spinnerTipsEnabled": false,
  "promptSuggestionEnabled": false
}
EOF

# --- isolate the plugin store ---------------------------------------------
shopt -s nullglob
for f in "$STORE_DIR"/reelquiet_inline-*.json; do mv "$f" "$DEMO/store-backup/"; done
restore() {
  tmux kill-session -t rqrec 2>/dev/null || true
  tmux kill-session -t rqdemo 2>/dev/null || true
  rm -f "$STORE_DIR"/reelquiet_inline-*.json
  for f in "$DEMO"/store-backup/*.json; do mv "$f" "$STORE_DIR/"; done
}
trap restore EXIT

# --- start Claude in a detached tmux session --------------------------------
tmux kill-session -t rqdemo 2>/dev/null || true
tmux new-session -d -s rqdemo -x "$COLS" -y "$ROWS" -c "$DEMO/pond-demo" \
  "env -u TMUX -u TMUX_PANE TERM=xterm-256color claude --plugin-dir '$DEMO/plugin' --model haiku --settings '$DEMO/demo-settings.json' --allowedTools 'Bash(make test)' Read Edit $DEBUG_FLAG"
tmux set -t rqdemo status off
tmux set -t rqdemo window-size manual
tmux resize-window -t rqdemo -x "$COLS" -y "$ROWS"

# Accept the workspace trust prompt for the fresh demo folder, if shown.
for _ in $(seq 1 40); do
  sleep 0.5
  screen="$(tmux capture-pane -t rqdemo -p)"
  if grep -q "Yes, I trust this folder" <<<"$screen"; then
    tmux send-keys -t rqdemo Down; sleep 0.3; tmux send-keys -t rqdemo Enter
  fi
  if grep -q "auto mode on\|manual mode on\|for shortcuts" <<<"$screen" && ! grep -q "trust this folder" <<<"$screen"; then
    break
  fi
done
sleep 2

# --- record ---------------------------------------------------------------
RAW="$DEMO/reelquiet-demo.raw.cast"
tmux kill-session -t rqrec 2>/dev/null || true
tmux new-session -d -s rqrec -x "$COLS" -y "$ROWS" \
  "env -u TMUX ~/.local/bin/asciinema rec --overwrite -q -i 1.2 --cols $COLS --rows $ROWS -c 'env -u TMUX tmux attach -t rqdemo' '$RAW'"
tmux set -t rqrec status off
tmux set -t rqrec window-size manual
tmux resize-window -t rqrec -x "$COLS" -y "$ROWS"
sleep 0.3

for ((i = 0; i < ${#PROMPT}; i++)); do
  tmux send-keys -t rqdemo -l "${PROMPT:$i:1}"
  sleep 0.008
done
sleep 0.2
tmux send-keys -t rqdemo C-m

# Reel the way a person who is watching the tests would: once the rare fish is
# on the line, take it in (at least 2.2 s), wait for the fix (the working tree
# changes) and for the test run after it to finish, then press 1. This is observed from outside (git, ps);
# the demo repo and Claude know nothing about it. If the window is about to
# run out first, reel anyway rather than lose the fish.
bite_at=""
for _ in $(seq 1 200); do
  sleep 0.1
  tmux capture-pane -t rqdemo -p | grep -q "RARE bite" && { bite_at=$(date +%s.%N); break; }
done
[ -n "$bite_at" ] || { echo "no rare bite seen" >&2; exit 1; }
edited=0 ran=0
while :; do
  sleep 0.05
  elapsed=$(echo "$(date +%s.%N) - $bite_at" | bc)
  if (( $(echo "$elapsed > 10" | bc) )); then echo "reel: window nearly over, reeling" >&2; break; fi
  if [ $edited = 0 ]; then git -C "$DEMO/pond-demo" diff --quiet || edited=1; continue; fi
  if pgrep -f 'python3 test_depth.py' >/dev/null; then ran=1; continue; fi
  [ $ran = 1 ] && (( $(echo "$elapsed > 2.2" | bc) )) && break
done
tmux send-keys -t rqdemo 1

# Wait for the turn to finish, then hold briefly (agg holds the last frame).
for _ in $(seq 1 240); do
  sleep 0.25
  tmux capture-pane -t rqdemo -p | grep -qE "(for|·) [0-9]+s · done [0-9]{1,2}:[0-9]{2}|done [0-9]{1,2}:[0-9]{2}" && break
done
sleep 0.6
tmux detach-client -s rqdemo || true
sleep 1

# --- mask the banner, cut the detach screen, render the GIF -----------------
python3 "$REPO/docs/demo/postprocess.py" "$RAW" "$OUT/reelquiet-demo.cast" "$DEMO/render.cast"

~/.local/bin/agg --font-family "DejaVu Sans Mono" --font-size 16 --theme asciinema \
  --idle-time-limit 1.2 --last-frame-duration 2.5 \
  "$DEMO/render.cast" "$OUT/reelquiet-demo.gif"

echo "cast: $OUT/reelquiet-demo.cast"
echo "gif:  $OUT/reelquiet-demo.gif"
