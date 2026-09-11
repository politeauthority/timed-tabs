# Timed Tabs

[![CI](https://github.com/politeauthority/timed-tabs/actions/workflows/ci.yaml/badge.svg)](https://github.com/politeauthority/timed-tabs/actions/workflows/ci.yaml)
[![Manifest V3](https://img.shields.io/badge/manifest-v3-blue)](src/manifest.json)
[![Firefox 140+](https://img.shields.io/badge/Firefox-140%2B-FF7139?logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Data collected: none](https://img.shields.io/badge/data%20collected-none-success)](src/manifest.json)

<!-- Restore once this repo is public. shields.io reads the GitHub API from its
     own servers, so it renders "repo not found" for a private repo no matter
     who is looking. Nothing to do with an AMO listing; the releases exist.
[![Release](https://img.shields.io/github/v/release/politeauthority/timed-tabs?label=release&color=44cc11)](https://github.com/politeauthority/timed-tabs/releases/latest)
-->

**Tabs that expire.** Every tab gets a lifetime. Its icon goes green, then yellow,
then red as the clock runs down, and at zero the tab can close itself.

That tab you opened on Tuesday and swore you'd read? It's red now.

![The tabs view, listing every open tab with a colour bar and the time it has left](assets/screenshots/tabs.png)

## Install

No store listing yet. Grab a zip from [Releases](https://github.com/politeauthority/timed-tabs/releases/latest):

- **Firefox 140+** (Android 142+) — `timed-tabs-firefox-*.zip`, then `about:debugging` → This Firefox → Load Temporary Add-on
- **Chrome** — unzip `timed-tabs-chrome-*.zip`, then `chrome://extensions` → Developer mode → Load unpacked

## What you get

- **Four ways to show the time left.** The favicon, a coloured dot in the page
  title, the toolbar badge, or a tint over the Firefox theme. Pick any of them.
- **Per-site rules.** Docs get an hour, news gets fifteen minutes, work repos
  never expire. Higher priority wins.
- **Your call at zero.** Leave the tab, reload it, discard it, or close it.
- **The clock can pause** while you're looking at a tab, and restart from the top
  when you come back to it.
- **Nothing leaves the browser.** The manifest declares no data collection, and
  there is no server to talk to.

![The rules view, with per-site patterns and the lifetime each one sets](assets/screenshots/rules.png)

## Build it yourself

```sh
npm install
npm start            # Firefox, with the extension loaded
npm test
npm run package      # -> web-ext-artifacts/timed-tabs-{firefox,chrome}-<version>.zip
```
