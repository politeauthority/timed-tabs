import { api } from "./browser.js";
import { DEFAULT_TAB_SORT, TAB_SORTS } from "./tab-sort.js";
import { DEFAULT_FLAGS, mergeFlags } from "./flags.js";
import { parseLead, formatLead, leadFromElapsedPercent } from "./lead.js";

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
  /**
   * Narrows the master switch to the pages you have written a rule for.
   * On, a tab no rule matches is left alone exactly as if Timed Tabs were
   * switched off, and the toolbar button says so with an empty clock.
   */
  requireRuleMatch: false,
  /** Seconds a tab may stay open before it is considered expired. */
  tabLifetimeSeconds: 30 * 60,
  /** One press of Snooze adds this share of the tab's own lifetime. */
  snoozePercent: 10,
  /** Switching to a tab restarts its timer. */
  resetOnActivate: false,
  /** The active tab's clock does not run; time only counts in the background. */
  pauseWhileActive: false,
  /** No display changes on a tab until it is close enough to expiring (see quietStart). */
  hideWhileGreen: false,
  /**
   * With hideWhileGreen, how close: a lead measured back from expiry, either
   * an amount of time ("600s") or a share of the lifetime ("60%"). See
   * shared/lead.js. Replaces `quietUntilPercent`, which counted the other way.
   */
  quietStart: "60%",
  /** Flash the indicators before a tab expires. */
  flashBeforeExpiry: true,
  /**
   * How far before expiry the flashing starts: a lead like quietStart, an
   * amount ("60s") or a share of the lifetime ("10%"). Replaces the
   * seconds-only `flashLeadSeconds`.
   */
  flashLead: "60s",
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

/**
 * Settings page groups, in order: one pill each. Each FIELDS entry names its
 * group. A group may split into `sections`, headed subgroups within the one
 * tab; a FIELDS entry in such a group names its section too.
 */
export const GROUPS = [
  {
    id: "general",
    emoji: "⚙️",
    title: "General",
    // `short` names the pill, where there is no room for a sentence.
    short: "General",
    help: "Whether Timed Tabs does anything to your tabs, and which tabs it does it to.",
    sections: [
      { id: "switch", emoji: "⚙️", title: "Managing tabs" },
      { id: "everywhere", emoji: "🌐", title: "The same everywhere", help: "Rules cannot change these." },
      { id: "notifications", emoji: "🔔", title: "Notifications" },
    ],
  },
  {
    id: "timing",
    emoji: "⏳",
    title: "Timer defaults",
    short: "Timers",
    help: "How long tabs live, and what happens when they run out. These are the defaults: a rule can set every one of them differently for the pages it matches.",
    sections: [
      { id: "clock", emoji: "⏳", title: "Timing" },
      { id: "expiry", emoji: "🚪", title: "When a tab expires" },
    ],
  },
  {
    id: "appearance",
    emoji: "🎨",
    title: "Appearance",
    short: "Appearance",
    help: "How remaining time is shown in the browser. Colour runs green, yellow, red as time runs out.",
    sections: [
      { id: "tabs", emoji: "🗂️", title: "Tabs", help: "What changes on the tab itself." },
      { id: "toolbar", emoji: "🔘", title: "Toolbar button", help: "What the Timed Tabs button shows for the tab you are on." },
      { id: "when", emoji: "⏱️", title: "When indicators show" },
    ],
  },
  {
    id: "advanced",
    emoji: "🔧",
    title: "Advanced",
    short: "Advanced",
    help: "Rarely needed.",
    sections: [
      { id: "tuning", emoji: "🔧", title: "Tuning" },
      { id: "flags", emoji: "🚩", title: "Feature flags", help: "Work that is not finished enough to be on for everyone. Expect rough edges." },
    ],
  },
];

/**
 * How each setting is presented. `type` is one of:
 * duration (seconds), toggle, choice ({ value, label }[]), percent, indicators,
 * flags (the feature-flag switches from shared/flags.js), lead (a time or a
 * share of the lifetime, see shared/lead.js).
 * A percent field with `slider` is dragged rather than typed.
 * `requires` names optional permissions the panel must obtain before the
 * setting can be switched on; it is turned back off if they are ever revoked.
 * A field with no `label` is headed by its section; `name` then says what it
 * is where one word is needed, as in the saved toast.
 */
