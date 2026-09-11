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
 * Pure, so none of this needs a browser to test.
 */

/** Every flag this build knows about, in the order the settings page lists them. */
export const FLAGS = [
  {
    id: "beta-features",
    label: "Beta features",
    help: "Turn on parts of Timed Tabs that are still settling down. Right now: the Page settings section in the popup, which lists every setting in force on the page and lets this tab take any of them over.",
    default: false,
  },
  {
    id: "site-groups",
    label: "Site groups",
    help: "Name a list of sites once and point rules at it: a \"news\" group can hold every news site, and one rule covers them all. Adds a Site groups section to the Rules page. While this is off, rules that target a group match nothing.",
    default: false,
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

/** True when a flag is on. An id this build does not know is off, not an error. */
export function flagOn(settings, id) {
  return settings?.featureFlags?.[id] === true;
}
