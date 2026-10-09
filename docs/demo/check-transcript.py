"""Replay a demo cast in a terminal emulator and look for repeated card rows.

    python3 docs/demo/check-transcript.py CAST [SESSION.jsonl]

For every output event the screen is rebuilt as the viewer would see it. A
frame where a Catch Card row appears on more than one line is reported with its
time and how long it stayed (until the next event). With the session's own
transcript (Claude Code's ~/.claude/projects/<dir>/<id>.jsonl), the script also
counts how many `reelquiet:` rows the plugin actually wrote, so a repeat on
screen can be told apart from a repeated write.

Needs `pyte` (pip install pyte).
"""

import json
import sys

import pyte


def card_rows(lines: list[str]) -> list[str]:
    return [l.strip() for l in lines if "reelquiet:" in l]


def main(cast: str, session: str | None) -> None:
    lines = open(cast, encoding="utf-8").read().splitlines()
    head = json.loads(lines[0])
    screen = pyte.Screen(head["width"], head["height"])
    stream = pyte.Stream(screen)
    events = [json.loads(l) for l in lines[1:]]

    dupes = []
    for i, (t, kind, data) in enumerate(events):
        if kind != "o":
            continue
        stream.feed(data)
        rows = card_rows(screen.display)
        seen = {r for r in rows if rows.count(r) > 1}
        if seen:
            until = events[i + 1][0] if i + 1 < len(events) else t
            dupes.append((t, until - t, sorted(seen)))

    if dupes:
        for t, held, rows in dupes:
            print(f"repeat on screen at {t:6.2f}s for {held * 1000:5.0f} ms: {rows}")
    else:
        print("no frame shows a card row twice")
    final = card_rows(screen.display)
    print(f"final frame: {len(final)} card rows, {len(set(final))} distinct")

    if session:
        written = []
        for l in open(session, encoding="utf-8"):
            o = json.loads(l)
            c = o.get("content")
            if isinstance(c, str) and c.startswith("reelquiet:"):
                written.append(c)
        print(f"plugin wrote {len(written)} card rows, {len(set(written))} distinct")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
