# ⚙️ Continuous integration

What runs in GitHub Actions, what has to be green before anything merges, and how a
release is cut. The workflows themselves are in
[`.github/workflows/`](../../../.github/workflows/), each with a comment block
explaining why it is shaped the way it is; this section is the map over the top.

- [e2e.md](e2e.md) — the headless-Firefox end-to-end tests: how a scenario is
  written, how to run one, and what the E2E workflow checks.
- [runners.md](runners.md) — the self-hosted runner every job lands on, why it is
  slow in a particular way, and the caching that works around it.
- [releasing.md](releasing.md) — versions, channels and build tags, how a beta is
  cut, how stable releases are gated, and how a release reaches AMO.
- [conventions](../../../.github/workflows/README.md) — how workflows, runs and jobs
  are named, and which of them may listen for labels. Kept next to the workflows,
  because that is where it is read.

## The workflows

| Workflow | Runs on | What it does |
|---|---|---|
| **CI** (`ci.yaml`) | every PR, every push to `main`, dispatch | Lints, unit-tests and builds both dist targets, then calls E2E. |
| **E2E** (`e2e.yaml`) | called by CI; dispatch | The extension in a real headless browser: four Firefox channels at once, then two Chrome ones. See [e2e.md](e2e.md). |
| **Not paused** (`pause.yaml`) | every PR, including every label change and review | Goes red while the `ci pause` label is on. Also dispatches Release Please when a review or the `release-approved` label lands on the release PR, so that workflow need not listen to PR events itself. |
| **Auto-merge** (`automerge.yaml`) | the `automerge` label, both directions; every push to `main` | Arms and disarms GitHub's auto-merge, keeps the label and the state agreeing, and keeps every armed PR up to date with `main`. |
| **Release Please** (`release-please.yaml`) | push to `main`, review, label, dispatch | Maintains the release PR, and on merge tags, packages and publishes. |
| **Beta Release** (`beta-release.yaml`) | dispatch | Cuts a beta from a snapshot of `main`. |
| **Force Release** (`force-release.yaml`) | dispatch | Pushes an empty `Release-As:` commit when nothing releasable has landed. |

## What must be green

Five contexts are required on `main`:

```
Lint, test & build
Not paused
E2E / Firefox stable
E2E / Firefox stable-1
E2E / Firefox stable-2
```

`E2E / Firefox nightly` runs on every PR and push beside the three required Firefoxes
but is not among them: a daily build breaking is worth seeing on the PR that breaks it
and not worth holding a merge for. `E2E / Chrome nightly` and `E2E / Chrome stable`
run beside them on the same footing. Chrome is planned rather than supported (see the
[road map](../../road-map.md)), so while that holds its legs are advisory and only
those two channels run. When Chrome is supported, `Chrome stable` becomes a sixth
required context: add it here and to the `gh api` call below. The older majors join
by adding them to `ci.yaml`'s `chrome` list.

There used to be two tiers: CI ran two Firefoxes, and a `ci run full` label asked a
second workflow for the lot, enforced by a `CI run full` commit status. In practice
the label was on every PR from its first push, so every commit paid for both and the
plumbing that kept them from overlapping was the only thing the split bought. Now
there is one set of legs, run by CI on every PR and push, and the required checks are
the legs themselves.

`Not paused` was missing from that list for a while, and the gap is worth
remembering: the job ran on every PR, went red on every paused one, and held up
nothing, because branch protection was never reading it — so `ci pause` skipped
Firefox without blocking the merge, the opposite of what the label is for. A check
nobody requires is decoration.

Job names are the status-check contexts branch protection matches on, so **renaming a
job silently stops its check being required** — branch protection goes on waiting for
a name nothing reports. The E2E contexts are doubly brittle: a called workflow's jobs
are prefixed with the calling job's name, and a matrix job's name carries its matrix
values, so `E2E / Firefox stable` breaks if `jobs.e2e` in `ci.yaml` is renamed, if the
leg is renamed, or if the matrix changes shape.

Update protection in the same change that renames anything. Every context is a job's
own check run, so each pins the Actions app.

```sh
gh api -X PATCH repos/politeauthority/timed-tabs/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "checks": [{"context": "Lint, test & build", "app_id": 15368},
            {"context": "Not paused", "app_id": 15368},
            {"context": "E2E / Firefox stable", "app_id": 15368},
            {"context": "E2E / Firefox stable-1", "app_id": 15368},
            {"context": "E2E / Firefox stable-2", "app_id": 15368}]}
JSON
```

