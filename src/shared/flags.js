/**
 * Feature flags: switches for work that is finished enough to use but not
 * finished enough to be on for everyone. They live with the other settings, so
 * they sync and are carried in a backup like anything else.
 *
 * A flag is only ever read through `flagOn`, and an id nobody declares any more
 * reads as off. That is the whole contract for retiring one: delete its entry
 * here and every read still answers, every stored value is dropped the next
 * time settings are saved, and nothing throws. Backups written before the flag
 * existed, or after it was retired, load without complaint.
 *
 * A flag may `require` another: it only counts as on while that one is on
 * too, which lets "Beta features" act as a master switch. Read a feature
 * through `featureOn`, which follows the chain; `flagOn` is the raw switch.
 *
 * Pure, so none of this needs a browser to test.
 */

/** Every flag this build knows about, in the order the settings page lists them. */
export const FLAGS = [
  {
    id: "beta-features",
    label: "Beta features",
    help: "The master switch for parts of Timed Tabs that are still settling down. Each beta feature below also has its own switch, and needs both to be on.",
    default: false,
  },
  {
    id: "mini-ui-page-settings",
    label: "Page settings in the popup",
    help: "A Page settings section in the popup that lists every setting in force on the page and lets this tab take any of them over.",
    default: false,
    requires: "beta-features",
  },
  {
    id: "site-groups",
    label: "Site groups",
    help: "Name a list of sites once and point rules at it: a \"news\" group can hold every news site, and one rule covers them all. Adds a Site groups section to the Rules page. While this is off, rules that target a group match nothing.",
    default: false,
    requires: "beta-features",
  },
  {
    id: "statistics-panel",
    label: "Statistics",
    help: "A Statistics section on the Tabs page: how many tabs have run out of time and how, a chart of the last fortnight, snoozes, restarts and the most tabs you have had open at once. The counting happens either way — this switch only decides whether the section is there to read, so turning it off loses nothing and turning it back on shows the whole tally.",
    default: false,
    requires: "beta-features",
  },
  {
    id: "primary-icon-interactive",
    label: "Interactive toolbar clock",
    help: "The toolbar button stops being a ring and becomes a clock face that empties as the tab you are on runs out of time, with a look of its own for a paused clock and for a tab that never expires. It follows the tab you are looking at rather than painting every tab.",
    default: false,
    requires: "beta-features",
  },
];

/** The shape a fresh profile starts with. */
export const DEFAULT_FLAGS = Object.freeze(
  Object.fromEntries(FLAGS.map((f) => [f.id, f.default])),
);

/**
 * Stored flags laid over the defaults, keeping only ids this build declares.
 * A value of the wrong type falls back to the flag's default rather than
 * failing, since a flag is a switch and anything else is meaningless.
 */
export function mergeFlags(stored) {
  const out = {};
  for (const flag of FLAGS) {
    const value = stored?.[flag.id];
    out[flag.id] = typeof value === "boolean" ? value : flag.default;
  }
  return out;
}

/** True when a flag's own switch is on. An id this build does not know is off, not an error. */
export function flagOn(settings, id) {
  return FLAGS.some((f) => f.id === id) && settings?.featureFlags?.[id] === true;
}

/** The flag another flag requires, or null. */
export function flagRequires(id) {
  return FLAGS.find((f) => f.id === id)?.requires ?? null;
}

/**
 * True for a flag that exists only to gate others, which is to say one some
 * other flag requires. "Beta features" is the one today: on its own it changes
 * nothing you can see, so it is not something to tell anyone is on.
 *
 * Derived rather than declared, so a second gate added later needs no list
 * keeping up to date.
 */
export function isGate(id) {
  return FLAGS.some((f) => f.requires === id);
}

/**
 * The features in force, in the order the settings page lists them: every flag
 * that is on, that something can actually be seen from, and whose gates are on
 * too. This is what the UI names when it says why it does not match the docs.
 *
 * Empty when "Beta features" is on but nothing under it is, which is the case
 * worth getting right: the master switch alone changes nothing, so saying so
 * would be telling the user about a difference that is not there.
 */
export function activeFeatures(settings) {
  return FLAGS.filter((f) => !isGate(f.id) && featureOn(settings, f.id));
}

/**
 * True when a feature is in force: its flag is on, and so is every flag it
 * requires, all the way up. This is the read the UI and background use.
 */
export function featureOn(settings, id, seen = new Set()) {
  if (!flagOn(settings, id) || seen.has(id)) return false;
  const parent = flagRequires(id);
  if (!parent) return true;
  seen.add(id);
  return featureOn(settings, parent, seen);
}
