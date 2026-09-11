import { api } from "./browser.js";
import { DEFAULT_TAB_SORT, TAB_SORTS } from "./tab-sort.js";
import { DEFAULT_FLAGS, mergeFlags } from "./flags.js";

/**
 * All user-configurable settings live here with their defaults.
 * Anything added to DEFAULTS is automatically persisted and, via FIELDS,
 * rendered on the settings page. Keep the shape flat and JSON-serialisable.
 */
export const DEFAULTS = Object.freeze({
  /**
   * The master switch. Off, Timed Tabs touches no tab at all: no timers run,
   * nothing expires, and every visible mark it made is taken back off.
   */
  tabManagement: true,
  /** Seconds a tab may stay open before it is considered expired. */
  tabLifetimeSeconds: 30 * 60,
  /** One press of Snooze adds this share of the tab's own lifetime. */
  snoozePercent: 10,
  /** Switching to a tab restarts its timer. */
  resetOnActivate: false,
  /** The active tab's clock does not run; time only counts in the background. */
  pauseWhileActive: false,
  /** Show nothing at all until a tab has used this much of its lifetime. */
  hideWhileGreen: false,
  /** Percent of the lifetime that must pass before indicators appear (with hideWhileGreen). */
  quietUntilPercent: 40,
  /** Flash the indicators when a tab is about to expire. */
  flashBeforeExpiry: true,
  /** How long before expiry the flashing starts (seconds). */
  flashLeadSeconds: 60,
  /** Which indicator strategies signal remaining time. See background/indicators. */
  indicators: ["favicon", "theme-tint", "action-icon"],
  /** How the favicon indicator draws its colour: "square" | "ring" | "dot". */
  faviconStyle: "square",
  /** What to do when a tab expires: "none" | "reload" | "close" | "discard". */
  onExpire: "none",
  /** How long closed-by-expiry tabs stay in the "Recently expired" list. */
  recentRetentionSeconds: 24 * 3600,
  /** Show a desktop notification naming each tab we close. Needs the optional `notifications` permission. */
  notifyOnExpire: false,
  /**
   * How the Tabs page orders the open-tabs list. See shared/tab-sort.js.
   * The control lives with the list it orders, not on the settings page.
   */
  tabSort: DEFAULT_TAB_SORT,
  /** Feature flags, keyed by id. See shared/flags.js for what each one does. */
  featureFlags: DEFAULT_FLAGS,
  /** Seconds between indicator refreshes. */
  tickSeconds: 5,
});

/** Settings page sections, in order. Each FIELDS entry names its group. */
export const GROUPS = [
  {
    id: "master",
    emoji: "🔌",
    title: "Timed Tabs",
    // `short` names the pill, where there is no room for a sentence.
    short: "On / off",
    help: "Whether Timed Tabs does anything to your tabs at all.",
  },
  { id: "timing", emoji: "⏳", title: "Timing", short: "Timing", help: "How long tabs live and when the clock runs." },
  { id: "expiry", emoji: "🚪", title: "When a tab expires", short: "Expiry", help: "What happens to a background tab once its time is up." },
  { id: "notifications", emoji: "🔔", title: "Notifications", short: "Notifications", help: "What Timed Tabs tells you about, and when." },
  { id: "appearance", emoji: "🎨", title: "Appearance", short: "Appearance", help: "How remaining time is shown in the browser." },
  { id: "advanced", emoji: "🔧", title: "Advanced", short: "Advanced", help: "Rarely needed." },
  { id: "flags", emoji: "🚩", title: "Feature flags", short: "Flags", help: "Work that is not finished enough to be on for everyone." },
];

/**
 * How each setting is presented. `type` is one of:
 * duration (seconds), toggle, choice ({ value, label }[]), percent, indicators,
 * flags (the feature-flag switches from shared/flags.js).
 * A percent field with `slider` is dragged rather than typed.
 * `requires` names optional permissions the panel must obtain before the
 * setting can be switched on; it is turned back off if they are ever revoked.
 */
