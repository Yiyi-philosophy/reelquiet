"""Turn a raw ReelQuiet demo recording into the published cast and a render cast.

    python3 docs/demo/postprocess.py RAW.cast OUT.cast RENDER.cast

Only two edits are made; everything else is kept byte for byte as recorded:

1. Cut tmux's detach screen. Detaching restores the outer terminal (alt screen
   off) and prints "[detached ...]"; every event from there on is dropped.
2. Mask the banner's model line. Claude Code's startup banner prints the model
   ID and billing mode next to the logo ("<model> with <effort> effort ·
   <billing>"). The ID is the user's, so it is replaced by a same-width neutral
   label. The renderer repaints by diff, so the line can arrive with ESC[C
   cursor skips between words; each skip counts as one cell.

RENDER.cast is OUT.cast with U+00A0 drawn as a plain space, for agg only: its
font fallback draws NBSP (Claude's prompt marker padding) as a stray glyph.

The script exits non-zero if any fragment of the masked line survives.
"""

import json
import re
import sys

LABEL = "(model hidden)"
# Logo tail, then the gap (two spaces or a 2-cell skip), then the dim colour,
# then the payload up to the end of the run.
BANNER = re.compile(
    r"(█▀(?:\x1b\[39m  |\x1b\[2C)\x1b\[38;5;246m)"
    r"((?:[^\x1b\r\n]|\x1b\[C)*? with [a-z]+ effort(?:[^\x1b\r\n]|\x1b\[C)*)"
)
LEAKS = ("with high effort ·", "Billing")


def cells(payload: str) -> int:
    return len(payload.replace("\x1b[C", " "))


def mask(match: re.Match) -> str:
    payload = match.group(2)
    effort = re.search(r"with [a-z]+ effort", payload.replace("\x1b[C", " ")).group(0)
    text = f"{LABEL} {effort}"
    return match.group(1) + text.ljust(cells(payload))


def main(raw: str, out: str, render: str) -> None:
    lines = open(raw, encoding="utf-8").read().splitlines()
    header, events = lines[0], [json.loads(l) for l in lines[1:]]

    cut = next(
        (i for i, ev in enumerate(events) if "\x1b[?1049l" in ev[2] or "[detached" in ev[2]),
        len(events),
    )
    kept = events[:cut]

    masked, ids = 0, set()
    for ev in kept:
        for m in BANNER.finditer(ev[2]):
            ids.add(m.group(2).replace("\x1b[C", " ").split(" with ")[0].strip())
        ev[2], n = BANNER.subn(mask, ev[2])
        masked += n

    # No piece of the model ID (any 5-character run) may survive anywhere.
    stream = "".join(ev[2] for ev in kept).replace("\x1b[C", " ")
    pieces = {i[k:k + 5] for i in ids for k in range(max(1, len(i) - 4))}
    leaks = [s for s in LEAKS if s in stream] + [f"model-id piece #{n}" for n, p in enumerate(sorted(pieces)) if p in stream]
    if masked == 0 or leaks:
        sys.exit(f"banner mask failed: masked={masked} leaks={leaks}")

    def write(path: str, evs: list) -> None:
        body = [header] + [json.dumps(ev, ensure_ascii=False) for ev in evs]
        open(path, "w", encoding="utf-8").write("\n".join(body) + "\n")

    write(out, kept)
    write(render, [[t, k, d.replace("\u00a0", " ")] for t, k, d in kept])
    print(f"kept {len(kept)} of {len(events)} events (last at {kept[-1][0]:.2f}s), masked {masked} banner lines")


if __name__ == "__main__":
    main(*sys.argv[1:4])
