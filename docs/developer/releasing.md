# Releasing

A stable release is cut by release-please from `main` once an admin approves it. A
beta is a snapshot of `main` taken between stables. Both attach unsigned Firefox and
Chrome zips to a GitHub Release; a stable also uploads the Firefox build to the AMO
listing.

## ⏸️ Stable releases are paused

While the project is in development, every release is a beta. release-please still
keeps its release PR up to date, because the Beta Release workflow reads the next
version from that PR's title, but the job that merges it is skipped and the Force
Release workflow refuses to run. Both check the repository variable
`STABLE_RELEASES`, found under Settings, Secrets and variables, Actions, Variables.
Set it to `true` to resume stable releases; delete it to pause them again.

Do not merge the release PR by hand while paused. The next workflow run would treat
that merge as a stable release and tag it.

## 🏷️ Auto-merge

Label a PR `automerge` and GitHub squash-merges it once **Lint, test & build**
passes, then deletes the branch. `.github/workflows/automerge.yaml` only arms
GitHub's own auto-merge; the merge itself is GitHub's, so the push to `main`
triggers the release pipeline as a hand merge would. Remove the label to cancel.

This leans on `main` requiring the **Lint, test & build** check. Without a required
check nothing blocks a PR, and GitHub refuses to arm auto-merge at all. Admins are
deliberately exempt from the check (`enforce_admins` is off) so release-please and
**Force Release** can still push to `main` directly.

The release PR is not part of this. It stays admin-gated, it carries no `automerge`
label, and it should not be given one — its label is `release-approved`, which is a
different thing entirely.

## 🔐 The admin gate

The release PR is merged by the **Admin-gated merge** job, and only once an admin has
cleared it in one of two ways:

- **An `APPROVED` review**, naming the PR's current head commit.
- **The `release-approved` label.** GitHub refuses to let anyone approve their own
  pull request, and release-please opens this PR with the `PAT` — so while the
  token's owner is the only admin on the repo, a review is impossible and the label
  is the only way through. The job checks that an admin applied it and that it was
  applied *after* the current head was committed.

Both checks are tied to the current head on purpose. release-please rewrites the PR
branch whenever `main` moves, and neither a stale approval nor a stale label may
release a version nobody looked at. When the branch moves under a label, remove the
label and apply it again; the run summary says so when that happens.

Approving, or labelling, re-triggers the workflow, which merges, tags and packages.
Nothing else needs pressing.

## 🔢 Versions

Stable releases use three-part semver, `0.8.0`. Betas use a prerelease suffix,
`0.8.0-beta.14`. That is the git tag, the GitHub Release name, the zip file name and
the version the UI shows.

Firefox and AMO only accept one to four dot-separated integers in the manifest's
`version`, so `0.8.0-beta.14` cannot go there. A beta ships with a manifest version
of `<last stable>.<N>` instead, where N is the number of commits on `main` since the
last stable tag. The beta named `0.8.0-beta.14` installs as `0.7.0.14`. That sorts
after `0.7.0` and before `0.8.0`, so a beta install updates to the next stable once
builds are signed and served with an update URL. Stable manifest versions stay
three-part. Before the first stable release there is no tag, so N counts every commit
on `main` and the alias starts from `0.0.0`: the first betas install as `0.0.0.N` and
are named `0.0.1-beta.N`.

`scripts/build.mjs` writes `build.json` next to the manifest in every build:

```json
{ "version": "0.7.0.14", "semver": "0.8.0", "tag": "beta.14", "channel": "beta", "commit": "8877d1d", "builtAt": "..." }
```

`src/shared/version.js` shows `semver` when present, otherwise the manifest version,
with `tag` appended. `channel` is `beta`, `dev` or empty.

A checkout loaded straight from `src/` has no `build.json`, and that absence is what
marks it: it shows as `0.0.1-dev` and wears the dev badge. Nothing stamps it, because
release-please owns the manifest version and Firefox will not accept a suffix there,
so the `-dev` exists only for display. A built target always writes a `build.json`,
even when its `tag` is empty, so a real release is never mistaken for a source load.

## 🚀 How a stable release happens

1. Commits land on `main` through PRs. They must be Conventional Commits, because
   release-please derives the bump from them. Below 1.0.0 both `feat:` and `fix:` bump
   the patch and a breaking change bumps the minor, so the versions climb slowly
   while the project is in development; `chore:` and `docs:` do not release at all.
   With no release yet, release-please ignores the bump rules and uses
   `initial-version` from its config, which is 0.0.1.
