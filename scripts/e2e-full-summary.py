#!/usr/bin/env python3
"""One table per browser for the legs of a full E2E run.

Each leg of e2e.yaml uploads an `e2e-leg-<leg>` artifact holding `leg.json`:
which Firefox it resolved, how the scenarios went, and their results. The gate
job in full.yaml downloads them all and calls this to write its summary: a
segment per browser, one row per leg with the version, the scenario time, the
job's wall time and the result, then the scenario table only for the legs that
failed. A green leg has nothing to say beyond its row. Each segment's verdict
goes to stderr, one line per browser, and the exit code is 3 when a leg that
counts failed in either; nightly never counts.

Usage: e2e-full-summary.py [--advisory nightly,chrome] <legs dir> <jobs.json>
  --advisory  channels or browsers whose legs are shown and never counted;
              `nightly` is a channel, `chrome` a browser. Default: nightly.
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
    """nightly, stable, stable-1, stable-2 ... in that order."""
    if leg == "nightly":
        return -1
    if leg == "stable":
        return 0
    m = re.fullmatch(r"stable-(\d+)", leg)
    return int(m.group(1)) if m else 99


ADVISORY = {"nightly"}


def counts(record):
    """Whether a leg holds the merge. Nightly is a daily build: worth watching,
    not worth blocking on, so it is reported, flagged, and then ignored; a whole
    browser can be advisory the same way while it is being proven."""
    return record.get("leg") not in ADVISORY and record.get("browser", "firefox") not in ADVISORY


def leg_name(record):
    """'Firefox stable', 'Chrome stable-2': the leg's job name without the
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
    args = sys.argv[1:]
    if args[:1] == ["--advisory"]:
        ADVISORY.clear()
        ADVISORY.update(a for a in args[1].split(",") if a)
        args = args[2:]
    legs_dir, jobs_path = args[0], args[1]

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
        out.append("_No leg records were uploaded; see the browser jobs on this run._")
        print("\n".join(out))
        print("no leg records", file=sys.stderr)
        return 2

    # One segment per browser, each with its own table and its own verdict.
    # Nightly is advisory in both: shown, flagged when it fails, never counted.
    any_required_failed = False
    for browser in ("firefox", "chrome"):
        segment = [r for r in records if r.get("browser", "firefox") == browser]
        if not segment:
            continue
        label = "Firefox" if browser == "firefox" else "Chrome"
        emoji = "🦊" if browser == "firefox" else "🌐"
        passed = sum(1 for r in segment if r["outcome"] == "success")
        required_failed = [r for r in segment if counts(r) and r["outcome"] != "success"]
        advisory_failed = [r for r in segment if not counts(r) and r["outcome"] != "success"]
        any_required_failed = any_required_failed or bool(required_failed)

        browser_advisory = browser in ADVISORY
        if required_failed:
            verdict = f"{label}: {', '.join(r['leg'] for r in required_failed)} failed"
        elif advisory_failed and browser_advisory:
            verdict = f"{label} (advisory): {', '.join(r['leg'] for r in advisory_failed)} did not pass"
        elif advisory_failed:
            verdict = f"{label}: passed, nightly did not"
        else:
            verdict = f"{label}: passed" + (" (advisory)" if browser_advisory else "")
        print(verdict, file=sys.stderr)

        mark = "❌" if required_failed else ("⚠️" if advisory_failed else "✅")
        tag = " · advisory, does not hold the merge" if browser_advisory else ""
        out.append(f"#### {emoji} {label} — {mark} {passed}/{len(segment)} legs passed{tag}\n")
        if advisory_failed and not browser_advisory:
            names = ", ".join(f"`{leg_name(r)}`" for r in advisory_failed)
            out.append(f"⚠️ {names} did not pass. Nightly is a daily build and advisory: "
                       "it is shown here and does not hold the merge.\n")
        out.append("| Leg | Version | Scenarios | Scenario time | Job time | Result |")
        out.append("|---|---|--:|--:|--:|---|")
        for r in segment:
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
            elif not counts(r) and r["outcome"] != "success":
                result += " (advisory)"
            out.append(
                f"| {leg} | {r['version'] or '—'} | {count} | {secs} "
                f"| {clock(seconds) if seconds is not None else '—'} | {result} |"
            )
        out.append("")

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
    return 3 if any_required_failed else 0


if __name__ == "__main__":
    sys.exit(main())
