# 🔒 Security and privacy notes

A full audit of `main` at `08f5959` lives in `docs/personal`. This is the part worth
keeping in the repository: the properties that must not quietly break, and the gaps
that are known and still open.

## ✅ Standing guarantees

Break any of these and the extension stops being what it claims to be, so they are
worth re-checking when the surface changes:

- **No remote code.** No `eval`, no `new Function`, no `innerHTML` or its relatives
  anywhere in `src/`. Both stores require this and it is easy to reintroduce.
- **No network egress.** The only `fetch` calls take `runtime.getURL` of a file that
  ships with the extension. Adding a real request would make
  `data_collection_permissions: ["none"]` false.
- **Nothing exposed to pages.** No `web_accessible_resources`, no
  `externally_connectable`, no `content_security_policy` override.
- **Content scripts do not report back.** `src/content/*.js` read the page's icon,
  title and hostname and write the marked versions. Neither file calls
  `runtime.sendMessage`.
- **The dev hook cannot fire in a release.** It is gated on an extension id
  containing `-dev@` (or, for Chrome, a manifest name ending in `(dev)`), and
  `scripts/build.mjs` deletes `dev.json` from every target.

## 🔑 Permissions, and why each is there

| Permission | For | Notes |
|---|---|---|
| `tabs` | URL and title of every tab | What rules match on |
| `storage` | Settings, rules, the recently expired list | |
| `alarms` | The tick | |
| `scripting` | Injecting the favicon and title scripts | On demand, never declared |
| `sessions` | Persisting a tab's timer with the tab | **Firefox only**; stripped from the Chrome build |
| `theme` | The tab tint indicator | **Firefox only**; stripped from the Chrome build |
| `notifications` | Telling you a tab closed | Optional, requested when the setting is switched on |
| `<all_urls>` | The favicon and title indicators | See the open item below |

`sessions` is stripped for Chrome because only `sessions.setTabValue` is used, which
Firefox alone implements; `tab-tracker.js` falls back to `storage.session`
everywhere else. Asking for it on Chrome would take the recently-closed-tabs
privilege and spend it on nothing.

## 🗂️ What is stored

Settings go to sync storage, so they travel with a browser account. Rules and site
groups stay in local storage and do not.

The **recently expired list** is the sensitive one: address, title and icon of each
tab Timed Tabs closed, capped at 200 and pruned by `recentRetentionSeconds`. It is
never transmitted and is not part of a backup. Users can shorten the retention, drop
a row, or clear the list; `docs/user-guide/privacy.md` explains how.

**Private windows are filtered.** `recordFor` in `shared/recent.js` returns `null` for
a tab where `tab.incognito` is true, so nothing reaches the list; the decision sits in
the pure module, with tests, rather than in the background script. The notifier does
the same: a private tab is counted in the batch but carries no title and no url, so it
appears as "a private tab" and a click cannot reopen it in an ordinary window.

Rows written by builds before that change cannot be identified — nothing marked them —
so the advice for anyone who ran in private windows earlier is to clear the list once.

## 🚧 Open items

### `<all_urls>` is required rather than optional

It sits in `host_permissions`, and the browsers differ:

- **Firefox MV3** treats host permissions as opt-in at runtime, which is why
  `shared/permissions.js` and the access notice in Settings exist.
- **Chrome MV3** grants them at install without asking.

So the Chrome build takes access to every site silently while the Firefox build asks
for it. Moving to `optional_host_permissions` would make Chrome behave the way
Firefox already does, and the code is ready for it: `hasWebAccess`, `grantedOrigins`
and the grant button all handle being refused.

Not done yet. Chrome's runtime permission flow needs testing first, and a wrong move
here breaks the indicators for everyone on Chrome rather than degrading politely.

### Chrome cannot render SVG icons

Done. `icons`, `action.default_icon` and the notification `iconUrl` all point at the
PNG set, which `scripts/icons.mjs` regenerates from the geometry in
`src/shared/icon-art.js`. `icons/icon.svg` comes out of the same source and is kept
for anything that prefers vector.

## 🧰 Dependencies

`adm-zip` reaches the tree through `web-ext` and has an open advisory in every
published version. The downgrade npm suggests trades a medium severity for a high
one, so do not run `npm audit fix --force` here expecting an improvement.

Nothing in `node_modules` reaches a user: the build copies `src/` and nothing else,
and `npm audit --omit=dev` finds nothing. Stay on 0.6.0 until upstream ships a fix.