export const FIELDS = [
  {
    key: "tabManagement",
    group: "master",
    type: "toggle",
    label: "Manage tabs",
    help: "Turn this off and Timed Tabs leaves your tabs completely alone: no timers, nothing closed, no colours or badges. Turn it back on and every tab starts its life afresh from that moment.",
  },
  {
    key: "tabLifetimeSeconds",
    group: "timing",
    type: "duration",
    label: "Tab lifetime",
    help: "How long a tab may sit before it counts as expired.",
  },
  {
    key: "snoozePercent",
    group: "timing",
    type: "percent",
    slider: true,
    label: "Snooze adds",
    help: "How much one press of Snooze grants, as a share of that tab's own lifetime.",
    min: 1,
    max: 100,
  },
  {
    key: "resetOnActivate",
    group: "timing",
    type: "toggle",
    label: "Restart the timer when you switch to a tab",
    help: "Every visit gives the tab a full lifetime again. Tabs you keep coming back to never expire.",
  },
  {
    key: "pauseWhileActive",
    group: "timing",
    type: "toggle",
    label: "Only count time while a tab is in the background",
    help: "The clock stops while you are looking at a tab and resumes when you leave it.",
  },
  {
    key: "onExpire",
    group: "expiry",
    type: "choice",
    label: "Action",
    help: "What happens once a background tab runs out of time. The tab you are viewing is never touched.",
    options: [
      { value: "none", label: "Leave it open" },
      { value: "reload", label: "Reload it, restart the timer" },
      { value: "discard", label: "Unload it" },
      { value: "close", label: "Close it" },
    ],
  },
  {
    key: "recentRetentionSeconds",
    group: "expiry",
    type: "duration",
    label: "Keep recently expired tabs for",
    help: "Tabs that Timed Tabs closed stay listed on the Tabs page for this long, so you can reopen them.",
    min: 60,
  },
  {
    key: "notifyOnExpire",
    group: "notifications",
    type: "toggle",
    label: "Tell me when a tab is closed",
    help: "A notification naming the tab, one for each batch we close. Click it to bring the tab back.",
    requires: { permissions: ["notifications"] },
  },
  {
    key: "indicators",
    group: "appearance",
    type: "indicators",
    label: "Show remaining time with",
    help: "Any combination. Colour runs green, yellow, red as time runs out.",
  },
  {
    key: "flashBeforeExpiry",
    group: "appearance",
    type: "toggle",
    label: "Flash when a tab is about to expire",
    help: "Every indicator blinks during the last stretch before a tab runs out of time.",
  },
  {
    key: "flashLeadSeconds",
    group: "appearance",
    type: "duration",
    label: "Start flashing",
    help: "How long before expiry the flashing begins.",
    min: 5,
    showWhen: (s) => s.flashBeforeExpiry,
  },
  {
    key: "hideWhileGreen",
    group: "appearance",
    type: "toggle",
    label: "Leave fresh tabs alone",
    help: "Show nothing until a tab has used part of its lifetime. Off means indicators show all the time.",
  },
  {
    key: "quietUntilPercent",
    group: "appearance",
    type: "percent",
    label: "Show indicators after",
    help: "The share of a tab's lifetime that must pass before anything is shown.",
    min: 1,
    max: 99,
    showWhen: (s) => s.hideWhileGreen,
  },
  {
    key: "faviconStyle",
    group: "appearance",
    type: "choice",
    label: "Favicon colour style",
    help: "Where the colour goes on the tab's icon.",
    options: [
      { value: "square", label: "Square behind the icon" },
      { value: "ring", label: "Ring around the icon" },
      { value: "dot", label: "Dot in the corner" },
    ],
    showWhen: (s) => s.indicators.includes("favicon"),
  },
  {
    key: "featureFlags",
    group: "flags",
    type: "flags",
    label: "Switches",
    help: "Expect rough edges.",
  },
  {
    key: "tickSeconds",
    group: "advanced",
    type: "duration",
    label: "Refresh every",
    help: "How often colours and badges update. Lower is smoother, higher is lighter on the browser.",
    min: 1,
  },
];

