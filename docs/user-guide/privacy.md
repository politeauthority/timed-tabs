# 🔒 Privacy

Timed Tabs works entirely inside your browser. There is no account, no server, and
nothing is sent anywhere.

This page is the guided tour, with the controls to hand. The formal statement, for
anyone who needs one, is the [privacy policy](../../PRIVACY.md).

## 📋 What is kept, and where

| What | Where | Leaves your machine? |
|---|---|---|
| Settings | Browser extension sync storage | Only through your own browser account sync |
| Rules and site groups | Local storage | No |
| Each tab's timer | With the tab, for as long as it is open | No |
| **Recently expired tabs** | Local storage | No |

## 🕯️ The recently expired list

When Timed Tabs closes a tab, it keeps a record so you can get the tab back: the
page's **address, title and icon**, plus when it was closed. The Tabs page lists them
under **Recently expired**.

That record is a list of pages you had open, stored on disk. It is never sent
anywhere and it is not included in a backup, but it does survive closing the browser,
so it is worth deciding how long you want it.

Three controls, all on the Tabs page or in Settings:

- **Keep recently expired tabs for** — Settings, under 🚪 Expiry. Anything older is
  dropped. One day by default; set it to an hour if you only ever reopen things you
  closed a moment ago.
- **Remove one row** — the ✕ on any row in the Recently expired list.
- **Clear list** — the button at the foot of that list empties it now.

At most 200 tabs are kept whatever you choose, so the oldest fall off on a busy day.

If you would rather no record were kept at all, set the retention as low as it goes.
There is no switch to turn the list off entirely; if you want one, say so on the
issue tracker.

## 🕵️ Private windows

Browsers do not run extensions in private windows unless you allow it. Timed Tabs is
no exception, and **leaving it that way is the safest choice**: a tab closed in a
private window would otherwise be recorded in the recently expired list like any
other, and that record outlives the private session.

In Firefox, the setting is in `about:addons` → Timed Tabs → Details → "Run in Private
Windows". In Chrome it is on `chrome://extensions` → Timed Tabs → Details → "Allow in
Incognito".

## 🌐 Why it asks for access to every site

Two of the ways Timed Tabs shows remaining time — colouring the favicon, and the
coloured dot in the tab title — work by running a small script in the page to change
its icon or its title. That needs permission for the sites you visit.

The script reads the page's existing icon and title so it can put them back, and
writes the coloured versions. It sends nothing back, and nothing about the page is
stored or transmitted.

Firefox asks for this permission separately, so you can refuse it. If you do, the
three indicators that need nothing from the page still work: the timer ring on the
toolbar button, the badge, and the tint on the active tab. Settings shows a notice
when access is off.

## 📦 Backups

**Backup** on its own page exports every setting and every rule as one JSON file.
What you have been reading is not in there — no addresses of closed tabs, no titles.

The rules are, though, and a rule is a site you cared enough to write a rule about.
The file is plain text. Keep it somewhere you would keep a bookmarks export.
