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
    """latest, previous, previous-2, previous-3 ... in that order."""
    if leg == "latest":
        return 0
    m = re.fullmatch(r"previous(?:-(\d+))?", leg)
    return int(m.group(1) or 1) if m else 99


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
    records.sort(key=lambda r: leg_order(r["leg"]))

    jobs = {}
    try:
        with open(jobs_path, encoding="utf-8") as fh:
            for job in json.load(fh)["jobs"]:
                m = re.fullmatch(r".*Firefox (\S+)", job["name"])
                if m:
                    jobs[m.group(1)] = job
    except (OSError, ValueError, KeyError):
        pass

    out = []
    if not records:
        out.append("_No leg records were uploaded; see the Firefox jobs on this run._")
        print("\n".join(out))
        return 0

    passed = sum(1 for r in records if r["outcome"] == "success")
    versions = [r["version"] for r in records if r["version"]]
    span = f" ({versions[-1]} → {versions[0]})" if len(versions) > 1 else ""
    out.append(f"**{passed}/{len(records)} Firefoxes passed**{span}.\n")
    out.append("| Leg | Firefox | Scenarios | Scenario time | Job time | Result |")
    out.append("|---|---|--:|--:|--:|---|")
    for r in records:
        job = jobs.get(r["leg"], {})
        url = job.get("url") or ""
        leg = f"[`{r['leg']}`]({url})" if url else f"`{r['leg']}`"
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

    # Only the legs that failed get their scenario table. Four green tables say
    # nothing a row has not already said.
    for r in records:
        if r["outcome"] == "success" or not r.get("scenarios"):
            continue
        out.append(f"\n<details open><summary>{ICON.get(r['outcome'], '❓')} <b>Firefox {r['leg']}"
                   f"{' (' + r['version'] + ')' if r['version'] else ''}</b> — what happened</summary>\n")
        out.append(leg_summary.render(r["scenarios"]))
        out.append("\n</details>")

    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