2. `.github/workflows/release-please.yaml` keeps a release PR open with the next
   version and the changelog.
3. Nothing is released until someone with admin permission clears that PR, either
   by approving it or by applying the `release-approved` label. The workflow then
   merges it, tags `vX.Y.Z`, creates the GitHub Release and attaches the zips.
   See [The admin gate](#-the-admin-gate).
4. release-please writes the version to `.release-please-manifest.json`,
   `package.json`, `package-lock.json` and `src/manifest.json`. Never bump a version
   by hand.

If nothing releasable has landed but you still need a release, run the **Force
Release** workflow. It pushes an empty `Release-As: X.Y.Z` commit, which the release
pipeline picks up as usual.

## 🦊 Publishing to AMO

The **Publish to AMO** job in `release-please.yaml` runs after **Package extension**,
rebuilds `dist/firefox` from the tag and uploads it to the listing with
`web-ext sign --channel listed`. The zips on the GitHub Release stay unsigned; the
signed copy is the one AMO serves.

The job is dormant until two repository secrets exist, `AMO_JWT_ISSUER` and
`AMO_JWT_SECRET`, the JWT credentials from the API keys page on AMO. Without them it
skips the upload and says so in the run summary, which is also what a fork gets. They
are unrelated to `PAT`.

Two rules that the API does not forgive:

- **A version number is spent the moment AMO sees it**, even if the upload then fails
  validation. There is no re-running a failed publish; the fix is the next patch
  release.
- **Only `dist/firefox` may be uploaded.** The dev target stamps a different extension
  id (`timed-tabs-dev@alixfullerton`), and the id is what ties an upload to the
  listing.

The first submission is not this job's work. A listing has to exist before the API can
add versions to it, so the first upload is done by hand on the developer hub, along
with the description, categories and screenshots. That copy lives outside the repo, in
`docs/personal/amo-listing.md`; the reviewer notes are tracked, in
[amo-review-notes.md](amo-review-notes.md).

## 🚧 How a beta happens

Open the **Beta Release** workflow in the Actions tab and run it. It:

1. Finds the last stable tag and counts the commits on `main` since it. That count is
   N.
2. Reads the next version from the open release PR's title, for example
   `chore(main): release 0.8.0`.
3. Runs lint and tests, then builds with `BUILD_CHANNEL=beta`, `BUILD_SEMVER=0.8.0`,
   `BUILD_TAG=beta.N` and `MANIFEST_VERSION=0.7.0.N`.
4. Tags `v0.8.0-beta.N` on the current `main` commit and publishes a GitHub Release
   marked as a prerelease, with the commits since the last stable as its notes.

It refuses to run when there is no open release PR, because that means nothing
releasable is on `main`, and when the tag for the current commit already exists.

Betas commit nothing and never touch release-please. When the release PR is
approved, the stable ships as normal and the beta tags stay where they are.

The workflow is manual on purpose while the flow is new. To cut a beta on every push
to `main`, add `push: branches: [main]` to its `on:` block.

## 👀 What a beta looks like to the user

The build script renames the extension to "Timed Tabs Beta" in the manifest and the
toolbar tooltip, so it reads as a beta in `about:addons` and on hover. The popup and
the full page show a yellow BETA badge beside the title. Its tooltip gives both
versions: the one the release is named after and the one the browser lists. Dev builds
get the same treatment with a grey DEV badge.

A beta uses the same extension id as stable, so installing one replaces the stable
install. Both cannot run at once; they would paint the same tabs.

## 🔧 Building a beta locally

```sh
BUILD_CHANNEL=beta BUILD_SEMVER=0.8.0 BUILD_TAG=beta.14 MANIFEST_VERSION=0.7.0.14 \
  ZIP_VERSION=0.8.0-beta.14 npm run package
```

`ZIP_VERSION` names the zips. Without it they take the version from `package.json`.
Set `BUILD_TAG=rc1` on its own for a stable-versioned build that shows `0.8.0-rc1`.

## ⚠️ Things that are easy to break

`npm run lint` runs `web-ext lint`, which rejects a manifest version with anything but
digits and dots, so a bad `MANIFEST_VERSION` fails in CI before it can be tagged. The
two release workflows share the `release-please-main` concurrency group, which stops a
beta and a stable from racing. The stable pipeline needs the `PAT` secret so that its
own merge re-triggers the workflow; the beta pipeline runs on the default token, since
nothing downstream has to wake up after it.
