# 🔧 Developer documentation

For working on Timed Tabs rather than using it: how to build it, how it is tested,
how a release is cut, and what must not quietly break.

## Guides

- [building.md](building.md) — building and running it from source, the dist targets,
  the test commands and the Taskfile.
- [chrome.md](chrome.md) — what the Chrome build does differently, what the service
  worker cannot do, and what is still checked by hand.
- [design.md](design.md) — the rendered ring set under `src/icons/clock/`: what each
  file is, how to regenerate it and how to recolour it.
- [security-notes.md](security-notes.md) — the guarantees the extension makes about
  remote code, data and permissions, and the gaps that are known.
- [amo-review-notes.md](amo-review-notes.md) — the text to paste into the add-on
  reviewer's notes box on AMO submission.

## ⚙️ [ci/](ci/) — the pipeline

Everything that happens in GitHub Actions rather than on your machine.

- [ci/README.md](ci/README.md) — which workflows exist, what must be green before a
  merge, and how a pull request is paused.
- [ci/e2e.md](ci/e2e.md) — the headless-Firefox end-to-end tests: how a scenario is
  written and how to run one.
- [ci/runners.md](ci/runners.md) — the self-hosted runner and the caching that makes
  it bearable.
- [ci/releasing.md](ci/releasing.md) — versions, channels and build tags, betas, the
  admin gate on stable releases, and publishing to AMO.
