# Workflow conventions

## Naming

Two names appear in the GitHub UI and they answer different questions.

### `name:` — the workflow

Names the workflow in the Actions sidebar and the **Workflow** filter. A short noun
phrase for the thing that runs: `CI`, `E2E`, `Auto-merge`, `Release Please`.

A reusable workflow never shows a run of its own — its jobs appear inside the run
that called it — so its `name:` is only ever read here, in the file list.

### `run-name:` — one run of it

The bold line in the run list. Every workflow uses the same shape:

```
<workflow name> — <subject>
```

The subject is the thing the run acted on. On a pull request that is `PR #<number>`;
on anything else it is the ref. Workflows that wake on both use one expression:

```yaml
run-name: "CI — ${{ github.event_name == 'pull_request' && format('PR #{0}', github.event.pull_request.number) || github.ref_name }}"
```

`github.ref_name` alone is not enough. On a pull request it reads `73/merge`, which
is the merge ref, not a branch anyone recognises. That is what the expression above
exists to avoid.

Do not put the PR title in a run name. The column is narrow enough to truncate it
mid-word, and the line underneath already spells out the PR, the event and who
triggered it.

Manual workflows name what they produce rather than a ref, because the ref is always
`main` and says nothing: `Force Release — 0.9.0`, `Force Release — minor bump`.

### `jobs.<id>.name:` — the status check

This one is load-bearing. A job's name is the status-check context that branch
protection matches on, so renaming `Lint, test & build`, `E2E / Firefox latest`,
`E2E / Firefox previous` or `Not paused` silently stops the check from being
required. Update branch protection in the same change or leave the name alone.

A called workflow's jobs are named `<calling job's name> / <called job's name>`.
That is where `E2E / Firefox latest` comes from: `jobs.e2e` in `ci.yaml` is named
`E2E`, and the matrix leg in `e2e.yaml` is named `Firefox latest`. Both halves are
part of the required context, so either one renamed breaks it. The prefix is not
optional — a called workflow cannot report under a bare name — which is the price of
calling one, and worth knowing before moving a required check into one.

A matrix job's name carries its matrix values, which is where the `latest` and
`previous` in those contexts come from. So changing what the matrix covers renames a
protected context: adding a version, renaming a leg or dropping one all need the
required checks on `main` updated in the same change, or branch protection goes on
waiting for a name nothing reports.

## Label triggers

`on.pull_request.types` cannot filter by label name, so `labeled` wakes a workflow
for every label in the repo. A workflow should only spend a runner on labels that
change what it does.

Where a job is **not** a required check, filter it in the job:

```yaml
if: github.event.action != 'labeled' || github.event.label.name == 'automerge'
```

Where a job **is** a required check, do not. A skipped job publishes a `skipped`
check run over whatever that name last reported on the commit, and branch protection
reads a skip as a pass — so filtering trades a real result for a neutral one, and on
a paused PR it hands back the merge the pause was holding. Either take the label out
of the trigger, as `CI` does, or let the job run every time, as `Not paused` does.

| Workflow | Wakes on labels | Why |
|---|---|---|
| `CI` | no | the label it cared about moved to `Not paused`, and `E2E`, which it calls, is a required check whose skip would overwrite a real pass |
| `Not paused` | yes, all of them | required check; its red must never become a skip |
| `Auto-merge` | `automerge` only | not a required check, so an `if` is safe |

`Auto-merge` listens both ways. Adding the label arms GitHub's auto-merge and
removing it disarms; arming or disarming from the PR page moves the label to match.
Each direction checks the current state before acting, so the two halves settle
after one hop instead of handing the event back and forth.
