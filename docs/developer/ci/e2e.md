# End-to-end tests

`npm run e2e` runs the extension in a real, headless Firefox and checks what it did.
`npm run e2e:chrome` runs the same scenarios in a real, headless Chrome. CI runs the
Firefox half on the self-hosted runner for every push to `main` and every open PR, as
the second half of the **CI** workflow, against four channels of Firefox, with two
Chrome legs beside them while Chrome is planned rather than supported.

Both take the same arguments: `npm run e2e -- navigation` runs one scenario by name,
`FIREFOX=` and `CHROME=` pick a binary.

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

`scripts/e2e.mjs` builds the dev target with that `dev` object as its `dev.json`, runs
it headless for `runSeconds`, stops it, and matches the log against the expectations.
The log, and the screenshot the scenario captured, are written to
`e2e-artifacts/<name>.*`, which CI uploads.

`runSeconds` counts from the extension's **first log line**, not from launch, so a
slow browser start on a busy runner does not eat into the scenario.

## Getting the log out of each browser

The scenario format, the matching and the artifacts are identical in both browsers.
Only the part that produces the log differs, and it differs a lot.

**Firefox** prints the extension's console straight to stdout given
`devtools.console.stdout.{content,chrome}`, so `web-ext run` is the entire driver and
the log is just what the process wrote.

**Chrome** has no such pref. An MV3 service worker's console goes to the DevTools
console and nowhere else, so `scripts/e2e-chrome.mjs` starts Chrome with a debugging
port, attaches over the DevTools Protocol, and collects `Runtime.consoleAPICalled`.
Two Chrome behaviours shape that file:

- **`--load-extension` has been off by default since Chrome 137.** A build loaded that
  way is silently ignored — the browser starts fine and the extension simply is not
  there, with nothing in any log to say so. `Extensions.loadUnpacked` over CDP is the
  supported route now, and it needs `--enable-unsafe-extension-debugging`.
- **The service worker is lazy and short-lived.** Attaching after it has already run
  misses everything it said, so `Target.setAutoAttach` goes on *before* the extension
  is loaded — which is why `loadUnpacked` is the last thing the driver does.

Chrome's port comes from `--remote-debugging-port=0` and is read back out of
`DevToolsActivePort` in the throwaway profile, so two legs on one runner cannot race
for a fixed port.

## What a run prints

The runner counts as it goes, so a log being watched halfway through says where it is
rather than only what has happened:

```
🦊 Firefox: 3 scenarios to run: appearance-overrides, close-on-expire, navigation

🧪 [2/3] close-on-expire — up to 25s
  ⏱️  extension up after 3s; running 25s
  ✅ expect    expired \d+ https://example\.com/ action=close
  ✅ expectNot expired \d+ https://example\.org/
  ✅ [2/3] PASS close-on-expire 📸
  📊 2/2 passed so far, 1 to go

🏁 2/3 scenarios passed in 75s
```

The total comes first because the first Firefox can take half a minute to start, and
on a runner that line is the only thing that says how long the step ought to take. 📸
means the scenario captured a screenshot.

## What CI reports

Alongside the per-scenario files, the run writes `e2e-artifacts/results.json`: one
record per scenario with its position, duration, every expectation, and whether each
one matched. `scripts/e2e-summary.py` turns that into the job summary — the same
counts the console prints, a pass/fail table over the scenarios, the exact
expectations that missed on a failure, and a link to the artifact. Running locally you
can ignore it; the console output says the same thing.

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

It runs on the `timed-tabs` runner, as two jobs, one per browser, each a matrix of
legs. It restores Node's
tool directory and the Firefox libraries (on Ubuntu 24.04 the ALSA package is
`libasound2t64`) from the Actions cache, fetches Firefox with
`browser-actions/setup-firefox`, then runs `npm run e2e`.

The caches exist because the runner is short of CPU rather than bandwidth —
[runners.md](runners.md) has that story, the Node tool cache both workflows
share, and how cache scoping decides which runs see a warm one.

What is specific to this job is the **Firefox libraries**. They are not restored with
an off-the-shelf apt action: the workflow installs the packages once, works out every
file `dpkg` put down, and packs those into `~/browser-libs.tar`, which later runs
restore with a single untar. Bump `BROWSER_LIBS_KEY` after changing the package list.
On Ubuntu 24.04 the ALSA package is `libasound2t64`. Firefox itself is not cached: its
download and extraction take under half a minute.

The install prints `debconf: delaying package configuration, since apt-utils is not
installed`. That is not a problem — debconf is saying it will configure packages at
the end of the run instead of one by one — and neither is the apt source rewriting
just above it, which is there because the runner pod cannot reach the Ubuntu mirrors
on port 80 at all.

## Which browsers

One vocabulary of channels for both browsers, resolved at run time from each
browser's own feed:

| Channel | Firefox | Chrome | In CI |
|---|---|---|---|
| `nightly` | Firefox Nightly (`latest-nightly`) | Chrome Canary | advisory |
| `stable` | the current release, 155.0.1 today | the current stable, 153.x | required (Firefox), advisory (Chrome) |
| `stable-1` | the last release of the major before it, 154.0.1 | one major behind stable, 152 | required (Firefox) |
| `stable-2` | two majors back, 153.x | two majors back, 151 | required (Firefox) |

Chrome runs only `nightly` and `stable` while it is planned rather than supported;
`stable-1` and `stable-2` are Firefox-only until then.

CI runs all four Firefox channels, of which stable, stable-1 and stable-2 are the
required checks, and Chrome nightly and stable beside them, on every PR and every push
to `main`. Nightly is shown and flagged but never holds the merge, since a daily build
breaking is worth knowing and not worth blocking on — and while Chrome is planned
rather than supported (see the [road map](../../road-map.md)), the same goes for every
Chrome leg (`chrome-advisory`, on by default), and no older Chrome major runs at all.
An advisory leg that fails is a warning on its job rather than a red.

All legs run the same scenarios in `tests/e2e/scenarios`. Nothing in them is
browser-specific — they pin `indicators` explicitly rather than relying on a default,
so the Firefox-only theme tint never enters — and that is the point: a scenario that
passes in one browser and fails in another is a real difference in the extension.

For Chrome, the *Resolve the Chrome version* step reads the Chrome for Testing
[last-known-good feed](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json)
for the current stable; `stable-N` becomes a bare major N behind it, which
`setup-chrome` installs as the latest build of that major, and `nightly` is handed to
`setup-chrome` as the `canary` channel.

No Firefox is pinned either. The `Resolve the Firefox version` step reads Mozilla's
[product-details feed](https://product-details.mozilla.org/1.0/firefox.json), takes
the shipped desktop releases from it (`major` and `stability`; betas, ESRs and
devedition are filtered out), and picks the newest — or, for `stable-N`, the last
point release N majors back. So `stable-1` follows every Firefox release on its own,
and the pair is always genuinely adjacent. `nightly` is handed to `setup-firefox` as
`latest-nightly`; whichever build that fetches, the *Which browser* step reads the
version off the binary, and that is what the table and the summary show for every leg.

Both legs resolve an exact version from that one feed rather than handing
`setup-firefox` the string `latest`, which keeps `stable-1` defined relative to the
version actually under test, and puts the number in the log and the job summary.

The legs come from two inputs, `firefox` and `chrome`, each a JSON list of channels
that is that browser's matrix directly; the workflow has one job per browser, near
copies of each other, and a leg is named `<Browser> <channel>`. `stable-N` is N
majors behind stable. The defaults are Firefox stable
and stable-1 plus Chrome stable, which is what the beta gate runs; CI passes all four
Firefox channels and Chrome nightly and stable — see [README.md](README.md#the-legs).
To change what CI runs, change the lists in `ci.yaml` and update branch protection in
the same change, because the Firefox stable legs are the required checks. See below.

## The status checks

Each leg reports its own check, and the three Firefox stable ones are required on
`main`, alongside **Lint, test & build** and **Not paused**:

- **E2E / Firefox stable**
- **E2E / Firefox stable-1**
- **E2E / Firefox stable-2**

`E2E / Firefox nightly` reports too and is never required: a daily build breaking is
worth seeing and not worth holding a merge for. `E2E / Chrome nightly` and
`E2E / Chrome stable` likewise, while Chrome is planned rather than supported.

Both halves of each name are load-bearing. GitHub prefixes a called workflow's jobs
with the calling job's name, so the context is `jobs.e2e` in `ci.yaml` (named `E2E`)
plus the leg's own name — and a matrix job's name carries its matrix values, which is
what puts `stable`, `stable-1` and `stable-2` in there.

That last part is the sharp edge: **changing the matrix renames a protected context.**
Add a third version, rename a leg, drop one — each of those silently stops a required
check from being required, because branch protection goes on matching a name nothing
reports any more. Update the required checks on `main` in the same change — the full list and the
`gh api` call that sets it are in [README.md](README.md#what-must-be-green).

A PR with the label **ci pause** skips the matrix; GitHub counts a skipped required
check as passed, so the label lets a PR merge without waiting for Firefox. CI does not wake on
label events, so applying the label does not retroactively skip a run that already
happened — the next push picks it up, and in the meantime the `Not paused` check is
red and holding the merge anyway.

The release PR skips the matrix too. release-please's branch only ever rewrites
`CHANGELOG.md` and the four files that carry the version, and no scenario reads any of
them, so no Firefox had anything to say about it — while still costing four minutes
each on every push to `main`. Lint, the unit tests and the build still run there, so
`web-ext lint` sees the bumped manifest version before the tag is cut, and the
`package` job re-runs lint and the tests against the tag itself before anything is
attached to a release.

`workflow_dispatch` is still there, so a run on a branch, with whatever channel lists
you type, is one click from the Actions tab. Dispatched rather than called, the legs
report under their bare names, `Firefox stable`, `Chrome nightly` and so on.
