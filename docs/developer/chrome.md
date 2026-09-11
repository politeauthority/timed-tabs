# 🌐 Chrome

Firefox is the supported browser. Chrome is planned and not yet supported. The Chrome
build is packaged and attached to every release, everything below was run against it,
and its end-to-end legs run in CI as advisory checks. It is not on the Chrome Web Store,
and nothing gates a release on it. See the [road map](../road-map.md).

This page is what differs, and what to watch for. [building.md](building.md) covers the
build itself.

## Running it

```sh
npm run start:chrome      # builds dist/chrome and launches a throwaway Chrome
```

Or load it by hand: `npm run build:chrome`, then `chrome://extensions` → Developer mode
→ Load unpacked → `dist/chrome`.

### `--load-extension` no longer works

Branded Google Chrome ignores it, and says so:

```
--load-extension is not allowed in Google Chrome, ignoring.
```

Any recipe that loads an unpacked extension through that switch — most of what is
written about automating Chrome extensions — silently runs a browser with no extension
in it. The replacements are the DevTools Protocol command `Extensions.loadUnpacked`,
with Chrome started under `--enable-unsafe-extension-debugging`, or the unbranded Chrome
for Testing builds, where the switch still works.

`npm run start:chrome` is fine: web-ext takes the CDP route on its own.

## What the Chrome build does not have

`scripts/manifest.js` adapts the manifest per target, and `tests/manifest.test.js` holds
it to that. For Chrome it swaps the background page for a service worker and drops two
permissions:

| | Why |
|---|---|
| `theme` | The tab-tint indicator is Firefox-only. `theme-tint` reports itself unsupported and the settings page says so. |
| `sessions` | Only `sessions.setTabValue` is used, and it is Firefox-only. `tab-tracker` falls back to `storage.session`, which survives an extension reload but not a browser restart. Asking for `sessions` on Chrome would take the recently-closed-tabs privilege and spend it on nothing. |

See [security-notes.md](security-notes.md) for the permissions as a whole.

## The service worker

Chrome's MV3 background is a service worker: no DOM, no `window`, and it is stopped and
restarted freely. Three consequences worth keeping in mind when writing background code.

**No `matchMedia`.** Anything that needs the user's colour scheme has to get it from a
context that has one. The favicon indicator leaves `textColor` unset when it cannot tell,
and `content/favicon.js` picks the ink itself; `theme-tint` needs the API anyway and
reports itself unsupported.

**No state that matters may live only in memory.** Per-tab timers go to
`storage.session` through `tab-tracker`, settings and rules are re-read by
`watchSettings`/`watchRules` on every startup, and the tick alarm persists. Indicators
may keep caches in module scope — `action-icon`'s painted-icon cache, `inject.js`'s map
of which tabs have the content script — as long as losing one only costs a repaint.

**`runtime.onSuspend` does not fire.** The listener in `background/index.js` is a Firefox
nicety. Nothing depends on it: an indicator's `stop()` sweeps every open tab rather than
only the ones the current worker remembers painting, which is what makes a badge or a
per-tab icon removable after a restart.

## Alarms tick more slowly than you will see locally

`tickSeconds` defaults to 5, and that is what an unpacked Chrome build does — verified.
But Chrome enforces a floor of 30 seconds on alarm periods for *installed* extensions and
lifts it for unpacked ones so that debugging is bearable.

So a Web Store build is expected to tick at 30 seconds while every local test ticks at 5.
**This has not been confirmed against a packed install**, and it wants confirming before
anything is submitted: it is the kind of difference that is invisible right up until it
is shipped. If it holds, the Chrome build should floor `tickSeconds`, and the badge
countdown and `flashLeadSeconds` need to say something truthful at that granularity.

## Host permissions are granted silently

Firefox asks for `<all_urls>` at runtime and the user can refuse; Chrome grants it at
install with no prompt. Verified: `permissions.getAll()` returns `<all_urls>` the moment
the extension loads.

The panel's grant button and its warning banner are therefore dead UI on Chrome, and the
store listing carries "Read and change all your data on all websites". Moving to
`optional_host_permissions` would make Chrome behave the way Firefox does. It is the
right thing to do and it is not done: done wrong it breaks the indicators for every
Chrome user rather than degrading politely, so it wants the Chrome end-to-end suite
behind it first.

## Other differences worth knowing

- **`storage.sync` has write quotas** on Chrome — 120 a minute, 1800 an hour — and none
  on Firefox. Today's settings controls write on `change`, not on `input`, which is what
  keeps a dragged slider to one write. Anything that saves as you type would break this.
- **Incognito is off by default.** Chrome does not run extensions in incognito until the
  user allows it, and then runs them in spanning mode. `isPrivateTab` reads
  `tab.incognito`, which is the same property Firefox uses, but the path is untested.
- **Notification icons must be raster.** `notify.js` uses `icons/icon-96.png`; Chrome
  will not take the SVG.
- **`web-ext lint` is for Firefox.** Pointed at `dist/chrome` it reports the missing
  add-on id as an error and the missing data-collection key as a warning, both of which
  are rules about a manifest that is deliberately not a Firefox manifest. `npm run lint`
  lints `src/` only, which is correct. Chrome has no equivalent linter; the real checks
  are an unpacked load and the Web Store's own validation at upload.

## Testing

`npm run e2e:chrome` runs the same scenarios as the Firefox suite in a headless Chrome,
and CI runs a Chrome leg beside the Firefox ones as an advisory check. The Firefox
runner could not simply be pointed at Chrome: it reads the extension's console output
from web-ext's stdout, and Chrome has no equivalent — its logs come over CDP or not at
all. [ci/e2e.md](ci/e2e.md) covers the driver.

What the suite relies on:

- `npm run build:dev:chrome` produces `dist/chrome-dev`: the dev hook and its `dev.json`
  seeding, with the Chrome manifest.
- The dev hook recognises a dev build by its id *or* its manifest name. Chrome hands out
  an opaque id, so the name — `Timed Tabs (dev)`, written by `scripts/manifest.js` — is
  what it keys off there. Neither mark can fire in a profile that loads `src/` directly.
- `tests/e2e/scenarios/*.json` are browser-agnostic: they pin the indicators they use
  rather than relying on a default, so the Firefox-only tint never enters.

The runner needs no new dependency: Node's global `WebSocket` is enough for the handful
of CDP calls involved.

What the scenarios do not cover is still checked by hand before a release: the favicon
mark in both colour schemes, the toolbar ring, and the popup and page views.
