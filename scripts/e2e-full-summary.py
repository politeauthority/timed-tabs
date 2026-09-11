#!/usr/bin/env python3
"""One table for every Firefox leg of a full E2E run.

Each leg of e2e.yaml uploads an `e2e-leg-<leg>` artifact holding `leg.json`:
which Firefox it resolved, how the scenarios went, and their results. The gate
job in full.yaml downloads them all and calls this to write its summary: one row
per leg with the version, the scenario time, the job's wall time and the result,
then the scenario table only for the legs that failed. A green leg has nothing
to say beyond its row.

Usage: e2e-full-summary.py <legs dir> <jobs.json>
  <legs dir>  one subdirectory per artifact, each holding leg.json
  <jobs.json> `gh run view <id> --json jobs`, for wall times and links
"""
import json
import os
import re
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module  # noqa: E402

leg_summary = import_module("e2e-summary")

ICON = {"success": "✅", "failure": "❌", "cancelled": "⏹️", "skipped": "⏭️"}


def clock(seconds):
    return leg_summary.clock(int(seconds))


def leg_order(leg):
    """nightly, stable, previous, previous-2 ... in that order."""
    if leg == "nightly":
        return -1
    if leg in ("latest", "stable"):
        return 0
    m = re.fullmatch(r"previous(?:-(\d+))?", leg)
    return int(m.group(1) or 1) if m else 99


def counts(record):
    """Whether a leg holds the merge. Nightly is a daily build: worth watching,
    not worth blocking on, so it is reported and then ignored."""
    return record.get("leg") != "nightly"


def leg_name(record):
    """'Firefox latest', 'Chrome previous-2': the leg's job name without the
    caller's prefix. Records written before Chrome joined carry only `leg`, and
    those were all Firefox."""
    return record.get("name") or f"Firefox {record['leg']}"


def browser_order(record):
    return 1 if record.get("browser") == "chrome" else 0


def wall(job):
    try:
        start = datetime.fromisoformat(job["startedAt"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(job["completedAt"].replace("Z", "+00:00"))
    except (KeyError, ValueError, AttributeError):
        return None
    return int((end - start).total_seconds())


def main():
    legs_dir, jobs_path = sys.argv[1], sys.argv[2]

    records = []
    for name in sorted(os.listdir(legs_dir)):
        path = os.path.join(legs_dir, name, "leg.json")
        try:
            with open(path, encoding="utf-8") as fh:
                records.append(json.load(fh))
        except (OSError, ValueError):
            continue
    records.sort(key=lambda r: (browser_order(r), leg_order(r["leg"])))

    jobs = {}
    try:
        with open(jobs_path, encoding="utf-8") as fh:
            for job in json.load(fh)["jobs"]:
                # Keyed on the leg's own name, whichever browser it is.
                m = re.fullmatch(r".*((?:Firefox|Chrome) \S+)", job["name"])
                if m:
                    jobs[m.group(1)] = job
    except (OSError, ValueError, KeyError):
        pass

    out = []
    if not records:
        out.append("_No leg records were uploaded; see the leg jobs on this run._")
        print("\n".join(out))
        return 0

    passed = sum(1 for r in records if r["outcome"] == "success")
    required_failed = [r for r in records if counts(r) and r["outcome"] != "success"]
    advisory_failed = [r for r in records if not counts(r) and r["outcome"] != "success"]
    versions = [r["version"] for r in records if r["version"]]
    # A span only reads as one when every leg is the same browser.
    one_browser = len({browser_order(r) for r in records}) == 1
    span = f" ({versions[-1]} → {versions[0]})" if len(versions) > 1 and one_browser else ""
    out.append(f"**{passed}/{len(records)} legs passed**{span}.\n")
    if advisory_failed:
        names = ", ".join(f"`{leg_name(r)}`" for r in advisory_failed)
        out.append(f"⚠️ {names} did not pass. Nightly is a daily build and advisory: "
                   "it is shown here and does not hold the merge.\n")
    out.append("| Leg | Version | Scenarios | Scenario time | Job time | Result |")
    out.append("|---|---|--:|--:|--:|---|")
    for r in records:
        name = leg_name(r)
        job = jobs.get(name, {})
        url = job.get("url") or ""
        leg = f"[`{name}`]({url})" if url else f"`{name}`"
        scenarios = r.get("scenarios") or []
        if r.get("skipped"):
            count, secs = "—", "—"
        else:
            count = f"{sum(1 for s in scenarios if s['ok'])}/{len(scenarios)}" if scenarios else "—"
            secs = clock(sum(s["seconds"] for s in scenarios)) if scenarios else "—"
        seconds = wall(job)
        result = f"{ICON.get(r['outcome'], '❓')} {r['outcome']}"
        if r.get("skipped"):
            result = f"⏭️ skipped: {r['skipped']}"
        out.append(
            f"| {leg} | {r['version'] or '—'} | {count} | {secs} "
            f"| {clock(seconds) if seconds is not None else '—'} | {result} |"
        )

    # Only the legs that failed get their scenario table. Eight green tables say
    # nothing a row has not already said.
    for r in records:
        if r["outcome"] == "success" or not r.get("scenarios"):
            continue
        out.append(f"\n<details open><summary>{ICON.get(r['outcome'], '❓')} <b>{leg_name(r)}"
                   f"{' (' + r['version'] + ')' if r['version'] else ''}</b> — what happened</summary>\n")
        out.append(leg_summary.render(r["scenarios"]))
        out.append("\n</details>")

    print("\n".join(out))
    # 3, not 1: a 1 would look like the script itself falling over.
    return 3 if required_failed else 0


if __name__ == "__main__":
    sys.exit(main())
