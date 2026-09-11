# Releasing

A stable release is cut by release-please from `main` once an admin approves it. A
beta is a snapshot of `main` taken between stables. Both attach unsigned Firefox and
Chrome zips to a GitHub Release, and AMO submission is still manual.

## Versions

Stable releases use three-part semver, `0.8.0`. Betas use a prerelease suffix,
`0.8.0-beta.14`. That is the git tag, the GitHub Release name, the zip file name and
the version the UI shows.

Firefox and AMO only accept one to four dot-separated integers in the manifest's
`version`, so `0.8.0-beta.14` cannot go there. A beta ships with a manifest version
of `<last stable>.<N>` instead, where N is the number of commits on `main` since the
last stable tag. The beta named `0.8.0-beta.14` installs as `0.7.0.14`. That sorts
after `0.7.0` and before `0.8.0`, so a beta install updates to the next stable once
builds are signed and served with an update URL. Stable manifest versions stay
three-part.

`scripts/build.mjs` writes `build.json` next to the manifest in every build:

```json
{ "version": "0.7.0.14", "semver": "0.8.0", "tag": "beta.14", "channel": "beta", "commit": "8877d1d", "builtAt": "..." }
```

`src/shared/version.js` shows `semver` when present, otherwise the manifest version,
with `tag` appended. `channel` is `beta`, `dev` or empty. A checkout loaded straight
from `src/` has no `build.json` and shows the manifest version alone.

## How a stable release happens

1. Commits land on `main` through PRs. They must be Conventional Commits, because
   release-please derives the bump from them: `feat:` is a minor, `fix:` a patch,
   `chore:` and `docs:` do not release at all.
2. `.github/workflows/release-please.yaml` keeps a release PR open with the next
   version and the changelog.
3. Nothing is released until someone with admin permission approves that PR on its
   current head commit. The workflow then merges it, tags `vX.Y.Z`, creates the
   GitHub Release and attaches the zips.
4. release-please writes the version to `.release-please-manifest.json`,
   `package.json`, `package-lock.json` and `src/manifest.json`. Never bump a version
   by hand.

If nothing releasable has landed but you still need a release, run the **Force
Release** workflow. It pushes an empty `Release-As: X.Y.Z` commit, which the release
pipeline picks up as usual.

## How a beta happens

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

## What a beta looks like to the user

The build script renames the extension to "Timed Tabs Beta" in the manifest and the
toolbar tooltip, so it reads as a beta in `about:addons` and on hover. The popup and
the full page show a yellow BETA badge beside the title. Its tooltip gives both
versions: the one the release is named after and the one the browser lists. Dev builds
get the same treatment with a grey DEV badge.

A beta uses the same extension id as stable, so installing one replaces the stable
install. Both cannot run at once; they would paint the same tabs.

## Building a beta locally

```sh
BUILD_CHANNEL=beta BUILD_SEMVER=0.8.0 BUILD_TAG=beta.14 MANIFEST_VERSION=0.7.0.14 \
  ZIP_VERSION=0.8.0-beta.14 npm run package
```

`ZIP_VERSION` names the zips. Without it they take the version from `package.json`.
Set `BUILD_TAG=rc1` on its own for a stable-versioned build that shows `0.8.0-rc1`.

## Things that are easy to break

`npm run lint` runs `web-ext lint`, which rejects a manifest version with anything but
digits and dots, so a bad `MANIFEST_VERSION` fails in CI before it can be tagged. The
two release workflows share the `release-please-main` concurrency group, which stops a
beta and a stable from racing. The stable pipeline needs the `PAT` secret so that its
own merge re-triggers the workflow; the beta pipeline runs on the default token, since
nothing downstream has to wake up after it.
