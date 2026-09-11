# End-to-end tests

`npm run e2e` runs the extension in a real, headless Firefox and checks what it did.
CI runs the same thing on the self-hosted runner for every push to `main` and every
open PR, as the second half of the **CI** workflow, against two versions of Firefox.

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

`.github/workflows/e2e.yaml` is a reusable workflow with no triggers of its own.
`jobs.e2e` in `ci.yaml` calls it, with `needs: lint-test`, so Firefox is only
installed once lint, the unit tests and the build are green — a branch that does not
compile never spends the minutes. It stays in its own file rather than becoming a
second job in `ci.yaml` because the Firefox plumbing is long enough to bury
everything around it.

It runs on the `timed-tabs` runner, as a matrix of two jobs. It restores Node's
tool directory and the Firefox libraries (on Ubuntu 24.04 the ALSA package is
`libasound2t64`) from the Actions cache, fetches Firefox with
`browser-actions/setup-firefox`, then runs `npm run e2e`.

The caches exist because the runner node is short of CPU rather than bandwidth:
downloads take seconds, but unpacking Node took two minutes and installing the
libraries with dpkg took nine on a busy day. The Node cache is the extracted tool
directory, which `setup-node` then finds without extracting anything. The library
cache, via `awalsh128/cache-apt-pkgs-action`, is the installed files, restored with
one untar. Bump `FIREFOX_LIBS_KEY` in the workflow after changing the package list. Firefox
itself is not cached: its download and extraction take under half a minute.

Two things about the install that look like problems and are not. apt prints
"debconf: delaying package configuration, since apt-utils is not installed"; that is
debconf noting it will configure packages at the end of the run instead of one by one,
and nothing needs apt-utils. And the runner pod cannot reach the Ubuntu mirrors on
port 80 at all, so the workflow points apt at an HTTPS mirror on IPv4 before
installing; without that the install took nine minutes or failed outright.

Caches are scoped by GitHub: a pull request's runs save under the PR's merge ref and
read from it and from `main`. A manual run on a branch reads only that branch and
`main`. So the first run on `main` after this lands is a cold one, and every PR after
that reads `main`'s caches.

## Which Firefox

Two, in parallel, and both must pass:

| Leg | What it is | Today |
|---|---|---|
| `Firefox latest` | the current release | 155.0.1 |
| `Firefox previous` | the last release of the major before it | 154.0.1 |

Neither is pinned. The `Resolve the Firefox version` step reads Mozilla's
[product-details feed](https://product-details.mozilla.org/1.0/firefox.json), takes
the shipped desktop releases from it (`major` and `stability`; betas, ESRs and
devedition are filtered out), and picks the newest — or, for `previous`, the last
point release one major back. So `previous` follows every Firefox release on its own,
and the pair is always genuinely adjacent.

Both legs resolve an exact version from that one feed rather than handing
`setup-firefox` the string `latest`, which keeps `previous` defined relative to the
version actually under test, and puts the number in the log and the job summary.

To test a different pair, change the `firefox` matrix in the workflow and teach the
resolve step the new label — and update branch protection in the same change, because
the legs are the required checks. See below.

## The status checks

Each leg reports its own check, and both are required on `main`:

- **E2E / Firefox latest**
- **E2E / Firefox previous**

Both halves of each name are load-bearing. GitHub prefixes a called workflow's jobs
with the calling job's name, so the context is `jobs.e2e` in `ci.yaml` (named `E2E`)
plus the leg's own name — and a matrix job's name carries its matrix values, which is
what puts `latest` and `previous` in there.

That last part is the sharp edge: **changing the matrix renames a protected context.**
Add a third version, rename a leg, drop one — each of those silently stops a required
check from being required, because branch protection goes on matching a name nothing
reports any more. Update the required checks on `main` in the same change:

```
gh api -X PATCH repos/politeauthority/timed-tabs/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "checks": [{"context": "Lint, test & build", "app_id": 15368},
            {"context": "E2E / Firefox latest", "app_id": 15368},
            {"context": "E2E / Firefox previous", "app_id": 15368}]}
JSON
```

A PR with the label **ci pause** skips the matrix; GitHub counts a skipped required
check as passed, so the label lets a PR merge without waiting for Firefox. CI does not wake on
label events, so applying the label does not retroactively skip a run that already
happened — the next push picks it up, and in the meantime the `Not paused` check is
red and holding the merge anyway.

`workflow_dispatch` is still there, so a Firefox-only run on a branch is one click
from the Actions tab. Dispatched rather than called, the job reports under its bare
name, `headless Firefox`.
