# Notes for the add-on reviewer

Paste this into the "Notes to reviewer" box on submission, trimmed to taste. It
explains every permission the manifest asks for and how to check the build.

---

Timed Tabs gives each tab an expiry timer and shows how much is left. Nothing leaves
the browser: there is no server, no analytics, no remote code, and the manifest
declares `data_collection_permissions: none`. Source: https://github.com/politeauthority/timed-tabs

**Permissions and why**

- `tabs`: read each tab's URL and title. URLs are matched against the user's own
  rules; titles are shown in the extension's tab list.
- `storage`: settings in `storage.sync`, rules and site groups in `storage.local`.
- `alarms`: the periodic tick that updates timers, every 5 seconds by default.
- `sessions`: `setTabValue`/`getTabValue` keep each tab's timer across extension
  reloads and session restore. Nothing else is read from sessions.
- `theme`: the optional "tint the active tab" indicator recolours the current window
  with `theme.update` and restores it on stop.
- `scripting` with `<all_urls>` host access: two optional indicators run a small
  content script in pages. `content/favicon.js` repaints the page's favicon with a
  coloured square, ring or dot, and `content/title-prefix.js` puts a coloured dot in
  front of the title. They inject on demand, only for tabs the user has not exempted,
  and they read nothing from the page beyond its icon link and title. Firefox treats
  the host permission as optional; the settings page explains what it is for and
  asks for it there.
- `notifications` (optional): a toast when a tab is closed by expiry. Requested only
  when the user turns that setting on.

**Building the zip**

`npm ci && npm run package` produces `web-ext-artifacts/timed-tabs-firefox-<version>.zip`
from `src/` with no bundling or minification; `scripts/build.mjs` only adjusts the
manifest per browser and removes a development-only block. The uploaded zip is
byte-for-byte what that command produces at the tagged commit.

**Testing**

`npm test` runs the unit tests. `npm run e2e` runs three scenarios in a headless
Firefox through `web-ext run`; the same job runs in CI for every change.
