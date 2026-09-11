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
| **E2E** (`e2e.yaml`) | called by CI; dispatch | The extension in a real headless Firefox, two versions in parallel. See [e2e.md](e2e.md). |
| **CI run full** (`full.yaml`) | every PR, including every label change | Holds the merge — *pending*, not red — until the `ci run full` label is on and the E2E scenarios have passed on the last ten Firefox releases. See [The full run](#the-full-run). |
| **Not paused** (`pause.yaml`) | every PR, including every label change and review | Goes red while the `ci pause` label is on. Also dispatches Release Please when a review or the `release-approved` label lands on the release PR, so that workflow need not listen to PR events itself. |
| **Auto-merge** (`automerge.yaml`) | the `automerge` label, both directions | Arms and disarms GitHub's auto-merge, and keeps the label and the state agreeing. |
| **Release Please** (`release-please.yaml`) | push to `main`, review, label, dispatch | Maintains the release PR, and on merge tags, packages and publishes. |
| **Beta Release** (`beta-release.yaml`) | dispatch | Cuts a beta from a snapshot of `main`. |
| **Force Release** (`force-release.yaml`) | dispatch | Pushes an empty `Release-As:` commit when nothing releasable has landed. |

## What must be green

Five contexts are required on `main`:

```
Lint, test & build
Not paused
E2E / Firefox latest
E2E / Firefox previous
CI run full
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

Update protection in the same change that renames anything. `CI run full` is the odd
one out: it is a commit status the gate job posts by API rather than a job's own
check, so its `app_id` is `-1` (any source) where the others pin the Actions app.

```sh
gh api -X PATCH repos/politeauthority/timed-tabs/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "checks": [{"context": "Lint, test & build", "app_id": 15368},
            {"context": "Not paused", "app_id": 15368},
            {"context": "E2E / Firefox latest", "app_id": 15368},
            {"context": "E2E / Firefox previous", "app_id": 15368},
            {"context": "CI run full", "app_id": -1}]}
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

## The full run

Merging into `main` needs the **`ci run full`** label. GitHub has no required labels,
so it is enforced by a required status, **CI run full**, that `full.yaml` posts on the
head commit. The label is a merge requirement, not a test, so a missing one is not a
failure: the status sits at *pending*, the merge box says "Waiting" and stays locked,
and nothing on the PR is red for a label nobody has had a reason to add yet. With the
label on, the E2E scenarios run on the last ten Firefox releases — the current one and
the nine majors before it, each resolved from Mozilla's feed the way `E2E` resolves its
two — and the status goes green once all ten have passed. Take the label off and it
goes back to pending. It is red only when the Firefoxes actually fail.

The ten legs report as `Full / Firefox latest`, `Full / Firefox previous`,
`Full / Firefox previous-2` … `previous-9`. None of them is required on its own, and
neither is the `Full run gate` job that posts the status; only the status is, so
adding or dropping a leg does not touch branch protection.

Arming auto-merge adds the label, whether by the `automerge` label or the button on
the PR, so a PR told to merge itself is never left waiting on a label nobody added.
Auto-merge adds it with the `PAT` secret: a label added by `GITHUB_TOKEN` wakes no
workflow, and the full run would only start on the next push.

Ten Firefoxes are ten runner jobs, so the workflow is careful about when they run.
A later event on a commit that already passed — a review, another label — reuses that
result instead of running again: "passed" meaning an earlier run's `Full /` legs all
concluded green, not merely that the run finished, since an unlabelled run finishes
green having tested nothing. A new push cancels the legs still running for the commit
it replaced. A pull request against a branch other than `main` passes the gate
without the label, and so does the release PR, whose branch never carries anything a
scenario reads.

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
