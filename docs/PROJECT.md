# Timed Tabs

A browser extension that puts an expiry timer on every tab. As a tab gets
closer to expiring, the extension signals that to the user. The first
signal we are building is colour: the tab's background drifts from green
through yellow to red, staying dimmer on tabs that are not focused and
looking right in both light and dark system themes.

Firefox is the primary target. The code is laid out so that Chrome (and
other Chromium browsers) can be supported later with the same source tree.

## How it works

1. **Tab tracker** (`src/background/tab-tracker.js`) records when each tab
   was opened and persists that timestamp so it survives extension reloads
   and browser restarts.
2. **Tick** – an alarm fires every few seconds, the tracker computes a
   `progress` value (0 = just opened, 1 = expired) for every tab.
3. **Indicator** (`src/background/indicators/`) turns those progress values
   into something visible. Indicators are pluggable; the user picks one in
   the settings page and we can add new ones without touching the core.
4. **On expiry** the user can choose to do nothing, unload the tab, or close it.

## Indicator strategies

WebExtension APIs do not allow painting the background of an individual tab
in the tab strip, so every strategy is an approximation. The ones we plan
to try, in order:

| Strategy | Where the colour shows | Per tab? | Browsers | Notes |
|---|---|---|---|---|
| `theme-tint` | Background of the **active** tab via `browser.theme.update(windowId)` | Active tab only | Firefox | Inactive tabs stay on the frame colour, so "dimmer when unfocused" comes for free. Light/dark palettes selected with `prefers-color-scheme`. |
| `favicon` | Coloured ring or dot drawn over the page favicon | Yes | All | Needs a content script per page, does not work on privileged pages (`about:`, addons store). |
| `title-prefix` | Emoji or bar in the tab title, e.g. `🟡 Page title` | Yes | All | Cheap and obvious, but changes what the user sees in history and bookmarks. |
| `badge` | Toolbar button badge (`action.setBadgeText({ tabId })`) | Yes, but only for the active tab is visible | All | Good companion showing remaining minutes as text. |

Each strategy implements the small interface documented in
`src/background/indicators/index.js`.

## Repository layout

```
src/                     extension source, loadable directly in Firefox
  manifest.json          MV3 manifest (Firefox flavour; build adapts for Chrome)
  background/            event page: tracker, tick, indicator wiring
    indicators/          one file per indicator strategy
  content/               content scripts (favicon, title prefix)
  ui/                    popup, preferences pane and full-page view
  shared/                code used by background and UI
  _locales/              i18n strings
  icons/
scripts/build.mjs        produces dist/firefox and dist/chrome
tests/                   vitest unit tests for pure modules
docs/                    this file and any design notes
```

## Development

```
npm install
npm start            # web-ext run: launches Firefox with the extension loaded
npm run lint         # eslint + web-ext lint
npm test             # vitest
npm run build        # dist/firefox and dist/chrome
npm run package      # zip for AMO submission
```

## Todo

We will work through this list together. Tick items as they land.

### Milestone 1 – it runs
- [x] `npm install`, confirm `npm start` loads the extension in Firefox and
      the options page opens
- [x] Tab tracker: record `openedAt` on `tabs.onCreated`, seed existing tabs
      on startup, drop on `tabs.onRemoved`
- [x] Persist `openedAt` with `sessions.setTabValue` (Firefox) so it survives
      reloads; fallback to `storage.session` for Chrome
- [x] Tick: `alarms` every `tickSeconds`, compute progress for every tab,
      hand to the active indicator (check Firefox's minimum alarm period and
      whether the event page stays alive long enough)
- [x] Options page: populate the indicator dropdown from the registry, show
      only supported strategies

### Milestone 2 – colour indicator (theme-tint)
- [x] `shared/color.js`: green → yellow → red ramp as a pure function of
      progress, with unit tests
- [x] Separate light and dark palettes; pick with `matchMedia('(prefers-color-scheme: dark)')`
      in the background page and re-apply when it changes
- [x] `theme-tint`: `theme.update(windowId, …)` setting `tab_selected` for the
      active tab, `frame`/`toolbar` kept neutral so inactive tabs read dimmer
- [x] Keep text readable: choose `tab_text` / `tab_background_text` per palette
- [x] `theme.reset` on stop; user's own theme colours are layered over the
      base palette when Firefox reports any
- [ ] Decide what to do when the user runs a third-party theme (currently we
      override `tab_selected` on top of it)
- [x] Handle multiple windows (one theme update per window)

### Milestone 2b – diagnostics (done)
- [x] Diagnostics panel in settings: tick count, per-tab progress, favicon
      outcome, whether Firefox adopted the painted icon
- [x] Site-access check with a grant button in settings

### Milestone 3 – active-tab behaviour, per-tab controls, settings UI
- [x] Setting `resetOnActivate`: switching to a tab restarts its timer
- [x] Setting `pauseWhileActive`: the active tab's clock does not run; time
      only counts while a tab is in the background
- [x] `onExpire`: none / discard (`tabs.discard`) / close (`tabs.remove`)
- [x] Never expire pinned tabs or the active tab
- [x] Per-tab state persisted with the tab: timer offset/pause, snooze,
      "never expire this tab"
- [x] Popup on the toolbar button, one page with two sections:
      - **This tab** – remaining time and progress, reset, snooze (+lifetime),
        never-expire toggle. Hidden/collapsed when `pauseWhileActive` is on,
        since the active tab is always at the start of its timer then.
      - **All tabs** – lifetime, active-tab behaviour, indicators, on-expire
        action, refresh interval.
- [x] The same page serves as the preferences pane in `about:addons`
      (`options_ui`), with the "This tab" section omitted there
- [x] Proper visual design: readable in light and dark, no default-form look,
      diagnostics tucked away under a disclosure
- [x] Collapsible "All open tabs" overview across windows: remaining time,
      mini fuse, click to jump to the tab, per-tab quick toggles for timer
      on/off and restart-on-focus (per-tab override of the global setting)
- [x] "Open in a tab": the panel as a full page (`ui/panel.html?view=page`)
      with the overview expanded; reuses an already-open page tab
- [x] Panel colours derived from the live Firefox theme (`theme.getCurrent`),
      so popup, page and preferences match the chrome and custom themes;
      `prefers-color-scheme` palette as fallback

### Milestone 4 – more indicators
- [x] `favicon` overlay indicator (content script + canvas)
- [x] Favicon style setting: filled square, ring, corner dot
- [x] `title-prefix` indicator: 🟢🟡🟠🔴 in front of the page title, kept in
      place with a MutationObserver; shared injector with the favicon script
- [x] `badge` indicator with minutes remaining on the toolbar button
- [x] Allow combining indicators (list instead of single value in settings)
- [x] `hideWhileGreen`: no visible change at all while a tab is under 40% of
      its lifetime; every indicator honours the `quiet` flag

### Milestone 5 – polish and other browsers
- [ ] Verify `npm run start:chrome` works with the service worker background
- [ ] Per-site lifetime overrides
- [ ] Localisation of the options page
- [ ] Proper raster icons (16/32/48/96/128) alongside the SVG
- [ ] AMO listing text and screenshots, `npm run package`
- [ ] CI: lint + test on push
