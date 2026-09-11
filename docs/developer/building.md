# 🔧 Build it yourself

Timed Tabs is plain JavaScript ES modules with no bundler, so `src/` loads straight
into Firefox. The build step exists only to produce the per-browser dist trees and
the release zips.

CI builds and tests on Node 22. Everything else comes from `npm install`.

## The short version

```sh
npm install
npm start            # Firefox, with the extension loaded from src/
npm test
npm run package      # -> web-ext-artifacts/timed-tabs-{firefox,chrome}-<version>.zip
```

## Running it

`npm start` launches a throwaway Firefox profile with the extension loaded from
`src/`; nothing is written to your own profile. For Chrome, `npm run start:chrome`
builds `dist/chrome` first, because Chrome cannot use everything `src/` contains.

To load a build by hand instead:

- 🦊 **Firefox** — `about:debugging` → This Firefox → Load Temporary Add-on, and pick
  `src/manifest.json`.
- 🌐 **Chrome** — `npm run build:chrome`, then `chrome://extensions` → Developer mode
  → Load unpacked, and pick `dist/chrome`. [chrome.md](chrome.md) covers what that
  build does differently.

## Checking it

```sh
npm run lint         # eslint, web-ext lint, and the icons are in sync
npm test             # vitest, watch with npm run test:watch
npm run e2e          # headless Firefox, see ci/e2e.md
```

## Building

`scripts/build.mjs` writes a dist tree per target and strips what that browser cannot
use — the Firefox theme API and `sessions.setTabValue` in the Chrome build, for
instance.

```sh
npm run build:firefox     # -> dist/firefox
npm run build:chrome      # -> dist/chrome
npm run build:dev         # -> dist/dev, the seeded dev build
npm run build:dev:chrome  # -> dist/chrome-dev, the same for Chrome
npm run package           # both zips, into web-ext-artifacts/
```

Which manifest each target gets lives in `scripts/manifest.js`, on its own because
what the Chrome build asks the user for is a promise made in
[security-notes.md](security-notes.md); `tests/manifest.test.js` holds it to it.

## The icons

`src/icons/` is generated, not drawn by hand. The dial's geometry lives in
`src/shared/icon-art.js` and `scripts/icons.mjs` rasterises it — no image library, so
it works from a plain `npm ci`.

```sh
npm run icons         # rewrite src/icons/ from the geometry
npm run icons:check   # fail if what is committed has drifted (part of npm run lint)
```

The same geometry paints the toolbar button at runtime in
`src/background/indicators/action-icon.js`, which is what keeps the live ring and the
shipped icon the same mark. Change the art in `icon-art.js`, run `npm run icons`, and
commit what it writes.

Each dist tree gets a `build.json` next to the manifest holding the version, semver,
tag, channel, commit and build time. A plain `src/` load has no `build.json`, and that
absence is what marks it as a dev load in the UI. Set `BUILD_TAG=rc1` to stamp a tag.
[releasing.md](ci/releasing.md) covers versions, channels and how releases are cut.

## Taskfile

[`Taskfile.yml`](../../Taskfile.yml) wraps the common commands and can target a
worktree; `task --list` shows them all.

```sh
task run                 # Firefox with the extension from this checkout
task run WT=<name>       # ...from worktrees/<name>
task run:dev DEV=<file>  # seeded dev build
task check               # lint and test
task package             # the release zips
```
