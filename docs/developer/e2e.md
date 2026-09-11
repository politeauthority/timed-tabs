# End-to-end tests

`npm run e2e` runs the extension in a real, headless Firefox and checks what it did.
CI runs the same thing on the self-hosted runner for every push to `main` and every
open PR, in the **E2E** workflow.

## How a scenario works

A scenario is one file in `tests/e2e/scenarios/`:

```json
{
  "runSeconds": 25,
  "dev": { "...": "a dev.json, exactly as the dev build reads it" },
  "expect": ["regex the log must match", "..."],
  "expectNot": ["regex the log must not match"]
}
```

`scripts/e2e.mjs` builds the dev target with that `dev` object as its `dev.json`,
runs `web-ext run` headless for `runSeconds`, stops it, and matches the log against
the expectations. The log, and the screenshot the scenario captured, are written to
`e2e-artifacts/<name>.*`, which CI uploads.

## What CI reports

Alongside the per-scenario files, the run writes `e2e-artifacts/results.json`: one
record per scenario with its duration, every expectation, and whether each one
matched. `scripts/e2e-summary.py` turns that into the job summary — a pass/fail table
over the scenarios, the exact expectations that missed on a failure, and a link to
the artifact. Running locally you can ignore it; the console output says the same
thing.

The summary also carries a timing table from `.github/actions/step-times`, which
marks any step over a minute. Firefox on the runner is the usual reason a run drags:
the pod is ephemeral, so every run re-installs the GTK libraries and re-downloads the
browser.

Screenshots cannot be linked individually — an artifact downloads as one zip — so the
table names the files to look for once it is open.

The dev hook is what makes this work. On load, the dev build seeds settings, rules and
site groups, opens tabs and windows, replays clicks, and logs what it is doing. The
lines the scenarios rely on, all prefixed `[timed-tabs]`, are:

- `look <tabId> <url> ind=<indicators> style=<favicon style> quiet=<bool> flash=<bool>`,
  printed whenever a tab's effective appearance changes. A tab whose appearance
  equals the defaults prints no new line when it navigates, so expect a `look` line
  only where a rule changes something.
- `expired <tabId> <url> action=<close|discard|reload|none>` when a tab runs out.
- `recorded <url> icon=<yes|no>` when a closed tab is added to Recently expired.
- `navigated <tabId> <url>` after a `navigate` entry in the scenario moved a tab.
- `CAPTURE <i>/<n> <data>` chunks of the screenshot, which the runner reassembles.

Two `dev.json` keys exist for scenarios: `navigate` sends the tab that is on one
address to another at a given time, and `groups` seeds site groups.

## Writing one

Copy the nearest scenario and change the rules and expectations. Use `example.com`
and `example.org`: they are stable, tiny, and have no favicon, so the icon fallback
path is exercised too. Open `ui/panel.html?view=page#tabs` in `openUrls`: it makes a
useful screenshot, and without a tab opened in the original window the background
tabs of a new window did not load under headless Firefox.

Keep `runSeconds` as short as the scenario allows. Firefox needs about five seconds
to start, pages a few more, and a lifetime rule needs its lifetime plus a tick.

Run one scenario with `npm run e2e -- <name>`. Set `FIREFOX=/path/to/firefox` to use a
particular binary; without it, web-ext finds the installed one.

## The CI job

`.github/workflows/e2e.yaml` runs on the `timed-tabs` runner. It installs Firefox's
libraries with apt (on Ubuntu 24.04 the ALSA package is `libasound2t64`), fetches
Firefox with `browser-actions/setup-firefox`, then runs `npm run e2e`. About six
minutes, most of it the install.

The job is a required status check on `main`. A PR with the label **ci pause** skips
it; GitHub counts a skipped required check as passed, so the label lets a PR merge
without waiting for Firefox. The workflow listens for label changes, so adding or
removing the label re-evaluates the PR at once.
