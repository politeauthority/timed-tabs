# Feature flags

Some parts of Timed Tabs work well enough to use but are not finished enough to be on
for everyone. They sit behind feature flags: switches you turn on yourself, under
Settings, Advanced, Feature flags.

> 🚧 Expect rough edges. What a flag does, and what its screens look like, can change
> between builds — and a flag can be withdrawn once the work behind it lands properly
> or is abandoned. Nothing you set while a flag was on is lost when it goes; see
> [🧹 When a flag goes away](#-when-a-flag-goes-away).

## 🔑 Turning one on

Every beta feature needs **two** switches on: **Beta features**, which is the master
switch, and the feature's own switch below it. On its own, neither does anything.

1. Open **Full page** from the popup header, then **Settings**.
2. Scroll to **Advanced**, and find **Feature flags**.
3. Turn on **Beta features**.
4. Turn on the feature you want.

The master switch exists so you can put every beta back in its box with one click
without losing track of which ones you had chosen. Turning **Beta features** off
leaves the individual switches as they were; turning it back on restores exactly the
set you had.

Flags are stored with the rest of your settings, which means they follow the
browser's extension storage sync and travel in a **Backup** like any other setting.
A backup written before a flag existed loads without complaint — the flag simply
reads as off.

## 🚩 The flags

### Beta features

The master switch described above. It changes nothing on its own.

### Page settings in the popup

Adds a **Page settings** section to the popup, between the timer and the list of
rules. It shows what is actually in force on the page in front of you — the lifetime,
what happens when it expires, and anything a rule has changed — and lets this tab
take any of them over.

A setting you change here is set **on this tab only, until it closes**. Such a row is
marked `this tab`; click that marker to hand the setting back to your rules and
defaults, or use **Reset this tab** to hand back every one at once.

The section lists only what something has changed on this page, plus the lifetime and
restart-on-focus, which the popup always answers. Everything else is at your defaults
and lives on the Settings page.

### Site groups

Name a list of sites once and point rules at the whole list: a `news` group can hold
every news site you read, and one rule covers them all. Adds a **Site groups**
section to the Rules page, and a group picker beside each rule's pattern field.

[features.md](features.md#-site-groups) covers groups in full, with an example.

One thing to know before you turn it off again: **while the flag is off, rules that
target a group match nothing**. The rules are still there and their cards say so, but
they stop applying. If a group rule is the only thing keeping a site's tabs short,
turning the flag off silently gives those tabs your default lifetime instead.

## 🧹 When a flag goes away

A flag is temporary by nature. When the work behind it is finished, the feature
becomes an ordinary part of Timed Tabs and the flag disappears; when it is abandoned,
the flag disappears too.

Either way nothing breaks. A flag this build does not recognise reads as off, and is
dropped the next time your settings are saved. Backups written on either side of that
change load without warning.

---

Back to the [user guide](README.md), or the full tour in
[features.md](features.md).