## Skipping work without skipping the check

A required check that never reports leaves a PR unmergeable for ever, so no required
job uses a `paths:` filter. Instead every one of them runs, and decides for itself
whether the work is worth doing: [`changed-paths`](../../../.github/actions/changed-paths/action.yml)
answers "false" only when every changed file is documentation or an asset, and the
job reports a skip in its summary while still publishing a green check.

It errs towards running. A kind of file it has not seen before counts as code. The
other workflows (auto-merge, pause, the releases) and `dependabot.yaml` count as
documentation: they are not what lint or a browser exercises, so a change to them
has nothing to learn from either. `ci.yaml`, `e2e.yaml` and `.github/actions/` stay
code, because a PR runs on its own copy of those and the run is what verifies the
edit.

E2E skips one more case on its own: the **release PR**. release-please's branch only
ever rewrites `CHANGELOG.md` and the four files carrying the version, which no
scenario reads, so every Firefox spent four minutes on every push to `main`
saying nothing. Lint, the unit tests and the build still run there, which is what
keeps `web-ext lint` on the bumped manifest version before the tag is cut, and the
`package` job re-runs lint and the tests against the tag itself before anything is
attached to a release.

## The legs

CI's E2E runs six legs on every PR and every push to `main`: Firefox `nightly`,
`stable`, `stable-1` and `stable-2`, each resolved from Mozilla's feed at run time,
and Chrome `nightly` and `stable`, which is all Chrome runs while it is planned rather
than supported. Two kinds of leg are advisory, shown and flagged but never counted:
nightly in both browsers, Firefox Nightly and Chrome Canary being daily builds, and
every Chrome leg while Chrome is planned. An advisory leg that fails is a warning on
its job, not a red — `e2e.yaml` runs it with `continue-on-error` — and it is not among
the required checks, so it cannot hold a merge.

Six browsers are six runner jobs, so the workflow is careful about how many run at
once: four at a time. An earlier ten at once starved one another on the runner node
until three of them saw a single tick in a scenario's whole window and failed on
timing alone. The Chrome job `needs` the Firefox job rather than running beside it —
Actions has no job priority, but the edge does the same thing — so the four Firefox
legs, which are the required checks, take the node in one wave and the merge decision
lands at about the four-minute mark; the two Chrome legs follow in the wave after, so
the whole run takes no longer than before. When a Chrome leg becomes required, drop
the `needs` and halve `max-parallel` so the two browsers share the node again. A new
push cancels the legs still running for the commit it replaced: CI's concurrency group
is the pull request, so GitHub drops the older run as it queues the newer one.

Each leg's job summary carries its own table: the version it resolved to, how many
scenarios passed, the scenario time and what missed. Each leg also uploads a small
`e2e-leg-<leg>` artifact with the same record, for anything that wants to sum several
legs into one table.

## Keeping an armed PR current

Auto-merge merges whatever the checks passed on, and the checks ran against the
merge ref of the moment. A PR that then sits behind three other merges would land
having been tested against none of them, so an armed PR is kept up to date: every
push to `main` brings each open PR with auto-merge armed and behind `main` up to date
(the same "Update branch" the PR page offers), and arming a PR does the same for that
one. The update is a push with the `PAT` secret so CI sees the new commit; without the secret nothing is updated, because an update pushed with
`GITHUB_TOKEN` wakes no checks. A conflict is reported in the run summary and needs a
hand.

Each update costs a CI run, which is the price of merging what was tested.
Branch protection still does not *require* branches to be up to date (`strict: false`);
turning that on would make the update mandatory for every PR, armed or not.

## Pausing a pull request

The **`ci pause`** label stops E2E spending Firefox minutes on a branch that is not
ready. Because GitHub counts a skipped required check as a pass, the label alone would
hand back the merge it is meant to hold — which is what the separate **Not paused**
check exists to prevent. It wakes on every label event, runs in seconds on a hosted
runner, and goes red while the label is on.

It is a required check on `main`, so the red it reports is what actually holds the
merge. It was not always — see [What must be green](#what-must-be-green).

CI itself does not wake on label events, so applying the label does not retroactively
skip a run already in flight; the next push picks it up.