const STORAGE_AREA = "sync";

/**
 * A stored or imported value for `key`, or undefined when it is not one this
 * setting can hold: the wrong type, a choice not among the options, a number
 * outside the field's range. Used for backups and for what storage hands
 * back, since a value synced from another device or an older build is no
 * more trustworthy than a pasted file.
 */
export function coerceSetting(key, value) {
  const def = DEFAULTS[key];
  if (Array.isArray(def)) return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : undefined;
  // Feature flags: keep the ones this build still declares and drop the rest,
  // so a backup written either side of a flag being added or retired loads
  // without a warning and without turning anything unexpected on.
  if (key === "featureFlags") {
    return value && typeof value === "object" && !Array.isArray(value) ? mergeFlags(value) : undefined;
  }
  if (typeof def === "boolean") return typeof value === "boolean" ? value : undefined;
  const field = FIELDS.find((f) => f.key === key);
  if (typeof def === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    const min = field?.min ?? (field?.type === "percent" ? 0 : 1);
    const max = field?.max ?? (field?.type === "percent" ? 100 : Infinity);
    return value >= min && value <= max ? value : undefined;
  }
  if (typeof def === "string") {
    if (typeof value !== "string") return undefined;
    const options = key === "tabSort" ? TAB_SORTS.map((s) => s.id) : field?.options?.map((o) => o.value);
    return !options || options.includes(value) ? value : undefined;
  }
  return undefined;
}

export async function getSettings() {
  const stored = await api.storage[STORAGE_AREA].get(Object.keys(DEFAULTS));
  const out = { ...DEFAULTS };
  for (const [key, value] of Object.entries(stored)) {
    const v = coerceSetting(key, value);
    if (v !== undefined) out[key] = v;
  }
  // Flags merge key by key rather than replacing wholesale: a stored object
  // from an older build would otherwise hide every flag added since.
  out.featureFlags = mergeFlags(stored.featureFlags);
  return out;
}

export async function saveSettings(partial) {
  await api.storage[STORAGE_AREA].set(partial);
}

/** Calls `fn(settings)` now and again whenever settings change. */
export function watchSettings(fn) {
  getSettings().then(fn);
  api.storage.onChanged.addListener((_changes, area) => {
    if (area === STORAGE_AREA) getSettings().then(fn);
  });
}

/**
 * Per-URL rules live in storage.local (no per-item size limit like sync).
 * See shared/rules.js for the shape and matching.
 */
const RULES_KEY = "rules";

export async function getRules() {
  const { [RULES_KEY]: rules } = await api.storage.local.get(RULES_KEY);
  return Array.isArray(rules) ? rules : [];
}

export async function saveRules(rules) {
  await api.storage.local.set({ [RULES_KEY]: rules });
}

/** Calls `fn(rules)` now and whenever the rules change. */
export function watchRules(fn) {
  getRules().then(fn);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && RULES_KEY in changes) getRules().then(fn);
  });
}

/** Site groups live beside the rules. See shared/groups.js for the shape. */
const GROUPS_KEY = "siteGroups";

export async function getGroups() {
  const { [GROUPS_KEY]: groups } = await api.storage.local.get(GROUPS_KEY);
  return Array.isArray(groups) ? groups : [];
}

export async function saveGroups(groups) {
  await api.storage.local.set({ [GROUPS_KEY]: groups });
}

/** Calls `fn(groups)` now and whenever the groups change. */
export function watchGroups(fn) {
  getGroups().then(fn);
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && GROUPS_KEY in changes) getGroups().then(fn);
  });
}
