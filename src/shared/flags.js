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
    id: "new-rules-display",
    label: "New rules display",
    help: "The reworked Rules page: each rule is a row with its priority as a badge, an on/off switch, and a chip for each setting it changes. Off, the Rules page keeps the original cards.",
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
  return settings?.featureFlags?.[id] === true;
}

/** The flag another flag requires, or null. */
export function flagRequires(id) {
  return FLAGS.find((f) => f.id === id)?.requires ?? null;
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
