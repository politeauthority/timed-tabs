# ⚙️ Continuous integration

What runs in GitHub Actions, what has to be green before anything merges, and how a
release is cut. The workflows themselves are in
[`.github/workflows/`](../../../.github/workflows/), each with a comment block
explaining why it is shaped the way it is; this section is the map over the top.

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
| **E2E** (`e2e.yaml`) | called by CI; dispatch | The extension in a real headless Firefox, two versions in parallel. See [e2e.md](../e2e.md). |
| **Not paused** (`pause.yaml`) | every PR, including every label change and review | Goes red while the `ci pause` label is on. Also dispatches Release Please when a review or the `release-approved` label lands on the release PR, so that workflow need not listen to PR events itself. |
| **Auto-merge** (`automerge.yaml`) | the `automerge` label, both directions | Arms and disarms GitHub's auto-merge, and keeps the label and the state agreeing. |
| **Release Please** (`release-please.yaml`) | push to `main`, review, label, dispatch | Maintains the release PR, and on merge tags, packages and publishes. |
| **Beta Release** (`beta-release.yaml`) | dispatch | Cuts a beta from a snapshot of `main`. |
| **Force Release** (`force-release.yaml`) | dispatch | Pushes an empty `Release-As:` commit when nothing releasable has landed. |

## What must be green

Four contexts are required on `main`:

```
Lint, test & build
Not paused
E2E / Firefox latest
E2E / Firefox previous
```

`Not paused` was missing from that list for a while, and the gap is worth
remembering: the job ran on every PR, went red on every paused one, and held up
nothing, because branch protection was never reading it — so `ci pause` skipped
Firefox without blocking the merge, the opposite of what the label is for. A check
nobody requires is decoration.

Job names are the status-check contexts branch protection matches on, so **renaming a
job silently stops its check being required** — branch protection goes on waiting for
a name nothing reports. The E2E contexts are doubly brittle: a called workflow's jobs
are prefixed with the calling job's name, and a matrix job's name carries its matrix
values, so `E2E / Firefox latest` breaks if `jobs.e2e` in `ci.yaml` is renamed, if the
leg is renamed, or if the matrix changes shape.

Update protection in the same change that renames anything:

```sh
gh api -X PATCH repos/politeauthority/timed-tabs/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "checks": [{"context": "Lint, test & build", "app_id": 15368},
            {"context": "Not paused", "app_id": 15368},
            {"context": "E2E / Firefox latest", "app_id": 15368},
            {"context": "E2E / Firefox previous", "app_id": 15368}]}
JSON
```

## Skipping work without skipping the check

A required check that never reports leaves a PR unmergeable for ever, so no required
job uses a `paths:` filter. Instead every one of them runs, and decides for itself
whether the work is worth doing: [`changed-paths`](../../../.github/actions/changed-paths/action.yml)
answers "false" only when every changed file is documentation or an asset, and the
job reports a skip in its summary while still publishing a green check.

It errs towards running. A kind of file it has not seen before counts as code.

E2E skips one more case on its own: the **release PR**. release-please's branch only
ever rewrites `CHANGELOG.md` and the four files carrying the version, which no
scenario reads, so both Firefoxes spent four minutes each on every push to `main`
saying nothing. Lint, the unit tests and the build still run there, which is what
keeps `web-ext lint` on the bumped manifest version before the tag is cut, and the
`package` job re-runs lint and the tests against the tag itself before anything is
attached to a release.

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
