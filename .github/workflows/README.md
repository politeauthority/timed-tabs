# Workflow conventions

## Naming

Two names appear in the GitHub UI and they answer different questions.

### `name:` — the workflow

Names the workflow in the Actions sidebar and the **Workflow** filter. A short noun
phrase for the thing that runs: `CI`, `E2E`, `Auto-merge`, `Release Please`.

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
protection matches on, so renaming `Lint, test & build`, `E2E (headless Firefox)` or
`Not paused` silently stops the check from being required. Update branch protection
in the same change or leave the name alone.

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
of the trigger, as `E2E` does, or let the job run every time, as `Not paused` does.

| Workflow | Wakes on labels | Why |
|---|---|---|
| `CI` | no | the label it cared about moved to `Not paused` |
| `E2E` | no | required check; a skip would overwrite a real pass |
| `Not paused` | yes, all of them | required check; its red must never become a skip |
| `Auto-merge` | `automerge` only | not a required check, so an `if` is safe |

`Auto-merge` listens both ways. Adding the label arms GitHub's auto-merge and
removing it disarms; arming or disarming from the PR page moves the label to match.
Each direction checks the current state before acting, so the two halves settle
after one hop instead of handing the event back and forth.
