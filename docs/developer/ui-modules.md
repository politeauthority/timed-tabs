# The panel's modules

`src/ui/panel.html` is one page serving three contexts: the toolbar popup, the full page
(`?view=page`) and the preferences pane (`options.html`, the same file with a different
`data-context`). It loads one script, `panel.js`, which is the wire-up: it imports the
modules below, fills the hooks, registers the storage watchers and the router, and runs
the start-up sequence. Everything a user sees is drawn by one of the modules.

Each module owns a section of the page and the listeners on it. A module imports what it
needs from `shared/`, from `state.js` and `dom.js`, and from the modules beneath it in the
list; nothing imports `panel.js`. Two modules never import each other: where a section has
to call across a seam (a flag toggled on the Settings page redraws the Rules page, a rule
saved on the Rules page refreshes the Tabs page), it calls through `hooks.js`, which
`panel.js` fills once every module is loaded.

| Module | Owns |
| --- | --- |
| `state.js` | What the sections share: the stored settings and the page's unsaved draft, the rules, the site groups, the popup's tab and its state, the `popup`/`page`/`options` context, and the editor's pending intent (seed pattern, row to focus). One object; a section reads and writes `state.rules`, never another module's `let`. |
| `dom.js` | Helpers every section uses and none owns: `$`, sprite icons, the setting row, the switch, the slide that shows and hides a governed row, the "Saved" mark, the wildcard painter. |
| `hooks.js` | The calls that cross seams: `route`, `renderFlagged`, `refreshOverview`, `refreshTab`, `renderFields`, `refreshStats`. Empty functions until `panel.js` assigns the real ones. |
| `feedback.js` | The toasts, and the one place a storage error becomes words (`write`). |
| `theme.js` | The browser theme read into CSS variables. |
| `folds.js` | Fold state for `<details>` sections, remembered in localStorage. |
| `permissions.js` | Asking for an optional permission from a click. |
| `pages.js` | Opening the full page from the popup; the title link home. |
| `rule-text.js` | How a rule's fields are worded: labels and help with placeholders, chip text, the emoji per field. Pure. |
| `overrides.js` | Override rows (a setting a rule or a tab may take over) and the lead control. Used by the rule editor and the popup's page settings. |
| `settings-page.js` | The Settings page: groups and pills, every field, staging and the save bar, `save` for the few controls that store at once, the site-access warning. |
| `backup.js` | The Backup pill. |
| `diagnostics.js` | The Diagnostics fold. |
| `popup.js` | This tab: readout and fuse, the actions, why a page is left alone, rules for this page, page settings. |
| `tabs-page.js` | All open tabs, recently expired, statistics; `startTabsPage`/`stopTabsPage` for the polling while the page is shown. |
| `rules-list.js` | The Rules page list and rows, the filter, Add rule, delete, site groups, and the drafts the editor keeps between visits. |
| `rule-editor.js` | One rule on its own page: the draft, unsaved marks, the open tabs it catches, the save bar; `startEditorPage`/`stopEditorPage`. |
| `rule-test.js` | The Rule test page. |
| `flags-note.js` | The beta note and badge, and the way to the switches. |
| `panel.js` | Routing (`#tabs`, `#rules`, `#settings`, `#rule-<id>`, `#test`), `onPageShown`, the storage watchers, `renderFlagged`, the version badge, start-up, and the dev-only UI replay. |

## Adding to a page

Put the code in the module that owns the section. A new element's listener goes in the
same module, next to the function that draws it. If the new code has to redraw another
section, call the hook rather than importing that section's module; if there is no hook
for it yet, add one to `hooks.js` and assign it in `panel.js`.

Module-level `let`s are private to their module. State two modules both write goes in
`state.js`. ESLint's `no-import-assign` rule enforces this: assigning to an imported
binding is an error.

## Why the seams are where they are

The split follows the section markers `panel.js` had when it was one 4,200-line file, so
a feature that touches one page edits one module and two features on different pages do
not collide. The move was mechanical: every declaration kept its name and body, and the
six page captures matched the previous build pixel for pixel.

## The stylesheet

`panel.css` is a list of `@import` lines, one per section, in the order the sections
had when it was one file, so the cascade is unchanged. The files live in `src/ui/css/`
with a number prefix that is that order: tokens, base, controls, header, section
headers, popup, lists, settings, rules page, rules rows, backup, feedback, toasts,
version, motion, statistics, rule editor, rule test. Add to a section in its file; a new
section is a new file and a new import line, placed where it belongs in the cascade.
The options page shares the stylesheet unchanged.
