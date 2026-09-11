/**
 * The manifest each build target ships, derived from src/manifest.json.
 *
 * This lives apart from build.mjs because it is the one part of the build that
 * makes a promise about what the extension may do: which permissions the Chrome
 * build asks the user for is a security claim, written down in
 * docs/developer/security-notes.md, and a claim nothing exercises is a claim
 * waiting to drift. tests/manifest.test.js exercises it.
 *
 * A target is a browser flavour plus whether it is a development build:
 *
 *   firefox      the Firefox release build; src/manifest.json as written
 *   chrome       the Chrome release build
 *   dev          Firefox, seeded and separately installable
 *   chrome-dev   Chrome, the same
 *
 * The two dev targets exist so the same scenario can be run in either browser.
 * They differ from their release counterparts only in identity: a distinct id
 * and a name that says so, which is what the background's dev hook keys off.
 */

/** @type {Record<string, { browser: "firefox" | "chrome", dev: boolean }>} */
export const TARGETS = {
  firefox: { browser: "firefox", dev: false },
  chrome: { browser: "chrome", dev: false },
  dev: { browser: "firefox", dev: true },
  "chrome-dev": { browser: "chrome", dev: true },
};

export const TARGET_NAMES = Object.keys(TARGETS);

/** The Firefox add-on id a dev build installs under, kept apart from the real one. */
export const DEV_GECKO_ID = "timed-tabs-dev@alixfullerton";

/**
 * The extension's name per channel. A dev build must be recognisable from the
 * manifest alone: Chrome hands out an opaque id, so the id check that marks a
 * Firefox dev build has nothing to look at, and the name is what both browsers
 * can agree on. See the dev gate in src/background/index.js.
 */
export const CHANNEL_NAMES = {
  beta: "Timed Tabs Beta",
  dev: "Timed Tabs (dev)",
};

/**
 * `base` adapted for one target. Pure: no I/O, no mutation of `base`.
 *
 * @param {object} base      parsed src/manifest.json
 * @param {string} target    a key of TARGETS
 * @param {string} [channel] "beta", "dev", or "" for a plain release
 */
export function adaptManifest(base, target, channel = "") {
  const spec = TARGETS[target];
  if (!spec) throw new Error(`Unknown target "${target}". Use ${TARGET_NAMES.join(", ")}.`);

  const m = structuredClone(base);

  if (spec.dev) {
    // A distinct id keeps the dev build's storage separate and is what the
    // background checks before reading dev.json. Chrome has no equivalent —
    // it derives the id from the key or the path — so the name below is what
    // the dev hook has to recognise there.
    m.browser_specific_settings.gecko.id = DEV_GECKO_ID;
  }

  if (channel) {
    const name = CHANNEL_NAMES[channel];
    if (!name) throw new Error(`Unknown channel "${channel}". Use beta or dev, or leave it unset.`);
    // A beta keeps the stable build's id: it replaces that install and, once
    // builds are signed, beta testers update to the next stable. The name says
    // beta wherever the browser shows it.
    m.name = name;
    m.action.default_title = name;
  }

  if (spec.browser === "chrome") {
    // Chrome MV3 requires a service worker and has no dynamic theme API.
    // `sessions` goes too: only setTabValue is used, which is Firefox-only, and
    // tab-tracker falls back to storage.session everywhere else. Asking for it
    // on Chrome would take the recently-closed-tabs privilege and spend it on
    // nothing. See docs/developer/security-notes.md.
    m.background = { service_worker: "background/index.js", type: "module" };
    delete m.browser_specific_settings;
    m.permissions = m.permissions.filter((p) => !["theme", "sessions"].includes(p));
  }

  return m;
}
