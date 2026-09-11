# Privacy policy

**Timed Tabs collects nothing, sends nothing, and has no server to send it to.**

There is no account, no analytics, no telemetry, no advertising, no tracking of any
kind, and no third party involved. Nothing you do in the extension is transmitted
anywhere, so there is no data of yours for anyone — including the author — to read,
share or sell.

This policy covers the Timed Tabs browser extension for Firefox and Chrome, and
nothing else.

Last updated: **11 September 2026**. Applies to Timed Tabs 0.1 and later.

## What Timed Tabs keeps, and where

Everything below lives in your own browser's extension storage, on your own machine.
None of it is transmitted.

| What | Where | Kept for | Removed by |
|---|---|---|---|
| Your settings, including feature flags | Extension **sync** storage | Until you change or clear them | Changing them, or uninstalling |
| Your rules and site groups | Extension **local** storage | Until you delete them | Deleting the rule or group, or uninstalling |
| Each tab's timer | With the tab, via the browser's `sessions` API | As long as the tab is open | Closing the tab |
| The list of tabs Timed Tabs closed | Extension **local** storage | 1 day by default, 200 entries maximum | The ✕ on a row, **Clear list**, a shorter retention, or uninstalling |

Sync storage is the one exception to "stays on this machine": if you are signed in to
a Firefox account or a Chrome profile with sync turned on, your browser syncs that
storage the way it syncs your bookmarks. That is your browser's transfer, under your
browser vendor's privacy policy, not ours. Your rules, your site groups and the list
of closed tabs are all in local storage and never sync.

### The list of closed tabs

This is the only thing Timed Tabs stores that describes your browsing. When it closes
a tab, it records that page's **address, title and icon**, the time it was closed, and
what was done to it, so you can get the tab back from **Recently expired** on the Tabs
page.

It never leaves your machine and is not included in a backup, but it does survive
restarting the browser. It is capped at 200 entries and cleared of anything older
than the retention you set — one day by default, adjustable down under Settings,
Expiry. You can delete a single row, or empty the list, at any time.

There is no switch to stop the list being kept at all. Setting the retention to its
lowest value is the closest thing; if you want a real off switch, open an issue.

### Private windows

Browsers do not run extensions in private windows unless you allow it, and Timed Tabs
is better left that way. **If you do allow it, tabs closed in a private window are
recorded in the list of closed tabs like any other**, and that record outlives the
private session. This is a known gap rather than a deliberate choice; it is noted in
[docs/developer/security-notes.md](docs/developer/security-notes.md).

In Firefox: `about:addons` → Timed Tabs → Details → "Run in Private Windows". In
Chrome: `chrome://extensions` → Timed Tabs → Details → "Allow in Incognito".

## Network activity

Timed Tabs makes no network requests. A released build contains exactly one `fetch`,
and it reads the extension's own build metadata from inside the extension package
through `runtime.getURL`. Two others exist in the source, for a development hook that
seeds a test profile; `scripts/build.mjs` strips that hook out of every release build
and fails the build if any mention of it survives. There is no remote code, and no
script or stylesheet is loaded from anywhere but the extension package.

One honest detail: the favicon indicator redraws a page's icon by loading that page's
own icon into a canvas. That is a request to a site you already have open, for a file
your browser has usually already fetched, made by the page rather than by us. Nothing
is sent with it and nothing comes back to Timed Tabs beyond the image.

## Permissions, and why each one is asked for

| Permission | What it is for |
|---|---|
| `tabs` | Read each tab's address and title, to match your rules and to name a tab in the popup. |
| `storage` | The settings, rules and lists described above. |
| `alarms` | The periodic tick that updates timers. |
| `sessions` | Keeps a tab's timer across extension reloads and session restore. Nothing else is read. |
| `theme` | The "tint the active tab" indicator recolours the window, and puts it back when stopped. |
| `scripting` and access to all sites | Two indicators — the favicon colour and the coloured dot in the title — run a small script in the page. |
| `notifications` (optional) | A desktop notice naming a tab that was closed. Asked for only when you turn that setting on, and shown by your operating system. |

**Why access to every site.** The favicon and title indicators cannot work from
outside the page, so they run a script in it. That script reads the page's existing
icon and title, so it can put them back, and writes the coloured versions. It reads
nothing else from the page, and sends nothing anywhere.

Firefox asks for this access separately and you can refuse it; Settings then shows a
notice, and the three indicators that need nothing from the page — the toolbar timer
ring, the badge, and the tab tint — keep working. Chrome currently grants it at
install without asking, which is a difference in the browsers rather than in Timed
Tabs; making Chrome ask is [an open item](docs/developer/security-notes.md).

## Backups

**Backup** exports your settings, rules and site groups as one JSON file, to a
location you choose. The list of closed tabs is not in it — no addresses, no titles.

Your rules are, though, and a rule names a site you cared enough to write a rule
about. The file is plain text. Keep it where you would keep a bookmarks export.

## Your rights over your data

There is nothing held about you to request, correct, export or erase, because nothing
is collected. What exists is on your own machine and under your own control:
**Backup** exports it, the controls above delete parts of it, and uninstalling the
extension removes all of it along with the extension.

The manifest declares this formally to Firefox as
`browser_specific_settings.gecko.data_collection_permissions: { required: ["none"] }`,
which is the strongest statement the add-on platform allows.

## Changes to this policy

If Timed Tabs ever starts doing something this document does not describe, this
document changes first, in the same release, and the date above changes with it. The
full history of this file is public in the repository, so any change can be read as a
diff.

## Contact

Questions, or something here that does not match what you observe:

**https://github.com/politeauthority/timed-tabs/issues**

For a security problem, please use private reporting instead — see
[SECURITY.md](SECURITY.md).

---

For the same ground covered as a guide rather than a policy, with screenshots and the
controls to hand, see [docs/user-guide/privacy.md](docs/user-guide/privacy.md).
