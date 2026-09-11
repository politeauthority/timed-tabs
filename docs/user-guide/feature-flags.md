# Feature flags

Some parts of Timed Tabs work well enough to use but are not finished enough to be on
for everyone. They sit behind feature flags: switches you turn on yourself, under
Settings, Feature flags.

> 🚧 Expect rough edges. What a flag does, and what its screens look like, can change
> between builds — and a flag can be withdrawn once the work behind it lands properly
> or is abandoned. Nothing you set while a flag was on is lost when it goes; see
> [🧹 When a flag goes away](#-when-a-flag-goes-away).

## 🔑 Turning one on

Every beta feature needs **two** switches on: **Beta features**, which is the master
switch, and the feature's own switch below it. On its own, neither does anything.
The individual switches only appear once the master switch is on.

1. Open **Full page** from the popup header, then **Settings**.
2. Pick the **Flags** pill.
3. Turn on **Beta features**. The list of beta features appears beneath it.
4. Turn on the feature you want.

The master switch exists so you can put every beta back in its box with one click
without losing track of which ones you had chosen. Turning **Beta features** off
hides the individual switches but leaves them as they were; turning it back on
shows exactly the set you had.

## 🚩 Knowing one is on

While any beta feature is on, a line at the foot of the popup and of every page names
which ones — `2 beta features on: Site groups, Statistics` — with **Change** to
go straight back to the switches. It is there so that a screen which no longer matches
this guide explains itself, rather than leaving you to wonder which switch did it.

It counts features, not switches: **Beta features** on its own changes nothing you can
see, so on its own it says nothing.

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

A setting you change here is set **on this tab only, until it closes**. Such a row
gets a green dot before its label; click the dot to hand the setting back to your
rules and defaults, or use **Reset this tab** in the section's heading to hand back
every one at once.

The section lists what something has changed on this page, plus the lifetime and
restart-on-focus, which the popup always answers. Once a row is on screen it stays
for as long as the tab is open, so handing a setting back never makes the list jump.
Everything else is at your defaults and lives on the Settings page.

Both this section and **Rules for this page** fold away with the chevron beside
their heading, and each tab remembers the folds until it closes.

### Site groups

Name a list of sites once and point rules at the whole list: a `news` group can hold
every news site you read, and one rule covers them all. Adds a **Site groups**
section to the Rules page, and a group picker beside each rule's pattern field.

[features.md](features.md#-site-groups) covers groups in full, with an example.

One thing to know before you turn it off again: **while the flag is off, rules that
target a group match nothing**. The rules are still there and their cards say so, but
they stop applying. If a group rule is the only thing keeping a site's tabs short,
turning the flag off silently gives those tabs your default lifetime instead.

### Statistics

Adds a **Statistics** section to the Tabs page, below **Recently expired**: how many
tabs have run out of time and how each one ended, a chart of the last fortnight a day
at a time, your snoozes and the time they granted, timers you have restarted by hand,
and the most tabs you have had open at once.

**The counting does not depend on this switch.** Timed Tabs keeps its tally whether
the flag is on or off, so turning it off loses nothing and turning it back on shows
everything that happened in between, not a fresh start. What the flag decides is
whether the section is there to read.

Two things follow from that, both worth knowing before you leave it off:

- **Clear statistics** lives inside the section, so while the flag is off there is no
  way to empty the tally from the UI. Turn the flag on, clear it, turn it back off.
- The tally is counts and dates only — never an address, a title or anything about a
  particular tab — so there is nothing in it to leak whether you are reading it or
  not. [privacy.md](privacy.md#-statistics) sets out exactly what it holds.

### Interactive toolbar clock

Changes what the Timed Tabs button draws. Normally it is a ring that drains
clockwise from twelve as the tab you are on runs out of time. With this on, the
clock face itself empties: a full face is a tab with all its time ahead of it, a
sliver is one about to go, and the hands are cut out of the face so it still
reads as a clock rather than a pie chart.

It also gains two looks the ring has no way to show:

- **A stopped clock.** The face freezes where it stopped and the hands give way
  to a pause bar, in slate rather than a colour off the green-to-red ramp. You
  will see this on the tab you are using if you have **Only count time while a
  tab is in the background** on — the button now says so, instead of showing a
  timer that looks stuck.
- **A tab that will never expire**, pinned or set that way by hand: a hollow
  blue rim with nothing draining inside it.

One more difference: the button follows the tab you are looking at. Normally
every tab carries its own painted button, which you only ever see one of
anyway; with this on, only the active tab is painted.

This is the **Timer ring on the toolbar button** indicator either way — the same
entry under **Show remaining time with** turns it on and off, and turning the
flag off puts the ring straight back.

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