export const FIELDS = [
  {
    key: "tabManagement",
    group: "general",
    section: "switch",
    type: "toggle",
    label: "Manage tabs",
    help: "Turn this off and Timed Tabs leaves your tabs completely alone: no timers, nothing closed, no colours or badges. Turn it back on and every tab starts its life afresh from that moment.",
  },
  {
    key: "requireRuleMatch",
    group: "general",
    section: "switch",
    type: "toggle",
    label: "Only Managed Rule Matching Tabs",
    help: "Enable this setting to have Timed Tabs only manage tab where the URL matches a rule.",
    showWhen: (s) => s.tabManagement !== false,
  },
  {
    key: "tabLifetimeSeconds",
    group: "timing",
    section: "clock",
    type: "duration",
    label: "Tab lifetime",
    help: "How long a tab may sit before it counts as expired.",
  },
  {
    key: "snoozePercent",
    group: "general",
    section: "everywhere",
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
    section: "clock",
    type: "toggle",
    label: "Restart the timer when you switch to a tab",
    help: "Every visit gives the tab a full lifetime again. Tabs you keep coming back to never expire.",
  },
  {
    key: "pauseWhileActive",
    group: "timing",
    section: "clock",
    type: "toggle",
    label: "Only count time while a tab is in the background",
    help: "The clock stops while you are looking at a tab and resumes when you leave it.",
  },
  {
    key: "onExpire",
    group: "timing",
    section: "expiry",
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
    group: "general",
    section: "everywhere",
    type: "duration",
    label: "Keep recently expired tabs for",
    help: "Tabs that Timed Tabs closed stay listed on the Tabs page for this long, so you can reopen them.",
    min: 60,
  },
  {
    key: "notifyOnExpire",
    group: "general",
    section: "notifications",
    type: "toggle",
    label: "Tell me when a tab is closed",
    help: "A notification naming the tab, one for each batch we close. Click it to bring the tab back.",
    requires: { permissions: ["notifications"] },
  },
  {
    key: "indicators",
    group: "appearance",
    section: "tabs",
    type: "indicators",
    // The one list of indicators is shown in parts: the favicon first so its
    // style can sit right under it, then the other tab-strip marks, then on
    // the toolbar section the toolbar button's. `only` names each part's ids.
    only: ["favicon"],
    name: "Tab indicators",
  },
  {
    key: "faviconStyle",
    group: "appearance",
    section: "tabs",
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
    key: "indicators",
    group: "appearance",
    section: "tabs",
    type: "indicators",
    only: ["title-prefix", "theme-tint"],
    name: "Tab indicators",
  },
  {
    key: "indicators",
    group: "appearance",
    section: "toolbar",
    type: "indicators",
    only: ["action-icon", "badge"],
    name: "Toolbar indicators",
  },
  {
    key: "flashBeforeExpiry",
    group: "appearance",
    section: "when",
    type: "toggle",
    label: "Flash before expiry",
    help: "Every indicator blinks during the last stretch before a tab runs out of time.",
  },
  {
    key: "flashLead",
    group: "appearance",
    section: "when",
    type: "lead",
    label: "Start flashing",
    help: "How much time must be left before the flashing begins: an amount, or a share of the tab's lifetime.",
    showWhen: (s) => s.flashBeforeExpiry,
  },
  {
    key: "hideWhileGreen",
    group: "appearance",
    section: "when",
    type: "toggle",
    label: "No display changes until",
    help: "Keep every indicator off on a tab until it is close enough to expiring. Off means indicators show all the time.",
  },
  {
    key: "quietStart",
    group: "appearance",
    section: "when",
    type: "lead",
    label: "When to start display updates",
    help: "How much time must be left before anything shows: an amount, or a share of the tab's lifetime. An amount longer than the lifetime shows from the start.",
    showWhen: (s) => s.hideWhileGreen,
  },
  {
    key: "featureFlags",
    group: "advanced",
    section: "flags",
    type: "flags",
  },
  {
    key: "tickSeconds",
    group: "advanced",
    section: "tuning",
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
    if (field?.type === "lead") {
      const lead = parseLead(value);
      return lead ? formatLead(lead) : undefined;
    }
    const options = key === "tabSort" ? TAB_SORTS.map((s) => s.id) : field?.options?.map((o) => o.value);
    return !options || options.includes(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Keys an older build wrote, carried over to what this one reads. Applied to
 * stored settings, to each rule's `set` and to a backup on the way in, so a
 * value saved either side of the change lands in the same place. Returns a
 * copy; the old key is dropped from it.
 */
export function migrateSettingKeys(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  if ("quietUntilPercent" in out) {
    if (!("quietStart" in out)) {
      const lead = leadFromElapsedPercent(out.quietUntilPercent);
      if (lead) out.quietStart = lead;
    }
    delete out.quietUntilPercent;
  }
  if ("flashLeadSeconds" in out) {
    const n = Math.round(Number(out.flashLeadSeconds));
    if (!("flashLead" in out) && Number.isFinite(n) && n >= 1) out.flashLead = `${n}s`;
    delete out.flashLeadSeconds;
  }
  return out;
}

export async function getSettings() {
  const stored = migrateSettingKeys(
    await api.storage[STORAGE_AREA].get([...Object.keys(DEFAULTS), "quietUntilPercent", "flashLeadSeconds"]),
  );
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
  return Array.isArray(rules) ? rules.map(migrateRule) : [];
}

/** A rule as this build reads it, whichever build wrote it. */
function migrateRule(rule) {
  return rule && typeof rule === "object" && rule.set ? { ...rule, set: migrateSettingKeys(rule.set) } : rule;
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
