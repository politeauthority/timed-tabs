// Pin the toolbar button in a kept Firefox profile.
//
// A browser action does not land on the toolbar by itself. Firefox puts a new
// extension button in the unified extensions panel -- the puzzle piece -- and
// a throwaway profile is new every run, so the button the whole indicator is
// about is never where a user would see it.
//
// Seeding `browser.uiCustomization.state` on a fresh profile does not work:
// the widget does not exist when CustomizableUI starts (a temporary add-on
// loads after startup), so the placement is discarded and the button is
// auto-placed in the panel anyway. What does work is a profile that has been
// through one run: the widget is then in `seen`, and a placement naming it is
// honoured on every run after.
//
// So this is two-phase, and it says which phase it is in. Run it, run the
// browser, run it again -- or pin the button by hand the first time, which
// amounts to the same thing and sticks just as well.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Firefox's widget id for a browser action: the add-on id, tamed. */
const widgetId = (addonId) => `${addonId.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}-browser-action`;

const WIDGETS = ["timed-tabs@alixfullerton", "timed-tabs-dev@alixfullerton"].map(widgetId);
const PREF = "browser.uiCustomization.state";

const profile = process.argv[2];
if (!profile) {
  console.error("usage: node scripts/dev-profile.mjs <profile-dir>");
  process.exit(2);
}
mkdirSync(profile, { recursive: true });

const prefsPath = join(profile, "prefs.js");
if (!existsSync(prefsPath)) {
  console.log(`${profile}: new profile. Firefox has to run once before the button can be`);
  console.log("placed, so this run puts it in the extensions panel (the puzzle piece).");
  console.log("Pin it from there, or quit and run this again to pin it for you.");
  process.exit(0);
}

const prefs = readFileSync(prefsPath, "utf8");
const match = prefs.match(new RegExp(`user_pref\\("${PREF.replace(/\./g, "\\.")}", (".*?")\\);`, "s"));
if (!match) {
  console.log(`${profile}: no ${PREF} yet; run Firefox once more.`);
  process.exit(0);
}

const state = JSON.parse(JSON.parse(match[1]));
const nav = state.placements?.["nav-bar"];
if (!Array.isArray(nav)) {
  console.log(`${profile}: no nav-bar placements to edit; leaving it alone.`);
  process.exit(0);
}
if (WIDGETS.every((w) => nav.includes(w))) {
  console.log(`${profile}: already pinned.`);
  process.exit(0);
}

// Out of the panel, and into the toolbar just before the panel's own button.
for (const area of Object.keys(state.placements)) {
  if (area === "nav-bar") continue;
  state.placements[area] = state.placements[area].filter((w) => !WIDGETS.includes(w));
}
const rest = nav.filter((w) => !WIDGETS.includes(w));
const at = rest.indexOf("unified-extensions-button");
state.placements["nav-bar"] = at === -1 ? [...rest, ...WIDGETS] : [...rest.slice(0, at), ...WIDGETS, ...rest.slice(at)];
state.seen = [...new Set([...(state.seen ?? []), ...WIDGETS])];

writeFileSync(
  prefsPath,
  prefs.slice(0, match.index) +
    `user_pref("${PREF}", ${JSON.stringify(JSON.stringify(state))});` +
    prefs.slice(match.index + match[0].length),
);
console.log(`${profile}: pinned to the toolbar. It stays pinned for every later run.`);
