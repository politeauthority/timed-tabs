#!/usr/bin/env python3
"""Render e2e-artifacts/results.json as a GitHub step summary.

scripts/e2e.mjs writes the results; this only formats them. It prints nothing
and exits non-zero when there is no readable results file, which is the caller's
cue to say so rather than print an empty table.

Usage: e2e-summary.py <results.json>   ARTIFACT_URL=<url> to link the artifact.
"""
import json
import os
import sys


def clock(seconds):
    return f"{seconds}s" if seconds < 60 else f"{seconds // 60}m {seconds % 60:02d}s"


def main():
    try:
        with open(sys.argv[1], encoding="utf-8") as fh:
            scenarios = json.load(fh)["scenarios"]
    except (IndexError, OSError, ValueError, KeyError):
        return 1
    if not scenarios:
        return 1

    url = os.environ.get("ARTIFACT_URL") or ""
    passed = [s for s in scenarios if s["ok"]]
    failed = [s for s in scenarios if not s["ok"]]

    total = len(scenarios)
    seconds = sum(s["seconds"] for s in scenarios)

    out = []
    # The same counts the step log prints, so the summary and the log agree
    # without anyone having to open the log to check.
    verdict = "🏁" if not failed else "❌"
    out.append(f"{verdict} **{len(passed)}/{total} scenarios passed** in {clock(seconds)}.\n")
    out.append("| # | Scenario | Result | Time | Checks | Artifacts |")
    out.append("|--:|---|---|--:|--:|---|")
    for n, s in enumerate(scenarios, start=1):
        hits = sum(1 for c in s["checks"] if c["ok"])
        # A screenshot cannot be linked on its own: artifacts download as one
        # zip. Naming the files is what makes them findable once it is open.
        files = ", ".join(f"`{a}`" for a in s["artifacts"])
        # The runner records its own position; fall back to the row order when
        # reading a results.json written before it did.
        position = s.get("index", n)
        out.append(
            f"| {position}/{total} | `{s['name']}` | {'✅ pass' if s['ok'] else '❌ **fail**'} "
            f"| {clock(s['seconds'])} | {hits}/{len(s['checks'])} | {files} |"
        )

    # Only the misses, and only when there are some: a green run does not need
    # thirty regexes spelled back at it.
    for s in failed:
        out.append(f"\n<details open><summary>❌ <code>{s['name']}</code> — what missed</summary>\n")
        out.append("| | Expectation |")
        out.append("|---|---|")
        for c in s["checks"]:
            if c["ok"]:
                continue
            wanted = "never matched" if c["kind"] == "expect" else "matched, and should not have"
            out.append(f"| `{c['kind']}` | <code>{c['pattern']}</code><br>_{wanted}_ |")
        out.append(f"\nFull log: `{s['name']}.log` in the artifact.")
        out.append("</details>")

    if url:
        out.append(f"\n📦 [Download **e2e-artifacts**]({url}) — logs, screenshots and the seeded `dev.json` per scenario.")
    else:
        out.append("\n📦 Logs and screenshots are in the **e2e-artifacts** artifact on this run.")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
