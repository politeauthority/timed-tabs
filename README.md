# Timed Tabs
[![Beta](https://img.shields.io/badge/status-beta-F5A623)](https://github.com/politeauthority/timed-tabs/releases)
[![CI](https://github.com/politeauthority/timed-tabs/actions/workflows/ci.yaml/badge.svg)](https://github.com/politeauthority/timed-tabs/actions/workflows/ci.yaml)
[![Licence: GPL v3](https://img.shields.io/badge/licence-GPLv3-blue)](LICENSE)


[![Manifest V3](https://img.shields.io/badge/manifest-v3-blue)](src/manifest.json)
[![Firefox 140+](https://img.shields.io/badge/Firefox-140%2B-FF7139?logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)
[![Chrome](https://img.shields.io/badge/Chrome-supported-4285F4?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
[![Data collected: none](https://img.shields.io/badge/data%20collected-none-success)](src/manifest.json)

**Tabs that expire.** Every tab gets a lifetime. Its icon goes green, then yellow,
then red as the clock runs down, and at zero the tab can close itself.

That tab you opened on Tuesday and swore you'd read? It's red now.

## ✨ What you get

- 🎨 **Four ways to show the time left.** The favicon, a coloured dot in the page
  title, the toolbar badge, or a tint over the Firefox theme. Pick any of them.
- 📋 **Per-site rules.** Docs get an hour, news gets fifteen minutes, work repos
  never expire. Higher priority wins.
- ⏱️ **Your call at zero.** Leave the tab, reload it, discard it, or close it.
- ⏸️ **The clock can pause** while you're looking at a tab, and restart from the top
  when you come back to it.
- 🔒 **Nothing leaves the browser.** No collection, no tracking, no server to talk to;
  the manifest declares it and the [privacy policy](PRIVACY.md) spells it out. [What
  is kept on your machine](docs/user-guide/privacy.md), and how to control it.

The full list, with screenshots, is in the user guide:
[docs/user-guide/features.md](docs/user-guide/features.md).

## 📦 Install

> [!WARNING]
> 🚧 **Timed Tabs is in beta.** Every release is a snapshot of `main`, published as a
> [pre-release](https://github.com/politeauthority/timed-tabs/releases). There is no
> store listing yet, so installing means loading the extension yourself — see

No store listing yet, and while the project is in development every release is a
beta. Grab a zip from the newest pre-release under
[Releases](https://github.com/politeauthority/timed-tabs/releases):

- 🦊 **Firefox 140+** — `timed-tabs-firefox-*.zip`, then `about:debugging` → This Firefox → Load Temporary Add-on
- 🌐 **Chrome** — unzip `timed-tabs-chrome-*.zip`, then `chrome://extensions` → Developer mode → Load unpacked

### 🚧 Betas

Betas are snapshots of `main`, published as
[pre-releases](https://github.com/politeauthority/timed-tabs/releases). A beta shows
a yellow BETA badge beside the title, and `about:addons` lists it as "Timed Tabs
Beta". Details in [docs/developer/ci/releasing.md](docs/developer/ci/releasing.md).

## 📚 Documentation

- 📖 [User guide](docs/user-guide/) — [features](docs/user-guide/features.md),
  [feature flags](docs/user-guide/feature-flags.md) and
  [privacy](docs/user-guide/privacy.md).
- 🔒 [Privacy policy](PRIVACY.md) — what is stored, what is never sent, and why each
  permission is asked for.
- 🔧 [Developer docs](docs/developer/) — [build it
  yourself](docs/developer/building.md), tests and security notes, plus
  [ci/](docs/developer/ci/) for the workflows, the runner and releases.
- 🛣️ [Road map](docs/road-map.md) — what is not there yet.
