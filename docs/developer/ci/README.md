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
| **CI run full** (`full.yaml`) | every PR, including every label change | Holds the merge — *pending*, not red — until the `ci run full` label is on and the E2E scenarios have passed on the last four Firefox releases. See [The full run](#the-full-run). |
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
CI run full
```

`E2E / Firefox nightly` runs on every PR and push beside the two required Firefoxes
but is not among them: a daily build breaking is worth seeing on the PR that breaks
it and not worth holding a merge for. `E2E / Chrome nightly` and `E2E / Chrome stable`
run beside them on the same footing. Chrome is planned rather than supported (see the
[road map](../../road-map.md)), so while that holds its legs are advisory and only
those two channels run. When Chrome is supported, `Chrome stable` becomes a sixth
required context: add it here and to the `gh api` call below. The older majors join
the full run by adding them to `full.yaml`'s `chrome` list.

CI's five E2E legs stand down on a PR to `main` that carries the `ci run full`
label, because the full run below tests those same versions and more, and the
`CI run full` status holds the merge until it has. A skipped required check reads as
a pass, which is safe here only because the status is the thing actually holding the
door. The legs still run on every push to `main`, where there is no full run.

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

Update protection in the same change that renames anything. `CI run full` is the odd
one out: it is a commit status the gate job posts by API rather than a job's own
check, so its `app_id` is `-1` (any source) where the others pin the Actions app.

```sh
gh api -X PATCH repos/politeauthority/timed-tabs/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "checks": [{"context": "Lint, test & build", "app_id": 15368},
            {"context": "Not paused", "app_id": 15368},
            {"context": "E2E / Firefox stable", "app_id": 15368},
            {"context": "E2E / Firefox stable-1", "app_id": 15368},
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
label on, the E2E scenarios run on the standard set for Firefox — `nightly`, `stable`,
`stable-1` and `stable-2`, each resolved from Mozilla's feed the way `E2E` resolves its
legs — and on Chrome `nightly` and `stable`, which is all Chrome runs while it is planned
rather than supported. The status goes green once Firefox stable and the two before it
have passed. Each browser is its own segment of the gate's summary with its
own table and verdict, and the status description names them: "Firefox: passed;
Chrome (advisory): stable-2 did not pass". Two kinds of leg are advisory, shown and
flagged but never counted: nightly in both browsers, Firefox Nightly and Chrome
Canary being daily builds, and every Chrome leg while Chrome is planned rather than
supported. An advisory leg that fails is a warning on its job, not a red — `e2e.yaml`
runs it with `continue-on-error` — and the gate's `--advisory nightly,chrome` keeps
it out of the verdict; the two are kept in step by hand. Take the label off and the
status goes back to pending. It is red only when a Firefox stable leg actually fails.

The six legs report as `Full / Firefox nightly` through `Full / Firefox stable-2`,
plus `Full / Chrome nightly` and `Full / Chrome stable`. None of them is required
on its own, and neither is the `Full run gate` job that posts the status; only the
status is, so adding or dropping a leg does not touch branch protection.

The gate's summary is the place to read the result: a table per browser with every
leg, the version it resolved to, how many scenarios passed, the scenario time and the
job's wall time. A green leg says nothing more than its row. A failed leg gets its
scenario table and what missed, under the main table and in its own job summary.
Each leg uploads a small `e2e-leg-<leg>` artifact for this; the gate reads them from
whichever run produced them, so a reused result still gets its table.

Arming auto-merge adds the label, whether by the `automerge` label or the button on
the PR, so a PR told to merge itself is never left waiting on a label nobody added.
Auto-merge adds it with the `PAT` secret: a label added by `GITHUB_TOKEN` wakes no
workflow, and the full run would only start on the next push.

Eight browsers are eight runner jobs, so the workflow is careful about how and when they
run. Three legs at a time: an earlier ten at once starved one another on the runner node
until three of them saw a single tick in a scenario's whole window and failed on
timing alone. A later event on a commit that already passed — a review, another label —
reuses that result instead of running again: "passed" meaning an earlier run's `Full /`
legs all concluded green, not merely that the run finished, since an unlabelled run
finishes green having tested nothing. A new push cancels the legs still running for the
commit it replaced: the workflow's concurrency group is the pull request, so GitHub drops
the older run as it queues the newer one, without either waiting for a runner. The one
thing that costs is a label added while the legs for that same commit are mid-flight —
it restarts them rather than queueing behind and reusing the result.

A pull request against a branch other than `main` passes the gate without the label, and
so does the release PR, whose branch never carries anything a scenario reads.

## Keeping an armed PR current

Auto-merge merges whatever the checks passed on, and the checks ran against the
merge ref of the moment. A PR that then sits behind three other merges would land
having been tested against none of them, so an armed PR is kept up to date: every
push to `main` brings each open PR with auto-merge armed and behind `main` up to date
(the same "Update branch" the PR page offers), and arming a PR does the same for that
one. The update is a push with the `PAT` secret so CI and the full run see the new
commit; without the secret nothing is updated, because an update pushed with
`GITHUB_TOKEN` wakes no checks. A conflict is reported in the run summary and needs a
hand.

Each update costs a CI and a full run, which is the price of merging what was tested.
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
